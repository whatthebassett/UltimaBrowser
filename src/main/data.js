// History, bookmarks and passwords owned by the main process.
const crypto = require('crypto');
const { safeStorage } = require('electron');
const { JsonStore } = require('./store');

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

class BrowserData {
  constructor(dir) {
    this.historyStore = new JsonStore(dir, 'history', []);
    this.bookmarkStore = new JsonStore(dir, 'bookmarks', []);
    this.passwordStore = new JsonStore(dir, 'passwords', []);
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
    if (list.length && list.every((n) => n.type)) return;
    const old = list.filter((n) => !n.type);
    this.bookmarkStore.data = list.filter((n) => n.type);
    this.ensureBookmarkRoots();
    for (const b of old) {
      const parent = b.folder === 'Ultima' ? 'bar' : this.folderPath('other', String(b.folder || '').split('/'));
      this.nodes.push({ id: b.id || uid(), type: 'url', title: b.title || b.url, url: b.url, parent, added: b.added || Date.now() });
    }
    this.bookmarkStore.save();
  }

  ensureBookmarkRoots() {
    for (const [id, title] of [['bar', 'Bookmarks bar'], ['other', 'Other bookmarks']]) {
      if (!this.nodes.some((n) => n.id === id)) this.nodes.unshift({ id, type: 'folder', title, parent: null, added: Date.now() });
    }
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

  // ---- passwords (encrypted at rest with the OS keychain via safeStorage) ----
  async encrypt(text) {
    if (await safeStorage.isAsyncEncryptionAvailable()) return { enc: true, v: (await safeStorage.encryptStringAsync(text)).toString('base64') };
    return { enc: false, v: Buffer.from(text).toString('base64') };
  }

  async decrypt(blob) {
    const buf = Buffer.from(blob.v, 'base64');
    return blob.enc ? (await safeStorage.decryptStringAsync(buf)).result : buf.toString();
  }

  listPasswords() {
    return this.passwordStore.data.map(({ id, origin, username, source }) => ({ id, origin, username, source }));
  }

  passwordsFor(url) {
    const host = hostOf(url);
    if (!host) return [];
    return this.listPasswords().filter((p) => {
      const h = hostOf(p.origin);
      return h && (h === host || host.endsWith(`.${h}`) || h.endsWith(`.${host}`));
    });
  }

  async getPassword(id) {
    const p = this.passwordStore.data.find((x) => x.id === id);
    return p ? { username: p.username, password: await this.decrypt(p.secret) } : null;
  }

  deletePassword(id) {
    this.passwordStore.data = this.passwordStore.data.filter((p) => p.id !== id);
    this.passwordStore.save();
  }

  async mergePasswords(entries, source) {
    const list = this.passwordStore.data;
    let added = 0;
    for (const e of entries) {
      if (!e.url || !e.password) continue;
      let origin;
      try { origin = new URL(e.url).origin; } catch { continue; }
      if (origin === 'null') continue;
      const existing = list.find((p) => p.origin === origin && p.username === (e.username || ''));
      if (existing) { existing.secret = await this.encrypt(e.password); continue; }
      list.push({ id: uid(), origin, username: e.username || '', secret: await this.encrypt(e.password), source });
      added += 1;
    }
    this.passwordStore.save();
    return added;
  }

  flush() {
    this.historyStore.data = [...this.history.values()];
    for (const s of [this.historyStore, this.bookmarkStore, this.passwordStore]) if (s.timer) s.flush();
  }
}

module.exports = { BrowserData, hostOf };
