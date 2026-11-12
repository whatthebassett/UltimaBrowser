// Chrome extensions: install from the Chrome Web Store or an unpacked folder, remember them, and load
// them into every session (shared and per-space). Electron loads unpacked extensions only and forgets
// them on exit, so Ultima keeps its own copies and registry under userData/extensions.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { net } = require('electron');
const { JsonStore } = require('./store');

const UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
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
// Content scripts also get storage.sync backed by storage.local, as extension pages do (extension-compat.js):
// Electron refuses sync there, and Vimium's content script then never starts.
const CHROME_LIKE_MARK = '/*ultima:chrome-like:2*/';
const CHROME_LIKE_SHIM = `${CHROME_LIKE_MARK}(function(){try{if(typeof browser!=="undefined"&&typeof chrome!=="undefined"&&browser!==chrome){`
  + 'delete globalThis.browser;if(typeof browser!=="undefined")Object.defineProperty(globalThis,"browser",{value:undefined,configurable:true,writable:true});'
  + '}var s=typeof chrome!=="undefined"&&chrome.storage,l=s&&s.local;if(l&&location.protocol!=="chrome-extension:"){'
  + 'var m=function(f){return typeof l[f]==="function"?l[f].bind(l):undefined};'
  + 'Object.defineProperty(s,"sync",{value:{get:m("get"),set:m("set"),remove:m("remove"),clear:m("clear"),getBytesInUse:m("getBytesInUse"),getKeys:m("getKeys"),'
  + 'onChanged:l.onChanged,QUOTA_BYTES:102400,QUOTA_BYTES_PER_ITEM:8192,MAX_ITEMS:512},configurable:true,enumerable:true});'
  + '}}catch(e){}})();';
// the first version (hiding `browser` only), swapped for the current one in copies installed with it
const CHROME_LIKE_SHIM_1 = '/*ultima:chrome-like*/(function(){try{if(typeof browser!=="undefined"&&typeof chrome!=="undefined"&&browser!==chrome){'
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

// Files a background worker loads: its script and what that imports. Rewriting any of them makes Chromium install a
// new version of the worker beside the running one, which breaks the extension until Ultima restarts.
function workerFiles(dir, manifest) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [/import\s[^'"]*?['"]([^'"]+)['"]/g, /import\(\s*['"]([^'"]+)['"]/g, /importScripts\(([^)]*)\)/g]) {
      for (const [, spec] of src.matchAll(re)) {
        for (const f of spec.match(/[\w./-]+\.m?js/g) || []) visit(f.startsWith('/') ? path.join(dir, f) : path.resolve(path.dirname(file), f));
      }
    }
  };
  if (manifest.background?.service_worker) visit(path.resolve(dir, manifest.background.service_worker.replace(/^\//, '')));
  return seen;
}

// The manifest's content scripts that no background worker loads: the files the first version's copies are updated in
// (the shim in any one of them reaches all of an extension's content scripts in a page, which share one world).
function contentScriptFiles(dir) {
  try {
    const manifest = readManifest(dir);
    const worker = workerFiles(dir, manifest);
    return new Set((manifest.content_scripts || []).flatMap((c) => c.js || [])
      .map((f) => path.resolve(dir, f.replace(/^\//, ''))).filter((f) => !worker.has(f)));
  } catch { return new Set(); }
}

function makeChromeLike(dir) {
  let contentScripts = null; // worked out only for copies that still have the first version
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!/\.(m?js)$/i.test(f.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (src.includes(CHROME_LIKE_MARK)) continue;
      if (src.includes(CHROME_LIKE_SHIM_1)) {
        if ((contentScripts ||= contentScriptFiles(dir)).has(path.resolve(p))) fs.writeFileSync(p, src.replace(CHROME_LIKE_SHIM_1, CHROME_LIKE_SHIM));
        continue;
      }
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

// "1.10.2" is newer than "1.9"
function isNewer(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
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
    this.applyUpdates();
    // extensions installed before the Chrome-like fix get it now, once (reading every file of every extension at each
    // start held Ultima up); installs and updates get it as they're unpacked
    let fixed = false;
    for (const e of this.list) {
      if (e.source !== 'webstore' || e.chromeLike === CHROME_LIKE_MARK) continue;
      try { makeChromeLike(e.path); e.chromeLike = CHROME_LIKE_MARK; fixed = true; } catch { /* folder missing: reported on load */ }
    }
    if (fixed) this.registry.save();
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
      sidePanel: manifest.side_panel?.default_path || (manifest.permissions || []).includes('sidePanel') || null,
      hasWorker: Boolean(manifest.background?.service_worker),
      enabled: entry.enabled !== false,
      pinned: Boolean(entry.pinned),
      source: entry.source,
      error: entry.error || null,
      unsupported: entry.unsupported || [],
      updateReady: entry.updateReady || null,
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
    // Right after loading, the worker is still registering and starting it fails, so keep trying for a while. Not
    // at once, and not once the worker has asked: starting a worker while a new version registers can leave the old
    // one running beside it, whose calls then fail ("No SW").
    const tell = (tries) => {
      if (!this.installedNews.get(ses)?.has(ext.id)) return; // the worker asked for it itself
      ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}/`)
        .then((worker) => setTimeout(() => {
          const news = this.takeInstalled(ses, ext.id);
          if (news) try { worker.send('ultima:ext-event', 'runtime.onInstalled', [news]); } catch { /* stopped */ }
        }, 1000))
        .catch(() => { if (tries > 0) setTimeout(() => tell(tries - 1), 250); });
    };
    setTimeout(() => tell(40), 2000);
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
    if (existing) { this.unloadEverywhere(existing); Object.assign(existing, entry, { unsupported: [], menus: [] }); } else this.list.push(entry);
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
    // Windows refuses to move a folder while something still has its new files open (antivirus scanning them,
    // or the old copy's files just let go), so try again for a few seconds before giving up
    for (let tries = 0; ; tries += 1) {
      try { fs.renameSync(staging, dest); break; } catch (err) {
        if (tries >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) { fs.rmSync(staging, { recursive: true, force: true }); throw err; }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return this.add({ id, path: dest, source: 'webstore', enabled: true, pinned: prev?.pinned ?? true });
  }

  // ---- updates ----
  // Like Chrome, Ultima keeps Web Store extensions up to date: it asks the store which have a newer version every few
  // hours and downloads them. A running extension isn't swapped under you (an unlocked Bitwarden would lock): the new
  // version waits in <id>.update and takes its place the next time Ultima starts, before anything loads.
  // Returns the names of extensions with an update waiting.
  async checkForUpdates() {
    const store = this.list.filter((e) => e.source === 'webstore');
    if (store.length) {
      const apps = store.map((e) => `x=${encodeURIComponent(`id=${e.id}&v=${this.manifestOf(e).version || '0'}&uc`)}`).join('&');
      const res = await net.fetch(`${UPDATE_URL}?response=updatecheck&prodversion=${process.versions.chrome}&acceptformat=crx3&${apps}`);
      if (!res.ok) throw new Error(`The Chrome Web Store didn’t answer (HTTP ${res.status}).`);
      const xml = await res.text();
      for (const [, id, body] of xml.matchAll(/<app\s[^>]*appid="([a-p]{32})"[^>]*>([\s\S]*?)<\/app>/g)) {
        const tag = body.match(/<updatecheck\s[^>]*>/)?.[0] || '';
        const attr = (name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&');
        const entry = store.find((e) => e.id === id);
        const version = attr('version');
        if (!entry || attr('status') !== 'ok' || !version || !attr('codebase')) continue;
        if (!isNewer(version, this.manifestOf(entry).version || '0') || entry.updateReady === version) continue;
        try { await this.stageUpdate(entry, attr('codebase'), version); } catch { /* tried again next time */ }
      }
    }
    return this.list.filter((e) => e.updateReady).map((e) => this.info(e).name);
  }

  async stageUpdate(entry, url, version) {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const staging = path.join(this.dir, `${entry.id}.update`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      unzipTo(zipFromCrx(buf), staging);
      makeChromeLike(staging);
      if (readManifest(staging).version !== version) throw new Error('The download isn’t the version the store offered');
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
    entry.updateReady = version;
    this.registry.flush();
  }

  // At start-up, before any extension loads: the downloaded versions take the old ones' place (same folder, so the
  // extension keeps its id and its data). One that can't be moved yet is tried again next time.
  applyUpdates() {
    for (const entry of this.list) {
      if (!entry.updateReady) continue;
      const staging = path.join(this.dir, `${entry.id}.update`);
      if (!fs.existsSync(staging)) { delete entry.updateReady; continue; }
      const old = `${entry.path}.old`;
      try {
        fs.rmSync(old, { recursive: true, force: true });
        if (fs.existsSync(entry.path)) fs.renameSync(entry.path, old);
        fs.renameSync(staging, entry.path);
        fs.rmSync(old, { recursive: true, force: true });
        delete entry.updateReady;
        entry.unsupported = []; // the new version may not need what the old one did
        entry.menus = []; // and makes its own menu items
      } catch {
        if (!fs.existsSync(entry.path) && fs.existsSync(old)) { try { fs.renameSync(old, entry.path); } catch { /* left for next time */ } }
      }
    }
    this.registry.flush();
  }

  // An update you start yourself (Settings → Extensions): the downloaded version takes the old one's place now rather
  // than at the next start. The extension stops and starts again on the way (what it had open, like an unlocked
  // vault, closes), as when it's installed again: unloaded first, so no two versions of its worker ever run at once.
  async updateNow(id) {
    const entry = this.list.find((e) => e.id === id);
    if (!entry?.updateReady) return entry ? this.describe(entry) : null;
    const staging = path.join(this.dir, `${entry.id}.update`);
    if (!fs.existsSync(staging)) { delete entry.updateReady; this.registry.flush(); return this.describe(entry); }
    this.unloadEverywhere(entry);
    const old = `${entry.path}.old`;
    // Windows won't move a folder while something still has its files open (the extension just letting go of them, or
    // an antivirus scanning the new ones), so try again for a few seconds
    for (let tries = 0; ; tries += 1) {
      try {
        fs.rmSync(old, { recursive: true, force: true });
        if (fs.existsSync(entry.path)) fs.renameSync(entry.path, old);
        fs.renameSync(staging, entry.path);
        break;
      } catch (err) {
        if (!fs.existsSync(entry.path) && fs.existsSync(old)) { try { fs.renameSync(old, entry.path); } catch { /* left for next start */ } }
        if (tries >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
          if (entry.enabled !== false) await this.loadEverywhere(entry); // the old version, back as it was
          throw new Error('The update couldn’t be put in place. It will be tried again when Ultima restarts.');
        }
        await new Promise((r) => { setTimeout(r, 250); });
      }
    }
    try { fs.rmSync(old, { recursive: true, force: true }); } catch { /* removed at the next update */ }
    delete entry.updateReady;
    entry.unsupported = []; // the new version may not need what the old one did
    entry.menus = []; // and makes its own menu items
    this.infoCache?.delete(entry.id);
    if (entry.enabled !== false) await this.loadEverywhere(entry);
    this.registry.flush();
    return this.describe(entry);
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

  // Text from the manifest in the extension's language ("__MSG_name__" → its message)
  textOf(entry, text) { return localize(entry.path, this.manifestOf(entry), text); }

  // The manifest as installed (read from disk; Electron's copy is per session)
  manifestOf(entry) {
    try { return readManifest(entry.path); } catch { return {}; }
  }

  // Right-click menu items (chrome.contextMenus), kept with the extension as Chrome keeps them across restarts:
  // extensions create them once, when installed. A new version starts without them and makes its own.
  menusOf(entry) {
    if (!Array.isArray(entry.menus)) entry.menus = [];
    return entry.menus;
  }

  saveMenus() { this.registry.save(); }

  // The keys you chose for an extension's commands (chrome.commands): a combo, or '' for none
  setShortcut(entry, name, combo) {
    entry.shortcuts ||= {};
    entry.shortcuts[name] = combo;
    this.registry.flush();
  }

  // sidePanel.setPanelBehavior({ openPanelOnActionClick }): kept, as Chrome keeps it, for the toolbar button
  setSidePanelOnClick(entry, on) {
    if (Boolean(entry.sidePanelOnClick) === on) return;
    entry.sidePanelOnClick = on;
    this.registry.flush();
  }

  // An extension used an API Ultima only stands in for. Kept until it is installed again (a new version may not).
  // True when it is news.
  noteUnsupported(runtimeId, name) {
    const entry = this.list.find((e) => e.runtimeId === runtimeId);
    if (!entry || entry.unsupported?.includes(name) || (entry.unsupported?.length ?? 0) >= 40) return false;
    (entry.unsupported ||= []).push(name);
    this.registry.flush();
    return true;
  }

  // The extension's id inside a given session (needed for chrome-extension:// URLs there).
  runtimeIdFor(id, key) {
    return this.loaded.get(`${key}|${id}`)?.id || this.list.find((e) => e.id === id)?.runtimeId || null;
  }
}

module.exports = { ExtensionManager, STORE_DETAIL };
