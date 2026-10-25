// Chrome extensions: install from the Chrome Web Store or an unpacked folder, remember them, and load
// them into every session (shared and per-space). Electron loads unpacked extensions only and forgets
// them on exit, so Ultima keeps its own copies and registry under userData/extensions.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { net } = require('electron');
const { JsonStore } = require('./store');

const STORE_DETAIL = /^https:\/\/(?:chromewebstore\.google\.com\/detail|chrome\.google\.com\/webstore\/detail)\/(?:[^/]+\/)?([a-p]{32})/i;
const ID_ONLY = /^[a-p]{32}$/i;

// ---------- CRX + ZIP ----------
// CRX3: "Cr24" | version | header length | protobuf header | zip.  CRX2: "Cr24" | 2 | key length | signature length | key | sig | zip.
function zipFromCrx(buf) {
  if (buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('Not a Chrome extension package');
  const version = buf.readUInt32LE(4);
  if (version === 3) return buf.subarray(12 + buf.readUInt32LE(8));
  if (version === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  throw new Error(`Unsupported package version ${version}`);
}

// Minimal unzip (stored + deflate), refusing any path that would land outside `dest`.
function unzipTo(zip, dest) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('The extension package is damaged');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('The extension package is damaged');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Unsafe path in package: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported compression in package (${method})`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

// ---------- make Web Store extensions see Chrome ----------
// Electron defines a Firefox-style `browser` object next to `chrome`; Chrome doesn't. Extensions use it to detect
// Firefox (Bitwarden then runs its Firefox code, uBlock Origin Lite reads browser.commands and crashes). The
// content-script sandbox can't be reached from outside, so every script in Ultima's own copy of a Web Store extension
// starts by hiding `browser` (on its first line, so line numbers in error reports are unchanged).
const CHROME_LIKE_MARK = '/*ultima:chrome-like*/';
const CHROME_LIKE_SHIM = `${CHROME_LIKE_MARK}(function(){try{if(typeof browser!=="undefined"&&typeof chrome!=="undefined"&&browser!==chrome){`
  + 'delete globalThis.browser;if(typeof browser!=="undefined")Object.defineProperty(globalThis,"browser",{value:undefined,configurable:true,writable:true});'
  + '}}catch(e){}})();';

// End of a leading "use strict" directive (after any BOM, whitespace and comments), or -1 if there isn't one.
// A plain scan: a regular expression here can backtrack for minutes on comment-heavy files (uBlock Origin's).
function strictDirectiveEnd(src) {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src.startsWith('//', i)) {
      const n = src.indexOf('\n', i);
      if (n < 0) return -1;
      i = n + 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 2;
    } else break;
  }
  const m = /^(["'])use strict\1;?/.exec(src.slice(i, i + 14));
  return m ? i + m[0].length : -1;
}

function makeChromeLike(dir) {
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!/\.(m?js)$/i.test(f.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (src.includes(CHROME_LIKE_MARK)) continue;
      // keep a leading "use strict" directive first, or the file would silently lose strict mode
      const at = strictDirectiveEnd(src);
      fs.writeFileSync(p, at >= 0 ? src.slice(0, at) + CHROME_LIKE_SHIM + src.slice(at) : CHROME_LIKE_SHIM + src);
    }
  };
  walk(dir);
}

// ---------- manifest helpers ----------
function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
}

// "__MSG_appName__" → the text from _locales/<lang>/messages.json
function localize(dir, manifest, text) {
  const m = typeof text === 'string' && text.match(/^__MSG_(.+)__$/);
  if (!m) return text || '';
  for (const lang of [manifest.default_locale, 'en', 'en_US'].filter(Boolean)) {
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(dir, '_locales', lang, 'messages.json'), 'utf8').replace(/^﻿/, ''));
      const hit = Object.entries(messages).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (hit) return hit[1].message;
    } catch { /* try the next locale */ }
  }
  return m[1];
}

function iconDataUrl(dir, manifest) {
  const action = manifest.action || manifest.browser_action || {};
  const sets = [action.default_icon, manifest.icons].filter((x) => x && typeof x === 'object');
  const single = typeof action.default_icon === 'string' ? action.default_icon : null;
  let file = single;
  for (const set of sets) {
    const sizes = Object.keys(set).map(Number).sort((a, b) => a - b);
    const best = sizes.find((s) => s >= 32) || sizes[sizes.length - 1];
    if (best) { file = set[best]; break; }
  }
  if (!file) return '';
  try {
    const full = path.join(dir, file.replace(/^\//, ''));
    const ext = path.extname(full).slice(1).toLowerCase() || 'png';
    return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${fs.readFileSync(full).toString('base64')}`;
  } catch { return ''; }
}

// ---------- manager ----------
class ExtensionManager {
  constructor(userData) {
    this.dir = path.join(userData, 'extensions');
    fs.mkdirSync(this.dir, { recursive: true });
    this.registry = new JsonStore(userData, 'extensions', []);
    this.sessions = new Set();
    this.loaded = new Map(); // `${sessionKey}|${id}` -> Electron extension
    this.installedNews = new WeakMap(); // session -> Map(runtime id -> onInstalled details not yet delivered)
    // extensions installed before the Chrome-like fix get it now (already-fixed files are skipped)
    for (const e of this.list) {
      if (e.source === 'webstore') { try { makeChromeLike(e.path); } catch { /* folder missing: reported on load */ } }
    }
  }

  get list() { return this.registry.data; }

  // What Ultima needs on every page event (popup path, background worker, name), read from disk once per extension.
  // Cleared when an extension is (re)installed or removed.
  info(entry) {
    this.infoCache ||= new Map();
    if (!this.infoCache.has(entry.id)) {
      let manifest = {};
      try { manifest = readManifest(entry.path); } catch { /* folder missing */ }
      const action = manifest.action || manifest.browser_action || {};
      this.infoCache.set(entry.id, {
        name: localize(entry.path, manifest, manifest.name) || entry.id,
        popup: action.default_popup || null,
        hasWorker: Boolean(manifest.background?.service_worker),
      });
    }
    return this.infoCache.get(entry.id);
  }

  describe(entry) {
    let manifest = {};
    try { manifest = readManifest(entry.path); } catch { /* folder missing */ }
    const action = manifest.action || manifest.browser_action || {};
    const loadedIn = [...this.loaded.entries()].find(([k]) => k.endsWith(`|${entry.id}`))?.[1];
    return {
      id: entry.id,
      runtimeId: loadedIn?.id || entry.runtimeId || null,
      name: localize(entry.path, manifest, manifest.name) || entry.id,
      description: localize(entry.path, manifest, manifest.description),
      version: manifest.version || '',
      manifestVersion: manifest.manifest_version,
      icon: iconDataUrl(entry.path, manifest),
      popup: action.default_popup || null,
      optionsPage: manifest.options_ui?.page || manifest.options_page || null,
      hasWorker: Boolean(manifest.background?.service_worker),
      enabled: entry.enabled !== false,
      pinned: Boolean(entry.pinned),
      source: entry.source,
      error: entry.error || null,
    };
  }

  all() { return this.list.map((e) => this.describe(e)); }

  // Called for every session Ultima uses; loads every enabled extension into it.
  async attach(ses, key) {
    this.sessions.add({ ses, key });
    await Promise.all(this.list.filter((e) => e.enabled !== false).map((e) => this.loadInto(ses, key, e)));
  }

  async loadInto(ses, key, entry) {
    try {
      const ext = await ses.extensions.loadExtension(entry.path, { allowFileAccess: false });
      this.loaded.set(`${key}|${entry.id}`, ext);
      entry.runtimeId = ext.id;
      entry.error = null;
      this.announceInstall(ses, key, entry, ext);
    } catch (err) {
      entry.error = err.message;
    }
    this.registry.flush(); // saved at once: an install must survive Ultima closing right after
  }

  // Electron never sends chrome.runtime.onInstalled, yet extensions set themselves up in it (Bitwarden switches on
  // its in-field menu there). Each session has its own copy of an extension's data, so each one hears "install"
  // once, and "update" when the version changes. extension-compat.js holds the event until a listener is added.
  announceInstall(ses, key, entry, ext) {
    const version = ext.version || ext.manifest?.version || '';
    entry.seen ||= {};
    const before = entry.seen[key];
    if (before === version) return;
    const details = before === undefined ? { reason: 'install' } : { reason: 'update', previousVersion: before };
    entry.seen[key] = version;
    if (!ext.manifest?.background?.service_worker) return; // no background to tell
    if (!this.installedNews.has(ses)) this.installedNews.set(ses, new Map());
    this.installedNews.get(ses).set(ext.id, details);
    // Extensions read it early (Bitwarden checks 100 ms after starting), so the worker's preload asks for it
    // itself as it starts (takeInstalled). If the worker never asks (it was already running), send it instead.
    // Right after loading, the worker is still registering and starting it fails, so keep trying for a while.
    const tell = (tries) => ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}/`)
      .then((worker) => setTimeout(() => {
        const news = this.takeInstalled(ses, ext.id);
        if (news) try { worker.send('ultima:ext-event', 'runtime.onInstalled', [news]); } catch { /* stopped */ }
      }, 1000))
      .catch(() => { if (tries > 0) setTimeout(() => tell(tries - 1), 250); });
    tell(40);
  }

  // The onInstalled details still owed to an extension's background in a session, handed over only once.
  takeInstalled(ses, runtimeId) {
    const news = this.installedNews.get(ses);
    const details = news?.get(runtimeId) || null;
    news?.delete(runtimeId);
    return details;
  }

  unloadEverywhere(entry) {
    for (const { ses, key } of this.sessions) {
      const ext = this.loaded.get(`${key}|${entry.id}`);
      if (ext) { try { ses.extensions.removeExtension(ext.id); } catch { /* already gone */ } }
      this.loaded.delete(`${key}|${entry.id}`);
    }
  }

  async loadEverywhere(entry) {
    for (const { ses, key } of this.sessions) await this.loadInto(ses, key, entry);
  }

  async add(entry) {
    this.infoCache?.delete(entry.id);
    const existing = this.list.find((e) => e.id === entry.id);
    if (existing) { this.unloadEverywhere(existing); Object.assign(existing, entry); } else this.list.push(entry);
    const saved = this.list.find((e) => e.id === entry.id);
    await this.loadEverywhere(saved);
    this.registry.flush(); // saved at once: an install must survive Ultima closing right after
    return this.describe(saved);
  }

  async installFromWebStore(input) {
    const text = String(input || '').trim();
    const id = (text.match(STORE_DETAIL)?.[1] || (ID_ONLY.test(text) ? text : '')).toLowerCase();
    if (!id) throw new Error('Paste a Chrome Web Store link or a 32-letter extension ID.');
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome}`
      + `&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`The Chrome Web Store didn’t return this extension (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('This extension isn’t available from the Chrome Web Store.');
    const dest = path.join(this.dir, id);
    const staging = `${dest}.new`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      unzipTo(zipFromCrx(buf), staging);
      makeChromeLike(staging);
      readManifest(staging); // must have a valid manifest
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
    const prev = this.list.find((e) => e.id === id);
    if (prev) this.unloadEverywhere(prev);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staging, dest);
    return this.add({ id, path: dest, source: 'webstore', enabled: true, pinned: prev?.pinned ?? true });
  }

  // A developer's unpacked extension stays where it is, so edits take effect on reload.
  async installUnpacked(dir) {
    const manifest = readManifest(dir);
    if (!manifest.manifest_version) throw new Error('That folder’s manifest.json has no manifest_version.');
    const id = `local-${crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 16)}`;
    return this.add({ id, path: path.resolve(dir), source: 'unpacked', enabled: true, pinned: true });
  }

  async setEnabled(id, enabled) {
    const entry = this.list.find((e) => e.id === id);
    if (!entry) return null;
    entry.enabled = enabled;
    if (enabled) await this.loadEverywhere(entry); else this.unloadEverywhere(entry);
    this.registry.flush(); // saved at once: an install must survive Ultima closing right after
    return this.describe(entry);
  }

  setPinned(id, pinned) {
    const entry = this.list.find((e) => e.id === id);
    if (!entry) return null;
    entry.pinned = pinned;
    this.registry.flush(); // saved at once: an install must survive Ultima closing right after
    return this.describe(entry);
  }

  remove(id) {
    this.infoCache?.delete(id);
    const entry = this.list.find((e) => e.id === id);
    if (!entry) return;
    this.unloadEverywhere(entry);
    if (entry.source === 'webstore') fs.rmSync(entry.path, { recursive: true, force: true });
    this.registry.data = this.list.filter((e) => e !== entry);
    this.registry.flush(); // saved at once: an install must survive Ultima closing right after
  }

  // The extension's id inside a given session (needed for chrome-extension:// URLs there).
  runtimeIdFor(id, key) {
    return this.loaded.get(`${key}|${id}`)?.id || this.list.find((e) => e.id === id)?.runtimeId || null;
  }
}

module.exports = { ExtensionManager, STORE_DETAIL };
