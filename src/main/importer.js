// Detects installed browsers and reads their bookmarks, history, open tabs and cookies.
// Chromium family: Chrome, Edge, Brave, Vivaldi, Opera, Opera GX, Arc, Dia. Gecko family: Firefox, Zen. Their Beta, Dev,
// Canary and Nightly too. And Safari.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { parseBplist } = require('./plist');

const HISTORY_IMPORT_LIMIT = 25000;
const home = os.homedir();
const env = (k, fallback) => process.env[k] || fallback;

// Chromium browsers and their test channels, each a folder of its own: [id, name, Windows (in %LOCALAPPDATA%), macOS
// (in Application Support), Linux (in ~/.config)]; null where it isn't made. A Windows folder can start with
// %APPDATA% instead, or be found by a function (Arc, a Store app, keeps its folder under its package's name).
const CHROMIUM = [
  ['chrome', 'Google Chrome', 'Google/Chrome/User Data', 'Google/Chrome', 'google-chrome'],
  ['chrome-beta', 'Google Chrome Beta', 'Google/Chrome Beta/User Data', 'Google/Chrome Beta', 'google-chrome-beta'],
  ['chrome-dev', 'Google Chrome Dev', 'Google/Chrome Dev/User Data', 'Google/Chrome Dev', 'google-chrome-unstable'],
  ['chrome-canary', 'Google Chrome Canary', 'Google/Chrome SxS/User Data', 'Google/Chrome Canary', 'google-chrome-canary'],
  ['edge', 'Microsoft Edge', 'Microsoft/Edge/User Data', 'Microsoft Edge', 'microsoft-edge'],
  ['edge-beta', 'Microsoft Edge Beta', 'Microsoft/Edge Beta/User Data', 'Microsoft Edge Beta', 'microsoft-edge-beta'],
  ['edge-dev', 'Microsoft Edge Dev', 'Microsoft/Edge Dev/User Data', 'Microsoft Edge Dev', 'microsoft-edge-dev'],
  ['edge-canary', 'Microsoft Edge Canary', 'Microsoft/Edge SxS/User Data', 'Microsoft Edge Canary', null],
  ['brave', 'Brave', 'BraveSoftware/Brave-Browser/User Data', 'BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser'],
  ['brave-beta', 'Brave Beta', 'BraveSoftware/Brave-Browser-Beta/User Data', 'BraveSoftware/Brave-Browser-Beta', 'BraveSoftware/Brave-Browser-Beta'],
  ['brave-nightly', 'Brave Nightly', 'BraveSoftware/Brave-Browser-Nightly/User Data', 'BraveSoftware/Brave-Browser-Nightly', 'BraveSoftware/Brave-Browser-Nightly'],
  ['vivaldi', 'Vivaldi', 'Vivaldi/User Data', 'Vivaldi', 'vivaldi'],
  ['vivaldi-snapshot', 'Vivaldi Snapshot', 'Vivaldi Snapshot/User Data', 'Vivaldi Snapshot', 'vivaldi-snapshot'],
  ['opera', 'Opera', '%APPDATA%/Opera Software/Opera Stable', 'com.operasoftware.Opera', 'opera'],
  ['opera-gx', 'Opera GX', '%APPDATA%/Opera Software/Opera GX Stable', 'com.operasoftware.OperaGX', null],
  ['arc', 'Arc', (local) => storeAppDir(local, 'TheBrowserCompany.Arc_', 'LocalCache/Local/Arc/User Data'), 'Arc/User Data', null],
  ['dia', 'Dia', null, 'Dia/User Data', null],
];
// a Store app's own folder: %LOCALAPPDATA%\Packages\<name>_<publisher id>\…
function storeAppDir(local, prefix, inside) {
  try {
    const pkg = fs.readdirSync(path.join(local, 'Packages')).find((d) => d.startsWith(prefix));
    return pkg ? path.join(local, 'Packages', pkg, inside) : null;
  } catch { return null; }
}
// Firefox and Zen: [id, name, Windows (in %APPDATA%), macOS (in Application Support), Linux (in ~)]. Their test channels
// keep their profiles in the same folder, each under a name of its own, which tells them apart (geckoChannel).
const GECKO = [
  ['firefox', 'Firefox', 'Mozilla/Firefox', 'Firefox', '.mozilla/firefox'],
  ['zen', 'Zen', 'zen', 'zen', '.zen'],
];
const GECKO_CHANNELS = {
  firefox: [[/nightly/i, 'firefox-nightly', 'Firefox Nightly'], [/dev-edition/i, 'firefox-dev', 'Firefox Developer Edition']],
  zen: [[/twilight/i, 'zen-twilight', 'Zen Twilight']],
};
const geckoChannel = (family, profile) => (GECKO_CHANNELS[family] || []).find(([re]) => re.test(profile || ''));

function browserRoots() {
  const col = { win32: 2, darwin: 3 }[process.platform] || 4;
  const support = path.join(home, 'Library', 'Application Support');
  const local = env('LOCALAPPDATA', path.join(home, 'AppData', 'Local'));
  const roaming = env('APPDATA', path.join(home, 'AppData', 'Roaming'));
  const chromiumBase = { win32: local, darwin: support }[process.platform] || env('XDG_CONFIG_HOME', path.join(home, '.config'));
  const geckoBase = { win32: roaming, darwin: support }[process.platform] || home;
  const dirOf = (where, base) => {
    if (typeof where === 'function') return where(base);
    return where.startsWith('%APPDATA%/') ? path.join(roaming, where.slice(10)) : path.join(base, where);
  };
  const roots = (list, kind, base) => list.filter((b) => b[col]).map((b) => ({ browser: b[0], label: b[1], kind, dir: dirOf(b[col], base) }))
    .filter((r) => r.dir);
  // Safari (macOS): its bookmarks and history are in ~/Library/Safari, which only apps given Full Disk Access can read
  const safari = process.platform === 'darwin' ? [{ browser: 'safari', label: 'Safari', kind: 'safari', dir: path.join(home, 'Library', 'Safari') }] : [];
  return [...roots(CHROMIUM, 'chromium', chromiumBase), ...roots(GECKO, 'gecko', geckoBase), ...safari];
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function chromiumProfiles(root) {
  let names = {};
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root.dir, 'Local State'), 'utf8'));
    names = Object.fromEntries(Object.entries(state.profile?.info_cache || {}).map(([d, v]) => [d, v.name]));
  } catch { /* no Local State: scan directories */ }
  let dirs = [];
  try { dirs = fs.readdirSync(root.dir).filter((d) => d === 'Default' || /^Profile \d+$/.test(d)); } catch { return []; }
  const hasData = (p) => exists(path.join(p, 'Bookmarks')) || exists(path.join(p, 'History'));
  // (Opera kept its one profile in the folder itself, before it had profiles: that one, when there are no others)
  if (!dirs.some((d) => hasData(path.join(root.dir, d)))) dirs = [''];
  return dirs
    .map((d) => path.join(root.dir, d))
    .filter(hasData)
    .map((p) => {
      const dir = p === path.join(root.dir, '') ? 'Default' : path.basename(p);
      const tabs = chromiumSessionFiles(p).length > 0 || (root.browser === 'arc' && exists(arcSidebarFile(root.dir)));
      return {
        profile: names[dir] || dir,
        path: p,
        has: { bookmarks: exists(path.join(p, 'Bookmarks')), history: exists(path.join(p, 'History')), tabs, cookies: false },
      };
    });
}

function geckoProfiles(root) {
  let ini;
  try { ini = fs.readFileSync(path.join(root.dir, 'profiles.ini'), 'utf8'); } catch { return []; }
  const profiles = [];
  let cur = null;
  for (const line of ini.split(/\r?\n/)) {
    const section = line.match(/^\[(.+)\]$/);
    if (section) { cur = /^Profile/.test(section[1]) ? {} : null; if (cur) profiles.push(cur); continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (cur && kv) cur[kv[1].trim()] = kv[2].trim();
  }
  const seen = new Set();
  return profiles
    .filter((p) => p.Path)
    .map((p) => ({ name: p.Name || p.Path, path: p.IsRelative === '0' ? p.Path : path.join(root.dir, p.Path) }))
    .filter((p) => !seen.has(p.path) && seen.add(p.path) && exists(path.join(p.path, 'places.sqlite')))
    .map((p) => ({
      profile: p.name,
      path: p.path,
      has: {
        bookmarks: true,
        history: true,
        tabs: sessionFiles(p.path).length > 0,
        cookies: exists(path.join(p.path, 'cookies.sqlite')),
      },
    }));
}

function detect() {
  const sources = [];
  for (const root of browserRoots()) {
    if (!exists(root.dir)) continue;
    const profiles = { chromium: chromiumProfiles, gecko: geckoProfiles, safari: safariProfiles }[root.kind](root);
    for (const p of profiles) {
      const [, browser, label] = (root.kind === 'gecko' && geckoChannel(root.browser, p.profile)) || [null, root.browser, root.label];
      sources.push({
        id: `${root.browser}:${p.path}`,
        browser, // which browser or channel, e.g. chrome-beta (for its icon)
        family: root.browser.split('-')[0], // e.g. chrome
        label,
        kind: root.kind,
        ...p,
      });
    }
  }
  return sources;
}

// Browsers keep their databases open; copy them (plus WAL/journal) to a temp dir before reading.
function withDbCopy(file, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-import-'));
  const target = path.join(tmpDir, path.basename(file));
  try {
    try {
      fs.copyFileSync(file, target);
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        throw Object.assign(new Error(`${path.basename(file)} is locked — close that browser and try again.`), { code: err.code });
      }
      throw err;
    }
    for (const suffix of ['-wal', '-journal']) {
      if (exists(file + suffix)) { try { fs.copyFileSync(file + suffix, target + suffix); } catch { /* best effort */ } }
    }
    const db = new DatabaseSync(target);
    try { return fn(db); } finally { db.close(); }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- Chromium ----
const webkitToMs = (t) => (t ? Math.round(Number(t) / 1000 - 11644473600000) : Date.now());

function chromiumBookmarks(src) {
  const json = JSON.parse(fs.readFileSync(path.join(src.path, 'Bookmarks'), 'utf8'));
  const out = [];
  const rootNames = { bookmark_bar: 'Bookmarks bar', other: 'Other bookmarks', synced: 'Mobile bookmarks' };
  for (const [key, root] of Object.entries(json.roots || {})) {
    if (!root || typeof root !== 'object' || !root.children) continue;
    const base = `${src.label}/${rootNames[key] || root.name || key}`;
    const visit = (node, folder) => {
      for (const child of node.children || []) {
        if (child.type === 'url') out.push({ title: child.name, url: child.url, folder, added: webkitToMs(child.date_added) });
        else if (child.type === 'folder') visit(child, `${folder}/${child.name}`);
      }
    };
    visit(root, base);
  }
  return out;
}

function chromiumHistory(src) {
  return withDbCopy(path.join(src.path, 'History'), (db) => db
    // WebKit timestamps (µs since 1601) overflow JS numbers, so convert to Unix ms inside SQLite.
    .prepare('SELECT url, title, visit_count AS visits, last_visit_time / 1000 - 11644473600000 AS t FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?')
    .all(HISTORY_IMPORT_LIMIT)
    .map((r) => ({ url: r.url, title: r.title, visits: Number(r.visits) || 1, lastVisit: Number(r.t) || Date.now() })));
}

// Open tabs, from the profile's session file (Sessions/Session_<time>, the newest one; Chrome, Edge, Brave and
// Vivaldi all keep it). It's Chromium's SNSS format: "SNSS", a version, then commands, each a uint16 size, a uint8 id
// and its payload: a C struct for most, a Pickle (a uint32 size, then 4-byte-aligned values) for a tab's pages. Played
// in order they rebuild the windows: which window each tab is in and where, its pages and which one it's on, whether
// it's pinned, and which tabs and windows have closed since.
const SNSS = {
  setTabWindow: 0, setTabIndexInWindow: 2, updateTabNavigation: 6, setSelectedNavigationIndex: 7,
  setPinnedState: 12, tabClosed: 16, windowClosed: 17,
};

function chromiumSessionFiles(profileDir) {
  const dir = path.join(profileDir, 'Sessions');
  try {
    return fs.readdirSync(dir).filter((f) => /^Session_\d+$/.test(f)).sort().reverse().map((f) => path.join(dir, f));
  } catch { return []; }
}

function readSnss(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'SNSS') throw new Error('not a Chromium session file');
  const version = buf.readInt32LE(4);
  if (version === 2 || version === 4) throw new Error('this browser encrypts its session file');
  const tabs = new Map(); // tab id → { window, index, pinned, pages: index → { url, title }, current }
  const closedWindows = new Set();
  const tabOf = (id) => {
    if (!tabs.has(id)) tabs.set(id, { window: null, index: 0, pinned: false, pages: new Map(), current: null, closed: false });
    return tabs.get(id);
  };
  let at = 8;
  while (at + 3 <= buf.length) {
    const size = buf.readUInt16LE(at);
    if (size < 1 || at + 2 + size > buf.length) break;
    const id = buf.readUInt8(at + 2);
    const p = buf.subarray(at + 3, at + 2 + size);
    at += 2 + size;
    const int = (o) => (p.length >= o + 4 ? p.readInt32LE(o) : null);
    if (id === SNSS.setTabWindow) tabOf(int(4)).window = int(0);
    else if (id === SNSS.setTabIndexInWindow) tabOf(int(0)).index = int(4);
    else if (id === SNSS.setSelectedNavigationIndex) tabOf(int(0)).current = int(4);
    else if (id === SNSS.setPinnedState) tabOf(int(0)).pinned = p.length > 4 && p[4] !== 0;
    else if (id === SNSS.tabClosed) tabOf(int(0)).closed = true;
    else if (id === SNSS.windowClosed) closedWindows.add(int(0));
    else if (id === SNSS.updateTabNavigation) {
      // the Pickle: its size, then the tab, the page's place in its history, its address and its title (UTF-16)
      try {
        let o = 4;
        const tabId = p.readInt32LE(o); o += 4;
        const index = p.readInt32LE(o); o += 4;
        const urlLen = p.readInt32LE(o); o += 4;
        const url = p.toString('utf8', o, o + urlLen); o += (urlLen + 3) & ~3;
        const titleLen = p.readInt32LE(o); o += 4;
        const title = p.toString('utf16le', o, o + titleLen * 2);
        tabOf(tabId).pages.set(index, { url, title });
      } catch { /* a cut-off record */ }
    }
  }
  const out = [];
  for (const t of tabs.values()) {
    if (t.closed || t.window === null || closedWindows.has(t.window) || !t.pages.size) continue;
    const page = t.pages.get(t.current) || t.pages.get(Math.max(...t.pages.keys()));
    if (page?.url && /^https?:/i.test(page.url)) out.push({ ...t, page });
  }
  // window by window, in the order they were opened, and each window's tabs in its order
  const windows = [...new Set(out.map((t) => t.window))];
  return out.sort((a, b) => windows.indexOf(a.window) - windows.indexOf(b.window) || a.index - b.index)
    .map((t) => ({ url: t.page.url, title: t.page.title || t.page.url, favicon: '', zone: t.pinned ? 'pinned' : 'normal' }));
}

function chromiumTabs(src) {
  const [file] = chromiumSessionFiles(src.path);
  if (!file) return [];
  let buf;
  try { buf = fs.readFileSync(file); } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') throw new Error(`${src.label} is using its session file: close it and try again.`);
    throw err;
  }
  return readSnss(buf);
}

// ---- Gecko (Firefox / Zen) ----
const geckoRootNames = {
  menu________: 'Bookmarks menu',
  toolbar_____: 'Bookmarks toolbar',
  unfiled_____: 'Other bookmarks',
  mobile______: 'Mobile bookmarks',
};

function geckoBookmarks(src) {
  return withDbCopy(path.join(src.path, 'places.sqlite'), (db) => {
    const rows = db.prepare(
      'SELECT b.id, b.parent, b.type, b.title, b.guid, b.dateAdded, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id',
    ).all();
    const folders = new Map(rows.filter((r) => r.type === 2).map((r) => [r.id, r]));
    const folderPath = (id) => {
      const parts = [];
      for (let f = folders.get(id); f; f = folders.get(f.parent)) {
        if (f.guid === 'root________') break;
        parts.unshift(geckoRootNames[f.guid] || f.title || 'Folder');
      }
      return `${src.label}/${parts.join('/')}`;
    };
    return rows
      .filter((r) => r.type === 1 && r.url && !r.url.startsWith('place:'))
      .map((r) => ({ title: r.title, url: r.url, folder: folderPath(r.parent), added: Math.round(Number(r.dateAdded) / 1000) }));
  });
}

function geckoHistory(src) {
  return withDbCopy(path.join(src.path, 'places.sqlite'), (db) => db
    .prepare('SELECT url, title, visit_count AS visits, last_visit_date AS t FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ?')
    .all(HISTORY_IMPORT_LIMIT)
    .map((r) => ({ url: r.url, title: r.title, visits: Number(r.visits) || 1, lastVisit: Math.round(Number(r.t) / 1000) })));
}

function sessionFiles(profileDir) {
  return [
    path.join(profileDir, 'sessionstore.jsonlz4'),
    path.join(profileDir, 'sessionstore-backups', 'recovery.jsonlz4'),
    path.join(profileDir, 'sessionstore-backups', 'previous.jsonlz4'),
  ].filter(exists);
}

// mozLz4: "mozLz40\0" + uint32 LE decompressed size + raw LZ4 block.
function decodeMozLz4(buf) {
  if (buf.toString('latin1', 0, 8) !== 'mozLz40\0') throw new Error('Not a mozLz4 file');
  const size = buf.readUInt32LE(8);
  const src = buf.subarray(12);
  const dst = Buffer.alloc(size);
  let s = 0;
  let d = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    src.copy(dst, d, s, s + lit);
    s += lit;
    d += lit;
    if (s >= src.length) break;
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    let len = token & 15;
    if (len === 15) { let b; do { b = src[s++]; len += b; } while (b === 255); }
    len += 4;
    for (let m = d - offset; len > 0; len -= 1) dst[d++] = dst[m++];
  }
  return dst.subarray(0, d).toString('utf8');
}

function geckoTabs(src) {
  const files = sessionFiles(src.path).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return [];
  const session = JSON.parse(decodeMozLz4(fs.readFileSync(files[0])));
  const tabs = [];
  for (const win of session.windows || []) {
    for (const tab of win.tabs || []) {
      const entry = tab.entries?.[(tab.index || tab.entries.length) - 1];
      if (!entry?.url || !/^https?:/i.test(entry.url)) continue;
      tabs.push({
        url: entry.url,
        title: entry.title || entry.url,
        favicon: typeof tab.image === 'string' && /^https?:|^data:image/.test(tab.image) ? tab.image : '',
        // Zen marks Essentials with zenEssential; its other pinned tabs (and Firefox's) become pinned tabs here
        zone: tab.zenEssential ? 'essential' : tab.pinned ? 'pinned' : 'normal',
      });
    }
  }
  return tabs;
}

function geckoCookies(src) {
  return withDbCopy(path.join(src.path, 'cookies.sqlite'), (db) => db
    .prepare("SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''")
    .all());
}

async function importCookies(src, ses) {
  const nowSec = Date.now() / 1000;
  const rows = geckoCookies(src);
  let added = 0;
  const batch = 200;
  for (let i = 0; i < rows.length; i += batch) {
    const results = await Promise.allSettled(rows.slice(i, i + batch).map((r) => {
      let expiry = Number(r.expiry);
      if (expiry > 1e11) expiry /= 1000; // newer Firefox stores milliseconds
      if (expiry && expiry < nowSec) return Promise.reject(new Error('expired'));
      const secure = Boolean(r.isSecure);
      const host = r.host.replace(/^\./, '');
      const sameSite = r.sameSite === 2 ? 'strict' : r.sameSite === 1 ? 'lax' : secure ? 'no_restriction' : 'lax';
      return ses.cookies.set({
        url: `${secure ? 'https' : 'http'}://${host}${r.path || '/'}`,
        name: r.name,
        value: r.value,
        domain: r.host.startsWith('.') ? r.host : undefined,
        path: r.path || '/',
        secure,
        httpOnly: Boolean(r.isHttpOnly),
        sameSite,
        expirationDate: expiry || undefined,
      });
    }));
    added += results.filter((r) => r.status === 'fulfilled').length;
  }
  return added;
}

// ---- Arc ----
// Arc keeps its sidebar (Favorites, and each space's pinned and other tabs) in StorableSidebar.json, beside its
// profiles' folder: containers[…].items is a list of ids and items, each item a tab (data.tab) or a folder holding
// others (childrenIds); topAppsContainerIDs names the Favorites' folders, and each space's containerIDs its pinned
// and other tabs' ("pinned", id, "unpinned", id).
const arcSidebarFile = (userDataDir) => path.join(userDataDir, '..', 'StorableSidebar.json');

function arcTabs(src) {
  let json;
  try { json = JSON.parse(fs.readFileSync(arcSidebarFile(path.dirname(src.path)), 'utf8')); } catch { return chromiumTabs(src); }
  const box = (json.sidebar?.containers || []).find((c) => c && Array.isArray(c.items));
  if (!box) return chromiumTabs(src);
  const items = new Map(box.items.filter((x) => x && typeof x === 'object' && x.id).map((x) => [x.id, x]));
  const ids = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  const out = [];
  const seen = new Set();
  const walk = (id, zone) => {
    const item = items.get(id);
    if (!item || seen.has(id)) return;
    seen.add(id);
    const tab = item.data?.tab;
    if (typeof tab?.savedURL === 'string' && /^https?:/i.test(tab.savedURL)) {
      out.push({ url: tab.savedURL, title: item.title || tab.savedTitle || tab.savedURL, favicon: '', zone });
    }
    for (const child of ids(item.childrenIds)) walk(child, zone);
  };
  for (const id of ids(box.topAppsContainerIDs)) walk(id, 'essential'); // Arc's Favorites are Ultima's Essentials
  for (const space of (box.spaces || []).filter((s) => s && typeof s === 'object')) {
    const c = space.containerIDs || [];
    for (let i = 0; i < c.length - 1; i += 1) {
      if (c[i] === 'pinned') walk(c[i + 1], 'pinned');
      else if (c[i] === 'unpinned') walk(c[i + 1], 'normal');
    }
  }
  return out.length ? out : chromiumTabs(src);
}

// ---- Safari (macOS) ----
// Bookmarks in Bookmarks.plist (a binary property list: plist.js), history in History.db (times in seconds since 2001).
// macOS lets only apps with Full Disk Access read them, so Safari is offered whenever it's there, and importing says
// what to turn on when it can't read them.
const SAFARI_FOLDERS = { BookmarksBar: 'Favorites', BookmarksMenu: 'Bookmarks menu', 'com.apple.ReadingList': 'Reading List' };
const MAC_EPOCH = 978307200; // 2001-01-01, in seconds since 1970

function safariProfiles(root) {
  return [{ profile: 'Default', path: root.dir, has: { bookmarks: true, history: true, tabs: false, cookies: false } }];
}

function safariAccess(fn) {
  try { return fn(); } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') throw new Error('Ultima needs Full Disk Access to read Safari. Turn it on in System Settings → Privacy & Security → Full Disk Access, then try again.');
    throw err;
  }
}

function safariBookmarks(src) {
  return safariAccess(() => {
    const top = parseBplist(fs.readFileSync(path.join(src.path, 'Bookmarks.plist')));
    const out = [];
    const visit = (node, folder) => {
      for (const child of node?.Children || []) {
        if (child?.WebBookmarkType === 'WebBookmarkTypeLeaf' && typeof child.URLString === 'string') {
          const added = child.ReadingList?.DateAdded instanceof Date ? child.ReadingList.DateAdded.getTime() : Date.now();
          out.push({ title: child.URIDictionary?.title || child.URLString, url: child.URLString, folder, added });
        } else if (child?.WebBookmarkType === 'WebBookmarkTypeList') {
          visit(child, `${folder}/${SAFARI_FOLDERS[child.Title] || child.Title || 'Folder'}`);
        }
      }
    };
    visit(top, src.label);
    return out;
  });
}

function safariHistory(src) {
  return safariAccess(() => withDbCopy(path.join(src.path, 'History.db'), (db) => db
    // (SQLite takes the title from the latest visit, the row MAX() picked)
    .prepare('SELECT i.url, v.title, i.visit_count AS visits, MAX(v.visit_time) AS t FROM history_items i JOIN history_visits v ON v.history_item = i.id GROUP BY i.id ORDER BY t DESC LIMIT ?')
    .all(HISTORY_IMPORT_LIMIT)
    .map((r) => ({ url: r.url, title: r.title || '', visits: Number(r.visits) || 1, lastVisit: Math.round((Number(r.t) + MAC_EPOCH) * 1000) || Date.now() }))));
}

// ---- file-based imports ----
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ''));
}

// Chrome/Edge/Brave: name,url,username,password,note — Firefox/Zen: "url","username","password",...
function passwordsFromCsv(text) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return [];
  const col = (...names) => header.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const iUrl = col('url', 'origin', 'login_uri', 'website');
  const iUser = col('username', 'login', 'login_username', 'user');
  const iPass = col('password', 'login_password');
  if (iUrl < 0 || iPass < 0) throw new Error('This CSV has no url/password columns.');
  // names, notes, folders and favorites where the export has them (Bitwarden's does)
  const iName = col('name', 'title');
  const iNotes = col('note', 'notes', 'extra');
  const iFolder = col('folder', 'grouping');
  const iFav = col('favorite', 'fav');
  const at = (r, i) => (i >= 0 ? r[i] || '' : '');
  return rows.map((r) => ({
    url: r[iUrl], username: at(r, iUser), password: r[iPass], name: at(r, iName), notes: at(r, iNotes), folder: at(r, iFolder),
    favorite: /^(1|true|yes)$/i.test(at(r, iFav).trim()),
  }));
}

// Netscape bookmark HTML, exported by every major browser.
function bookmarksFromHtml(html, label) {
  const out = [];
  const stack = [label];
  const re = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DT><A\s+([^>]*)>([\s\S]*?)<\/A>|<\/DL>/gi;
  const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) stack.push(decode(m[1])); else if (m[2] !== undefined) {
      const href = m[2].match(/HREF="([^"]*)"/i)?.[1];
      const added = Number(m[2].match(/ADD_DATE="(\d+)"/i)?.[1]) * 1000 || Date.now();
      if (href) out.push({ url: decode(href), title: decode(m[3]), folder: stack.join('/'), added });
    } else if (stack.length > 1) stack.pop();
  }
  return out;
}

// what each kind of browser can give, and how it's read (cookies: Firefox and Zen only; the others encrypt theirs)
const READERS = {
  chromium: { bookmarks: chromiumBookmarks, history: chromiumHistory, tabs: (src) => (src.family === 'arc' ? arcTabs(src) : chromiumTabs(src)) },
  gecko: { bookmarks: geckoBookmarks, history: geckoHistory, tabs: geckoTabs, cookies: true },
  safari: { bookmarks: safariBookmarks, history: safariHistory },
};

async function runImport(src, what, data, ses) {
  const result = { bookmarks: 0, history: 0, tabs: [], cookies: 0, errors: [] };
  const attempt = async (key, fn) => {
    try { await fn(); } catch (err) { result.errors.push(`${key}: ${err.message}`); }
  };
  const read = READERS[src.kind] || {};
  what = Object.fromEntries(Object.entries(what).map(([k, v]) => [k, v && src.has[k] && Boolean(read[k])]));
  if (what.bookmarks) await attempt('Bookmarks', () => { result.bookmarks = data.mergeBookmarks(read.bookmarks(src)); });
  if (what.history) await attempt('History', () => { result.history = data.mergeHistory(read.history(src)); });
  if (what.tabs) await attempt('Open tabs', () => { result.tabs = read.tabs(src); });
  if (what.cookies) await attempt('Cookies', async () => { result.cookies = await importCookies(src, ses); });
  return result;
}

// Just the bookmarks bar of a Chromium browser (Chrome, Edge, Brave…), with its folders relative to the bar.
function chromiumBookmarksBar(src) {
  const json = JSON.parse(fs.readFileSync(path.join(src.path, 'Bookmarks'), 'utf8'));
  const out = [];
  const visit = (node, folder) => {
    for (const child of node.children || []) {
      if (child.type === 'url') out.push({ title: child.name, url: child.url, folder, added: webkitToMs(child.date_added) });
      else if (child.type === 'folder') visit(child, folder ? `${folder}/${child.name}` : child.name);
    }
  };
  if (json.roots?.bookmark_bar) visit(json.roots.bookmark_bar, '');
  return out;
}

module.exports = { detect, runImport, passwordsFromCsv, bookmarksFromHtml, decodeMozLz4, chromiumBookmarksBar, readSnss, safariBookmarks, safariHistory, arcTabs };
