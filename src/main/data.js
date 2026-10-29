// History, bookmarks and passwords owned by the main process.
const crypto = require('crypto');
const { safeStorage } = require('electron');
const { JsonStore } = require('./store');
const { baseDomain } = require('./blocker');

const HISTORY_LIMIT = 50000;
const uid = () => crypto.randomBytes(8).toString('hex');

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function recordable(url) {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

// Every token must appear in the haystack; earlier/host matches score higher.
function matchScore(tokens, title, url) {
  const t = (title || '').toLowerCase();
  const u = url.toLowerCase();
  const host = hostOf(url);
  let score = 0;
  for (const tok of tokens) {
    if (host.startsWith(tok)) score += 30;
    else if (host.includes(tok)) score += 15;
    else if (t.includes(tok)) score += t.startsWith(tok) ? 12 : 8;
    else if (u.includes(tok)) score += 4;
    else return 0;
  }
  return score;
}

// ---- matching logins to pages, as Bitwarden does ----
const MATCHES = ['domain', 'host', 'starts', 'exact', 'never'];
const withScheme = (u) => (/^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`);
function originOf(u) {
  try {
    const url = new URL(withScheme(u));
    return /^https?:$/.test(url.protocol) ? url.origin : '';
  } catch { return ''; }
}
function pageOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch { return null; }
}
// How well a login's website matches a page: 0 not at all, 1 the same base domain, 2 the same host, 3 the same address.
function uriMatch({ uri, match }, page) {
  if (match === 'never') return 0;
  if (match === 'exact') return uri === page.href ? 3 : 0;
  if (match === 'starts') return page.href.startsWith(uri) ? 3 : 0;
  let u;
  try { u = new URL(withScheme(uri)); } catch { return 0; }
  if (!/^https?:$/.test(u.protocol)) return 0;
  if (u.host === page.host) return 2;
  if (match === 'host') return 0;
  return baseDomain(u.hostname) === baseDomain(page.hostname) ? 1 : 0;
}

class BrowserData {
  constructor(dir) {
    this.historyStore = new JsonStore(dir, 'history', []);
    this.bookmarkStore = new JsonStore(dir, 'bookmarks', []);
    this.passwordStore = new JsonStore(dir, 'passwords', []);
    this.passwordFolders = new JsonStore(dir, 'password-folders', []);
    this.migrateLogins();
    this.migrateBookmarks();
    this.history = new Map(this.historyStore.data.map((h) => [h.url, h]));
  }

  // ---- history ----
  saveHistory() {
    this.historyStore.data = [...this.history.values()];
    this.historyStore.save(1500);
  }

  addHistory({ url, title, visit = true }) {
    if (!url || !recordable(url)) return;
    const existing = this.history.get(url);
    if (existing) {
      if (title) existing.title = title;
      if (visit) { existing.visits += 1; existing.lastVisit = Date.now(); }
    } else {
      this.history.set(url, { url, title: title || url, visits: 1, lastVisit: Date.now() });
      if (this.history.size > HISTORY_LIMIT) this.trimHistory();
    }
    this.saveHistory();
  }

  trimHistory() {
    const sorted = [...this.history.values()].sort((a, b) => b.lastVisit - a.lastVisit);
    this.history = new Map(sorted.slice(0, HISTORY_LIMIT).map((h) => [h.url, h]));
  }

  mergeHistory(entries) {
    let added = 0;
    for (const e of entries) {
      if (!e.url || !recordable(e.url)) continue;
      const cur = this.history.get(e.url);
      if (cur) {
        cur.visits = Math.max(cur.visits, e.visits || 1);
        cur.lastVisit = Math.max(cur.lastVisit, e.lastVisit || 0);
        if (!cur.title || cur.title === cur.url) cur.title = e.title || cur.title;
      } else {
        this.history.set(e.url, {
          url: e.url, title: e.title || e.url, visits: e.visits || 1, lastVisit: e.lastVisit || Date.now(),
        });
        added += 1;
      }
    }
    if (this.history.size > HISTORY_LIMIT) this.trimHistory();
    this.saveHistory();
    return added;
  }

  listHistory({ query = '', limit = 200, offset = 0 } = {}) {
    let items = [...this.history.values()];
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) items = items.filter((h) => matchScore(tokens, h.title, h.url) > 0);
    items.sort((a, b) => b.lastVisit - a.lastVisit);
    return { total: items.length, items: items.slice(offset, offset + limit) };
  }

  deleteHistory(url) {
    this.history.delete(url);
    this.saveHistory();
  }

  clearHistory() {
    this.history.clear();
    this.saveHistory();
  }

  topSites(limit = 8) {
    const byHost = new Map();
    for (const h of this.history.values()) {
      const host = hostOf(h.url);
      if (!host) continue;
      const cur = byHost.get(host);
      const weight = h.visits + (Date.now() - h.lastVisit < 7 * 864e5 ? 3 : 0);
      if (!cur) byHost.set(host, { host, url: `${new URL(h.url).origin}/`, title: h.title, weight });
      else cur.weight += weight;
    }
    return [...byHost.values()].sort((a, b) => b.weight - a.weight).slice(0, limit);
  }

  // ---- bookmarks ----
  // A tree, like Chrome's: nodes { id, type: 'folder' | 'url', title, url?, parent, added } kept in one array, where
  // the array order is the order within each folder. Two roots: the bookmarks bar and "Other bookmarks".
  get nodes() { return this.bookmarkStore.data; }

  // Bookmarks from before folders were real kept a "folder" path instead: the ones starred in Ultima go on the bar,
  // imported ones keep their folders under Other bookmarks.
  migrateBookmarks() {
    const list = this.bookmarkStore.data;
    if (list.length && list.every((n) => n.type)) { if (this.ensureBookmarkRoots()) this.bookmarkStore.save(); return; }
    const old = list.filter((n) => !n.type);
    this.bookmarkStore.data = list.filter((n) => n.type);
    this.ensureBookmarkRoots();
    for (const b of old) {
      const parent = b.folder === 'Ultima' ? 'bar' : this.folderPath('other', String(b.folder || '').split('/'));
      this.nodes.push({ id: b.id || uid(), type: 'url', title: b.title || b.url, url: b.url, parent, added: b.added || Date.now() });
    }
    this.bookmarkStore.save();
  }

  // Bookmarks are called Waypoints in Ultima; the two top folders had other names before 0.2.0 (and "Other waypoints"
  // in early 0.2.0 builds)
  ensureBookmarkRoots() {
    const roots = [['bar', 'Waypoints bar', ['Bookmarks bar']], ['other', 'Other Waypoints', ['Other bookmarks', 'Other waypoints']]];
    let changed = false;
    for (const [id, title, oldTitles] of roots) {
      const root = this.nodes.find((n) => n.id === id);
      if (!root) { this.nodes.unshift({ id, type: 'folder', title, parent: null, added: Date.now() }); changed = true; }
      else if (oldTitles.includes(root.title)) { root.title = title; changed = true; }
    }
    return changed;
  }

  // the folder at `names` under `parent`, made if missing
  folderPath(parent, names) {
    let at = parent;
    for (const name of names.map((x) => x.trim()).filter(Boolean)) {
      let f = this.nodes.find((n) => n.type === 'folder' && n.parent === at && n.title === name);
      if (!f) { f = { id: uid(), type: 'folder', title: name, parent: at, added: Date.now() }; this.nodes.push(f); }
      at = f.id;
    }
    return at;
  }

  pathOf(id) {
    const names = [];
    for (let n = this.nodes.find((x) => x.id === id); n; n = this.nodes.find((x) => x.id === n.parent)) names.unshift(n.title);
    return names.join('/');
  }

  // every saved page, with its folder as a path (search, the bookmarks page)
  get bookmarks() {
    return this.nodes.filter((n) => n.type === 'url').map((n) => ({ ...n, folder: this.pathOf(n.parent) }));
  }

  bookmarkTree() { return this.nodes; }

  isBookmarked(url) { return this.nodes.some((n) => n.type === 'url' && n.url === url); }

  static favicon(f) { return typeof f === 'string' && f.length < 4000 && /^(https?:|data:image\/)/i.test(f) ? f : undefined; }

  changedBookmarks() {
    this.bookmarkStore.save();
    this.onBookmarksChanged?.();
  }

  // the star: like Chrome, a new bookmark goes at the end of the bookmarks bar
  toggleBookmark({ url, title, favicon }) {
    const had = this.isBookmarked(url);
    if (had) this.bookmarkStore.data = this.nodes.filter((n) => !(n.type === 'url' && n.url === url));
    else this.nodes.push({ id: uid(), type: 'url', title: title || url, url, favicon: BrowserData.favicon(favicon), parent: 'bar', added: Date.now() });
    this.changedBookmarks();
    return !had;
  }

  // puts `node` among `parent`'s children at `index` (the end when missing)
  placeBookmark(node, parent, index) {
    const siblings = this.nodes.filter((n) => n.parent === parent && n !== node);
    const before = Number.isInteger(index) && index >= 0 ? siblings[index] : undefined;
    node.parent = parent;
    this.bookmarkStore.data = this.nodes.filter((n) => n !== node);
    const at = before ? this.nodes.indexOf(before) : this.nodes.length;
    this.nodes.splice(at, 0, node);
  }

  isFolder(id) { return this.nodes.some((n) => n.id === id && n.type === 'folder'); }

  addBookmark({ url, title, parent = 'bar', index, favicon }) {
    if (!url || !this.isFolder(parent)) return null;
    const node = { id: uid(), type: 'url', title: title || url, url, favicon: BrowserData.favicon(favicon), added: Date.now() };
    this.placeBookmark(node, parent, index);
    this.changedBookmarks();
    return node;
  }

  addBookmarkFolder({ title, parent = 'bar', index }) {
    if (!this.isFolder(parent)) return null;
    const node = { id: uid(), type: 'folder', title: title || 'New folder', added: Date.now() };
    this.placeBookmark(node, parent, index);
    this.changedBookmarks();
    return node;
  }

  updateBookmark(id, { title, url }) {
    const node = this.nodes.find((n) => n.id === id);
    if (!node || node.parent === null) return null;
    if (typeof title === 'string' && title.trim()) node.title = title.trim();
    if (node.type === 'url' && typeof url === 'string' && url.trim()) node.url = url.trim();
    this.changedBookmarks();
    return node;
  }

  moveBookmark(id, { parent, index }) {
    const node = this.nodes.find((n) => n.id === id);
    if (!node || node.parent === null || !this.isFolder(parent)) return false;
    // a folder can't go inside itself
    for (let p = parent; p; p = this.nodes.find((n) => n.id === p)?.parent) if (p === id) return false;
    this.placeBookmark(node, parent, index);
    this.changedBookmarks();
    return true;
  }

  removeBookmark(id) {
    const gone = new Set([id]);
    if (this.nodes.some((n) => n.id === id && n.parent === null)) return; // the roots stay
    for (let grew = true; grew;) {
      grew = false;
      for (const n of this.nodes) if (!gone.has(n.id) && gone.has(n.parent)) { gone.add(n.id); grew = true; }
    }
    this.bookmarkStore.data = this.nodes.filter((n) => !gone.has(n.id));
    this.changedBookmarks();
  }

  // Imported bookmarks keep their folders, under `root` (Other bookmarks, or the bar for a bookmarks-bar import).
  mergeBookmarks(entries, root = 'other') {
    let added = 0;
    for (const e of entries) {
      if (!e.url || !/^(https?|file|ftp):/i.test(e.url)) continue;
      const parent = this.folderPath(root, String(e.folder || '').split('/'));
      if (this.nodes.some((n) => n.type === 'url' && n.parent === parent && n.url === e.url)) continue;
      this.nodes.push({ id: uid(), type: 'url', title: e.title || e.url, url: e.url, parent, added: e.added || Date.now() });
      added += 1;
    }
    this.changedBookmarks();
    return added;
  }

  // ---- palette search ----
  search(query, limit = 6) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { bookmarks: [], history: [] };
    const bookmarks = this.bookmarks
      .map((b) => ({ ...b, score: matchScore(tokens, b.title, b.url) }))
      .filter((b) => b.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const bookmarked = new Set(bookmarks.map((b) => b.url));
    const now = Date.now();
    const history = [];
    for (const h of this.history.values()) {
      if (bookmarked.has(h.url)) continue;
      const s = matchScore(tokens, h.title, h.url);
      if (!s) continue;
      const recency = Math.max(0, 10 - (now - h.lastVisit) / 864e5);
      history.push({ ...h, score: s + Math.log2(1 + h.visits) * 4 + recency });
    }
    history.sort((a, b) => b.score - a.score);
    return { bookmarks, history: history.slice(0, limit) };
  }

  // ---- passwords: the vault (encrypted at rest with the OS keychain via safeStorage) ----
  // A login: { id, name, username, secret, uris: [{ uri, match? }], notes?, folder, favorite, created, updated, used,
  // history: [{ secret, date }], source }. `secret`, `notes` and old passwords are encrypted; `origin` (the first
  // website's) is kept for older versions of Ultima. `match` is how a website matches pages, as in Bitwarden: missing =
  // the base domain (accounts.example.com fills on example.com), or host, starts, exact or never.
  async encrypt(text) {
    if (await safeStorage.isAsyncEncryptionAvailable()) return { enc: true, v: (await safeStorage.encryptStringAsync(text)).toString('base64') };
    return { enc: false, v: Buffer.from(text).toString('base64') };
  }

  async decrypt(blob) {
    if (!blob) return '';
    const buf = Buffer.from(blob.v, 'base64');
    return blob.enc ? (await safeStorage.decryptStringAsync(buf)).result : buf.toString();
  }

  get logins() { return this.passwordStore.data; }

  // logins from before the vault had only { id, origin, username, secret, source }
  migrateLogins() {
    let changed = false;
    for (const p of this.logins) {
      if (Array.isArray(p.uris)) continue;
      Object.assign(p, {
        uris: p.origin ? [{ uri: p.origin }] : [], name: hostOf(p.origin || '') || p.origin || 'Login', folder: null, favorite: false,
        created: p.created || Date.now(), history: [],
      });
      p.updated = p.created;
      changed = true;
    }
    if (changed) this.passwordStore.save();
  }

  static publicLogin(p) {
    return {
      id: p.id, name: p.name, username: p.username, uris: p.uris, folder: p.folder || null, favorite: Boolean(p.favorite),
      created: p.created, updated: p.updated, used: p.used || 0, source: p.source, hasNotes: Boolean(p.notes), historyCount: (p.history || []).length,
    };
  }

  listPasswords() { return this.logins.map(BrowserData.publicLogin); }

  // the logins whose websites match a page: the closest matches, then the ones used last, first
  passwordsFor(url) {
    const page = pageOf(url);
    if (!page) return [];
    return this.logins.map((p) => ({ p, score: Math.max(0, ...p.uris.map((u) => uriMatch(u, page))) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.p.used || 0) - (a.p.used || 0) || String(a.p.name).localeCompare(b.p.name))
      .map((x) => BrowserData.publicLogin(x.p));
  }

  async getPassword(id) {
    const p = this.logins.find((x) => x.id === id);
    return p ? { username: p.username, password: await this.decrypt(p.secret) } : null;
  }

  // everything about a login, decrypted (the vault's detail view)
  async getLogin(id) {
    const p = this.logins.find((x) => x.id === id);
    if (!p) return null;
    const history = [];
    for (const old of p.history || []) history.push({ password: await this.decrypt(old.secret), date: old.date });
    return { ...BrowserData.publicLogin(p), password: await this.decrypt(p.secret), notes: await this.decrypt(p.notes), history };
  }

  // Adds a login (no id) or changes one; fields left out stay as they are. A changed password goes into the login's
  // history (the last 5).
  async saveLogin(item) {
    const clean = (s, n) => String(s ?? '').slice(0, n);
    let p = item.id && this.logins.find((x) => x.id === item.id);
    const now = Date.now();
    if (!p) {
      p = { id: uid(), name: '', username: '', uris: [], folder: null, favorite: false, created: now, history: [], source: item.source || 'ultima' };
      this.logins.push(p);
    }
    if (item.password !== undefined) {
      const old = await this.decrypt(p.secret);
      const password = clean(item.password, 1000);
      if (old && old !== password) p.history = [{ secret: p.secret, date: p.updated || now }, ...(p.history || [])].slice(0, 5);
      if (old !== password || !p.secret) p.secret = await this.encrypt(password);
    }
    if (item.notes !== undefined) p.notes = item.notes ? await this.encrypt(clean(item.notes, 10000)) : null;
    if (item.username !== undefined) p.username = clean(item.username, 500);
    if (item.uris !== undefined) {
      p.uris = (Array.isArray(item.uris) ? item.uris : [])
        .map((u) => ({ uri: clean(u?.uri, 2000).trim(), ...(MATCHES.includes(u?.match) ? { match: u.match } : {}) }))
        .filter((u) => u.uri);
    }
    if (item.folder !== undefined) p.folder = this.passwordFolders.data.some((f) => f.id === item.folder) ? item.folder : null;
    if (item.favorite !== undefined) p.favorite = Boolean(item.favorite);
    p.name = clean(item.name, 200).trim() || p.name || hostOf(withScheme(p.uris[0]?.uri || '')) || 'Login';
    p.origin = originOf(p.uris[0]?.uri || '');
    p.updated = now;
    this.passwordStore.save();
    return BrowserData.publicLogin(p);
  }

  markLoginUsed(id) {
    const p = this.logins.find((x) => x.id === id);
    if (p) { p.used = Date.now(); this.passwordStore.save(3000); }
  }

  deletePassword(id) {
    this.passwordStore.data = this.logins.filter((p) => p.id !== id);
    this.passwordStore.save();
  }

  // every login (folders stay, empty)
  deleteAllPasswords() {
    const count = this.logins.length;
    this.passwordStore.data = [];
    this.passwordStore.flush();
    return count;
  }

  // Weak and reused passwords, for the vault's filters. `strength` scores a password 0–4 (pwgen.js).
  async passwordHealth(strength) {
    const byHash = new Map();
    const weak = [];
    for (const p of this.logins) {
      const pw = await this.decrypt(p.secret);
      if (!pw) continue;
      if (strength(pw).score <= 2) weak.push(p.id);
      const hash = crypto.createHash('sha256').update(pw).digest('hex');
      byHash.set(hash, [...(byHash.get(hash) || []), p.id]);
    }
    return { weak, reused: [...byHash.values()].filter((ids) => ids.length > 1).flat() };
  }

  // ---- password folders ----
  listPasswordFolders() { return this.passwordFolders.data; }

  addPasswordFolder(name) {
    const f = { id: uid(), name: String(name || '').trim().slice(0, 100) || 'New folder' };
    this.passwordFolders.data.push(f);
    this.passwordFolders.save();
    return f;
  }

  renamePasswordFolder(id, name) {
    const f = this.passwordFolders.data.find((x) => x.id === id);
    if (f && String(name || '').trim()) { f.name = String(name).trim().slice(0, 100); this.passwordFolders.save(); }
  }

  // its logins stay, in no folder
  deletePasswordFolder(id) {
    this.passwordFolders.data = this.passwordFolders.data.filter((f) => f.id !== id);
    for (const p of this.logins) if (p.folder === id) p.folder = null;
    this.passwordFolders.save();
    this.passwordStore.save();
  }

  // A CSV export from another browser or password manager: a login with the same website and username takes the new
  // password. Bitwarden's exports also bring names, notes, folders and favorites (and several websites, comma-separated).
  async mergePasswords(entries, source) {
    let added = 0;
    for (const e of entries) {
      if (!e.url || !e.password) continue;
      const uris = String(e.url).split(',').map((u) => u.trim()).filter((u) => originOf(u));
      if (!uris.length) continue;
      const origin = originOf(uris[0]);
      const existing = this.logins.find((p) => originOf(p.uris[0]?.uri || '') === origin && p.username === (e.username || ''));
      if (existing) { await this.saveLogin({ id: existing.id, password: e.password }); continue; }
      const folder = e.folder ? (this.passwordFolders.data.find((f) => f.name === e.folder) || this.addPasswordFolder(e.folder)).id : null;
      await this.saveLogin({
        name: e.name, username: e.username || '', password: e.password, notes: e.notes || '', uris: uris.map((uri) => ({ uri })),
        folder, favorite: e.favorite, source,
      });
      added += 1;
    }
    return added;
  }

  // every login, decrypted, for a CSV export
  async exportPasswords() {
    const out = [];
    for (const p of this.logins) {
      out.push({
        name: p.name, url: p.uris.map((u) => u.uri).join(','), username: p.username, password: await this.decrypt(p.secret),
        notes: await this.decrypt(p.notes), folder: this.passwordFolders.data.find((f) => f.id === p.folder)?.name || '',
      });
    }
    return out;
  }

  flush() {
    this.historyStore.data = [...this.history.values()];
    for (const s of [this.historyStore, this.bookmarkStore, this.passwordStore, this.passwordFolders]) if (s.timer) s.flush();
  }
}

module.exports = { BrowserData, hostOf };
