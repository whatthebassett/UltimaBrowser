// Detects installed browsers and reads their bookmarks, history, open tabs and cookies.
// Chromium family: Chrome, Edge, Brave, Vivaldi. Gecko family: Firefox, Zen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const HISTORY_IMPORT_LIMIT = 25000;
const home = os.homedir();
const env = (k, fallback) => process.env[k] || fallback;

function browserRoots() {
  if (process.platform === 'win32') {
    const local = env('LOCALAPPDATA', path.join(home, 'AppData', 'Local'));
    const roaming = env('APPDATA', path.join(home, 'AppData', 'Roaming'));
    return [
      { browser: 'chrome', label: 'Google Chrome', kind: 'chromium', dir: path.join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'edge', label: 'Microsoft Edge', kind: 'chromium', dir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'brave', label: 'Brave', kind: 'chromium', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { browser: 'vivaldi', label: 'Vivaldi', kind: 'chromium', dir: path.join(local, 'Vivaldi', 'User Data') },
      { browser: 'firefox', label: 'Firefox', kind: 'gecko', dir: path.join(roaming, 'Mozilla', 'Firefox') },
      { browser: 'zen', label: 'Zen', kind: 'gecko', dir: path.join(roaming, 'zen') },
    ];
  }
  if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    return [
      { browser: 'chrome', label: 'Google Chrome', kind: 'chromium', dir: path.join(support, 'Google', 'Chrome') },
      { browser: 'edge', label: 'Microsoft Edge', kind: 'chromium', dir: path.join(support, 'Microsoft Edge') },
      { browser: 'brave', label: 'Brave', kind: 'chromium', dir: path.join(support, 'BraveSoftware', 'Brave-Browser') },
      { browser: 'vivaldi', label: 'Vivaldi', kind: 'chromium', dir: path.join(support, 'Vivaldi') },
      { browser: 'firefox', label: 'Firefox', kind: 'gecko', dir: path.join(support, 'Firefox') },
      { browser: 'zen', label: 'Zen', kind: 'gecko', dir: path.join(support, 'zen') },
    ];
  }
  const config = env('XDG_CONFIG_HOME', path.join(home, '.config'));
  return [
    { browser: 'chrome', label: 'Google Chrome', kind: 'chromium', dir: path.join(config, 'google-chrome') },
    { browser: 'edge', label: 'Microsoft Edge', kind: 'chromium', dir: path.join(config, 'microsoft-edge') },
    { browser: 'brave', label: 'Brave', kind: 'chromium', dir: path.join(config, 'BraveSoftware', 'Brave-Browser') },
    { browser: 'vivaldi', label: 'Vivaldi', kind: 'chromium', dir: path.join(config, 'vivaldi') },
    { browser: 'firefox', label: 'Firefox', kind: 'gecko', dir: path.join(home, '.mozilla', 'firefox') },
    { browser: 'zen', label: 'Zen', kind: 'gecko', dir: path.join(home, '.zen') },
  ];
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
  return dirs
    .map((d) => path.join(root.dir, d))
    .filter((p) => exists(path.join(p, 'Bookmarks')) || exists(path.join(p, 'History')))
    .map((p) => {
      const dir = path.basename(p);
      return {
        profile: names[dir] || dir,
        path: p,
        has: { bookmarks: exists(path.join(p, 'Bookmarks')), history: exists(path.join(p, 'History')), tabs: false, cookies: false },
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
    const profiles = root.kind === 'chromium' ? chromiumProfiles(root) : geckoProfiles(root);
    for (const p of profiles) {
      sources.push({
        id: `${root.browser}:${p.path}`,
        browser: root.browser,
        label: root.label,
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
        throw new Error(`${path.basename(file)} is locked — close that browser and try again.`);
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

async function runImport(src, what, data, ses) {
  const result = { bookmarks: 0, history: 0, tabs: [], cookies: 0, errors: [] };
  const attempt = async (key, fn) => {
    try { await fn(); } catch (err) { result.errors.push(`${key}: ${err.message}`); }
  };
  const chromium = src.kind === 'chromium';
  what = Object.fromEntries(Object.entries(what).map(([k, v]) => [k, v && src.has[k]]));
  if (what.bookmarks) await attempt('Bookmarks', () => { result.bookmarks = data.mergeBookmarks(chromium ? chromiumBookmarks(src) : geckoBookmarks(src)); });
  if (what.history) await attempt('History', () => { result.history = data.mergeHistory(chromium ? chromiumHistory(src) : geckoHistory(src)); });
  if (what.tabs && !chromium) await attempt('Open tabs', () => { result.tabs = geckoTabs(src); });
  if (what.cookies && !chromium) await attempt('Cookies', async () => { result.cookies = await importCookies(src, ses); });
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

module.exports = { detect, runImport, passwordsFromCsv, bookmarksFromHtml, decodeMozLz4, chromiumBookmarksBar };
