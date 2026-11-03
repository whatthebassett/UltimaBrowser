// Import: Ultima finds Chrome and Firefox on the computer and brings over their bookmarks (into Waypoints, in their
// folders) and history, once: importing again adds nothing twice. It runs on a made-up Chrome and Firefox profile,
// with Ultima pointed at them in place of the real ones (LOCALAPPDATA and APPDATA, where importer.js looks on
// Windows), so your own browsers are never read. Also the bookmark and password files you can import by hand.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { launch, removeProfile } = require('./harness');
const importer = require('../src/main/importer');

const DAY = 24 * 60 * 60 * 1000;
const webkitTime = (ms) => String((ms + 11644473600000) * 1000); // Chrome: microseconds since 1601

// Chrome's session file (SNSS, importer.js): its records, as Chrome writes them
function snss(commands) {
  const rec = ([id, payload]) => { const head = Buffer.alloc(3); head.writeUInt16LE(payload.length + 1, 0); head.writeUInt8(id, 2); return Buffer.concat([head, payload]); };
  const head = Buffer.alloc(8); head.write('SNSS', 0, 'latin1'); head.writeInt32LE(3, 4);
  return Buffer.concat([head, ...commands.map(rec)]);
}
const ints = (...n) => { const b = Buffer.alloc(n.length * 4); n.forEach((v, i) => b.writeInt32LE(v, i * 4)); return b; };
const padded = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
function navigation(tab, index, url, title) {
  const body = Buffer.concat([ints(tab, index), ints(Buffer.byteLength(url)), padded(Buffer.from(url)), ints(title.length), padded(Buffer.from(title, 'utf16le'))]);
  return Buffer.concat([ints(body.length), body]);
}
const pinned = (tab) => Buffer.concat([ints(tab), Buffer.from([1, 0, 0, 0])]);
const closed = (id) => Buffer.concat([ints(id, 0), Buffer.alloc(8)]);

function makeChrome(local) {
  const dir = path.join(local, 'Google', 'Chrome', 'User Data');
  const prof = path.join(dir, 'Default');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Sam' } } } }));
  const url = (name, u) => ({ type: 'url', name, url: u, date_added: webkitTime(Date.now() - DAY) });
  fs.writeFileSync(path.join(prof, 'Bookmarks'), JSON.stringify({
    roots: {
      bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
        url('Ultima on GitHub', 'https://github.com/whatthebassett/UltimaBrowser'),
        { type: 'folder', name: 'Recipes', children: [url('Pancakes', 'https://example.com/pancakes')] },
      ] },
      other: { type: 'folder', name: 'Other bookmarks', children: [url('Example', 'https://example.com/')] },
      synced: { type: 'folder', name: 'Mobile bookmarks', children: [] },
    },
  }));
  // open tabs: a pinned tab and a tab gone back a page in one window, a tab closed there, a closed window, and a
  // second window with one tab
  fs.mkdirSync(path.join(prof, 'Sessions'));
  fs.writeFileSync(path.join(prof, 'Sessions', 'Session_13300000000000000'), snss([
    [0, ints(1, 10)], [2, ints(10, 0)], [6, navigation(10, 0, 'https://github.com/', 'GitHub')], [12, pinned(10)],
    [0, ints(1, 11)], [2, ints(11, 1)], [6, navigation(11, 0, 'https://example.com/docs', 'Docs')],
    [6, navigation(11, 1, 'https://example.com/docs/next', 'Next page')], [7, ints(11, 0)],
    [0, ints(1, 12)], [2, ints(12, 2)], [6, navigation(12, 0, 'https://example.com/closed', 'Closed tab')], [16, closed(12)],
    [0, ints(2, 20)], [6, navigation(20, 0, 'https://example.com/closed-window', 'In a closed window')], [17, closed(2)],
    [0, ints(3, 30)], [2, ints(30, 0)], [6, navigation(30, 0, 'https://news.example.com/', 'Ünïcode news')],
  ]));
  const db = new DatabaseSync(path.join(prof, 'History'));
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)');
  const add = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, ?)');
  add.run('https://example.com/pancakes', 'Fluffy pancakes', 4, webkitTime(Date.now() - DAY), 0);
  add.run('https://news.example.com/today', 'Today’s news', 1, webkitTime(Date.now() - 2 * DAY), 0);
  add.run('https://example.com/hidden-frame', 'A frame you never saw', 1, webkitTime(Date.now()), 1);
  db.close();
}

function makeFirefox(roaming) {
  const dir = path.join(roaming, 'Mozilla', 'Firefox');
  const prof = path.join(dir, 'Profiles', 'abcd1234.default-release');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profiles.ini'), '[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abcd1234.default-release\nDefault=1\n');
  const db = new DatabaseSync(path.join(prof, 'places.sqlite'));
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, dateAdded INTEGER, guid TEXT);`);
  const now = Date.now() * 1000; // Firefox: microseconds since 1970
  const place = db.prepare('INSERT INTO moz_places (id, url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?, ?)');
  place.run(1, 'https://developer.mozilla.org/', 'MDN Web Docs', 9, now - DAY * 1000);
  place.run(2, 'https://www.mozilla.org/firefox/', 'Firefox', 2, now - 2 * DAY * 1000);
  place.run(3, 'place:sort=8&maxResults=10', 'Most visited', 0, null); // a smart folder, not a bookmark
  const mark = db.prepare('INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, dateAdded, guid) VALUES (?, ?, ?, ?, 0, ?, ?, ?)');
  mark.run(1, 2, null, 0, '', now, 'root________');
  mark.run(2, 2, null, 1, 'menu', now, 'menu________');
  mark.run(3, 2, null, 1, 'toolbar', now, 'toolbar_____');
  mark.run(4, 2, null, 3, 'Dev', now, 'devfolder001');
  mark.run(5, 1, 1, 4, 'MDN', now, 'bookmark0001');
  mark.run(6, 1, 2, 2, 'Get Firefox', now, 'bookmark0002');
  mark.run(7, 1, 3, 3, 'Most visited', now, 'bookmark0003');
  db.close();
}

let app;
let fake;
before(async () => {
  fake = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-test-browsers-'));
  const local = path.join(fake, 'Local');
  const roaming = path.join(fake, 'Roaming');
  makeChrome(local);
  makeFirefox(roaming);
  app = await launch({ env: { LOCALAPPDATA: local, APPDATA: roaming } });
});
after(async () => { await app?.close(); removeProfile(fake); });

const sources = () => app.ui(() => window.ultima.detectBrowsers());
const run = (sourceId) => app.ui((id) => window.ultima.runImport({ sourceId: id, what: { bookmarks: true, history: true, tabs: false, cookies: false }, partition: partitionFor(B.activeSpaceId) }), sourceId);
// every Waypoint as its folder path and title
const waypoints = () => app.ui(async () => {
  const nodes = await window.ultima.bookmarkTree();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const where = (n) => { const parts = []; for (let p = byId.get(n.parent); p; p = byId.get(p.parent)) parts.unshift(p.title); return parts.join('/'); };
  return nodes.filter((n) => n.type === 'url').map((n) => `${where(n)}/${n.title} ${n.url}`);
});
const history = (query) => app.ui(async (q) => (await window.ultima.listHistory({ query: q })).items.map((h) => `${h.title} ${h.url}`), query);

test('finds Chrome and Firefox, with their profiles', async () => {
  const found = (await sources()).map((s) => `${s.label}: ${s.profile}`);
  assert.deepEqual(found.sort(), ['Firefox: default-release', 'Google Chrome: Sam']);
});

test('brings over Chrome’s bookmarks into Waypoints, in their folders, and its history', async () => {
  const chrome = (await sources()).find((s) => s.browser === 'chrome');
  const r = await run(chrome.id);
  assert.deepEqual(r.errors, []);
  assert.equal(r.bookmarks, 3);
  assert.equal(r.history, 2, 'the hidden page is left out');
  const marks = await waypoints();
  for (const m of [
    'Other Waypoints/Google Chrome/Bookmarks bar/Ultima on GitHub https://github.com/whatthebassett/UltimaBrowser',
    'Other Waypoints/Google Chrome/Bookmarks bar/Recipes/Pancakes https://example.com/pancakes',
    'Other Waypoints/Google Chrome/Other bookmarks/Example https://example.com/',
  ]) assert.ok(marks.includes(m), `${m}\n  in\n${marks.join('\n')}`);
  assert.deepEqual(await history('pancakes'), ['Fluffy pancakes https://example.com/pancakes']);
  assert.deepEqual(await history('hidden'), []);
});

test('brings over Chrome’s open tabs, pinned ones pinned, on the page each was on', async () => {
  const chrome = (await sources()).find((s) => s.browser === 'chrome');
  assert.equal(chrome.has.tabs, true);
  const r = await app.ui((id) => window.ultima.runImport({ sourceId: id, what: { tabs: true }, partition: partitionFor(B.activeSpaceId) }), chrome.id);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.tabs.map((t) => [t.title, t.url, t.zone]), [
    ['GitHub', 'https://github.com/', 'pinned'],
    ['Docs', 'https://example.com/docs', 'normal'],
    ['Ünïcode news', 'https://news.example.com/', 'normal'],
  ]);
  // they open in the sidebar as the import page opens them, without loading until clicked
  await app.ui((tabs) => { openImportedTabs(tabs); return true; }, r.tabs);
  const opened = await app.ui(() => B.tabs.filter((t) => /github|example/.test(t.homeUrl || t.url)).map((t) => [t.title, t.zone, Boolean(t.webview)]));
  assert.deepEqual(opened, [['GitHub', 'pinned', false], ['Docs', 'normal', false], ['Ünïcode news', 'normal', false]]);
});

test('importing Chrome again adds nothing twice', async () => {
  const before = (await waypoints()).length;
  const chrome = (await sources()).find((s) => s.browser === 'chrome');
  const r = await run(chrome.id);
  assert.equal(r.bookmarks, 0);
  assert.equal((await waypoints()).length, before);
  assert.equal((await history('pancakes')).length, 1);
});

test('brings over Firefox’s bookmarks, in their folders, and its history', async () => {
  const firefox = (await sources()).find((s) => s.browser === 'firefox');
  const r = await run(firefox.id);
  assert.deepEqual(r.errors, []);
  assert.equal(r.bookmarks, 2, 'the smart folder is left out');
  assert.equal(r.history, 2);
  const marks = await waypoints();
  for (const m of [
    'Other Waypoints/Firefox/Bookmarks toolbar/Dev/MDN https://developer.mozilla.org/',
    'Other Waypoints/Firefox/Bookmarks menu/Get Firefox https://www.mozilla.org/firefox/',
  ]) assert.ok(marks.includes(m), `${m}\n  in\n${marks.join('\n')}`);
  assert.deepEqual(await history('mdn'), ['MDN Web Docs https://developer.mozilla.org/']);
});

// the files you can import from Settings (a bookmarks HTML file any browser exports, a passwords CSV)
test('reads an exported bookmarks file, with its folders', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><H3>Bookmarks bar</H3>
      <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="1700000000">A &amp; B</A>
        <DT><H3>Work</H3>
        <DL><p><DT><A HREF="https://example.com/w">Wiki</A></DL><p>
      </DL><p>
      <DT><A HREF="https://example.com/loose">Loose</A>
    </DL><p>`;
  const marks = importer.bookmarksFromHtml(html, 'Imported').map((b) => `${b.folder}/${b.title} ${b.url}`);
  assert.deepEqual(marks, [
    'Imported/Bookmarks bar/A & B https://example.com/a',
    'Imported/Bookmarks bar/Work/Wiki https://example.com/w',
    'Imported/Loose https://example.com/loose',
  ]);
});

test('reads a passwords file from Chrome and from Firefox', () => {
  const chrome = importer.passwordsFromCsv('name,url,username,password,note\nExample,https://example.com/,sam,"p,ss""word",\n');
  assert.deepEqual(chrome.map((p) => [p.url, p.username, p.password]), [['https://example.com/', 'sam', 'p,ss"word']]);
  const firefox = importer.passwordsFromCsv('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://mozilla.org","fox","secret",,"https://mozilla.org","{1}","1","1","1"\n');
  assert.deepEqual(firefox.map((p) => [p.url, p.username, p.password]), [['https://mozilla.org', 'fox', 'secret']]);
});
