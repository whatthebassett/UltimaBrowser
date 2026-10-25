const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, session, Menu, clipboard, dialog, shell, webContents, webFrameMain, nativeTheme,
} = require('electron');
const { JsonStore } = require('./store');
const { BrowserData, hostOf } = require('./data');
const importer = require('./importer');
const { ExtensionManager } = require('./extensions');
const defaultBrowser = require('./defaultbrowser');
const keymap = require('../renderer/keymap');

app.setName('Ultima Browser');
app.setAppUserModelId('com.ultimabass.ultimabrowser');

const PARTITION = 'persist:ultima';
// System backdrops (Acrylic = live blur of what is behind the window, Mica = tinted wallpaper) need
// Windows 11 22H2 (build 22621); macOS gets native vibrancy. Everything else stays solid.
const BACKDROPS = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
const GLASS = BACKDROPS || process.platform === 'darwin';
const CLEAR = '#00000000';
// Drop the Electron/app tokens so sites treat us like any Chromium browser.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(/\s?ultima-browser\/\S+/i, '')
  .replace(/\s?Ultima ?Browser\/\S+/i, ''); // written with or without the space, depending on the Electron version

if (!app.requestSingleInstanceLock()) app.quit();
// a link or .html file Ultima was started with; the UI opens it once it has restored its tabs
let launchUrl = defaultBrowser.launchTarget(process.argv);

let win = null;
let settings;
let sessionStore;
let data;
let extensions;
const downloads = new Map();

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: '#8b5cf6',
  windowMaterial: 'acrylic',
  glassTint: 45,
  loadingIndicator: true,
  loadingTheme: 'space',
  showBookmarksBar: true,
  centerBookmarksBar: false,
  searchEngine: 'google',
  restoreSession: true,
  sidebarWidth: 264,
  sidebarCollapsed: false,
  sidebarHidden: false,
  essentialsHeight: 44,
  onboarded: false,
  keybindings: {},
  permissions: {},
  window: { width: 1440, height: 900, maximized: false },
};

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---- keyboard shortcuts (work whether the chrome UI or a page has focus) ----
// Every binding comes from the shared keymap plus the user's overrides in settings.keybindings.
let globalKeys = new Map(); // combo -> command id
let recordingKeys = false; // the shortcut editor is capturing a new combo, so let every key through

function rebuildKeymap() {
  const bindings = keymap.resolve(settings.data.keybindings, process.platform);
  globalKeys = new Map();
  for (const c of keymap.COMMANDS) {
    if (c.scope !== 'global') continue;
    for (const combo of bindings[c.id]) if (!globalKeys.has(combo)) globalKeys.set(combo, c.id);
  }
}

// Is the user typing in a text box right now? Reported per page by webview-preload.js and by the UI itself.
// Single-key shortcuts (K, Shift+K…) only fire when this is false, so they never eat letters you type.
const typingIn = new Map(); // webContents id -> boolean
ipcMain.on('ultima:typing', (e, on) => typingIn.set(e.sender.id, Boolean(on)));

function shortcutFor(input, wc) {
  if (recordingKeys || input.type !== 'keyDown') return null;
  const combo = keymap.comboFromEvent(input);
  const cmd = combo && globalKeys.get(combo);
  if (!cmd) return null;
  if (keymap.isTypingKey(combo) && (input.isComposing || typingIn.get(wc.id))) return null;
  return cmd;
}

function hookShortcuts(wc) {
  const id = wc.id;
  wc.once('destroyed', () => typingIn.delete(id));
  wc.on('before-input-event', (event, input) => {
    const cmd = shortcutFor(input, wc);
    if (cmd) { event.preventDefault(); send('command', cmd); }
  });
}

// ---- right-click menu for web pages ----
// The menu is drawn by Ultima's UI (not a native menu); main keeps the actions, keyed by item id.
let pageMenu = null; // { token, actions: Map<id, fn> }
let pageMenuSeq = 0;
const MOD = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';

function pageContextMenu(wc, p) {
  const actions = new Map();
  const item = (label, fn, extra = {}) => {
    const id = `m${actions.size}`;
    actions.set(id, fn);
    return { id, label, ...extra };
  };
  const sep = { type: 'separator' };
  const t = [];
  const openTab = (url, background = true) => send('open-url', { url, background });
  const short = (s, n = 32) => (s.length > n ? `${s.slice(0, n)}…` : s);

  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) t.push(item(s, () => wc.replaceMisspelling(s), { icon: 'check' }));
    if (!p.dictionarySuggestions.length) t.push({ id: 'none', label: 'No spelling suggestions', enabled: false });
    t.push(item(`Add “${short(p.misspelledWord, 20)}” to dictionary`, () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord), { icon: 'plus' }), sep);
  }
  if (p.linkURL) {
    t.push(
      item('Open link in new tab', () => openTab(p.linkURL), { icon: 'external' }),
      item('Open link in new tab and switch', () => openTab(p.linkURL, false), { icon: 'tab' }),
      item('Open link in a space…', () => send('open-url', { url: p.linkURL, pickSpace: true }), { icon: 'layers' }),
      item('Copy link address', () => clipboard.writeText(p.linkURL), { icon: 'link' }),
      ...(p.linkText?.trim() ? [item('Copy link text', () => clipboard.writeText(p.linkText.trim()), { icon: 'copy' })] : []),
      sep,
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push(
      item('Open image in new tab', () => openTab(p.srcURL), { icon: 'external' }),
      item('Copy image', () => wc.copyImageAt(p.x, p.y), { icon: 'copy' }),
      item('Copy image address', () => clipboard.writeText(p.srcURL), { icon: 'link' }),
      item('Save image…', () => wc.downloadURL(p.srcURL), { icon: 'download' }),
      sep,
    );
  } else if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && !p.srcURL.startsWith('blob:')) {
    t.push(
      item(`Open ${p.mediaType} in new tab`, () => openTab(p.srcURL), { icon: 'external' }),
      item(`Copy ${p.mediaType} address`, () => clipboard.writeText(p.srcURL), { icon: 'link' }),
      item(`Save ${p.mediaType}…`, () => wc.downloadURL(p.srcURL), { icon: 'download' }),
      sep,
    );
  }
  if (p.isEditable) {
    const f = p.editFlags;
    t.push(
      item('Undo', () => wc.undo(), { enabled: f.canUndo, hint: `${MOD}+Z` }),
      item('Redo', () => wc.redo(), { enabled: f.canRedo, hint: `${MOD}+Y` }),
      sep,
      item('Cut', () => wc.cut(), { enabled: f.canCut, icon: 'cut', hint: `${MOD}+X` }),
      item('Copy', () => wc.copy(), { enabled: f.canCopy, icon: 'copy', hint: `${MOD}+C` }),
      item('Paste', () => wc.paste(), { enabled: f.canPaste, icon: 'paste', hint: `${MOD}+V` }),
      item('Paste as plain text', () => wc.pasteAndMatchStyle(), { enabled: f.canPaste, hint: `${MOD}+Shift+V` }),
      item('Select all', () => wc.selectAll(), { enabled: f.canSelectAll, hint: `${MOD}+A` }),
      sep,
    );
    const saved = data.passwordsFor(wc.getURL());
    if (saved.length) {
      t.push({
        id: 'logins',
        label: 'Fill saved login',
        icon: 'key',
        submenu: saved.map((s) => item(s.username || '(no username)', () => fillLogin(wc, s.id))),
      }, sep);
    }
  } else if (p.selectionText.trim()) {
    const sel = p.selectionText.trim();
    t.push(
      item('Copy', () => wc.copy(), { icon: 'copy', hint: `${MOD}+C` }),
      item(`Search for “${short(sel, 28)}”`, () => send('open-url', { search: sel, background: false }), { icon: 'search' }),
      item('Copy link to highlight', () => {
        const page = new URL(wc.getURL());
        page.hash = `:~:text=${encodeURIComponent(sel.slice(0, 300))}`;
        clipboard.writeText(page.toString());
      }, { icon: 'link' }),
      sep,
    );
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText.trim() && p.mediaType === 'none') {
    t.push(
      item('Bookmark this page', () => send('command', 'bookmark'), { icon: 'star', shortcut: 'bookmark' }),
      item('Copy page link', () => clipboard.writeText(wc.getURL()), { icon: 'link', shortcut: 'copy-url' }),
      item('Find in page…', () => send('command', 'find'), { icon: 'find', shortcut: 'find' }),
      item('Print…', () => send('command', 'print'), { icon: 'print', shortcut: 'print' }),
      sep,
    );
  }
  t.push(
    item('Back', () => wc.navigationHistory.goBack(), { icon: 'back', enabled: wc.navigationHistory.canGoBack(), shortcut: 'back' }),
    item('Forward', () => wc.navigationHistory.goForward(), { icon: 'forward', enabled: wc.navigationHistory.canGoForward(), shortcut: 'forward' }),
    item('Reload', () => wc.reload(), { icon: 'reload', shortcut: 'reload' }),
    sep,
    item('View page source', () => openTab(`view-source:${wc.getURL()}`, false), { icon: 'code' }),
    item('Inspect', () => wc.inspectElement(p.x, p.y), { icon: 'code', shortcut: 'devtools' }),
  );
  pageMenuSeq += 1;
  pageMenu = { token: pageMenuSeq, actions };
  send('page-menu', { token: pageMenuSeq, webContentsId: wc.id, x: p.x, y: p.y, items: t });
}

// Fills the first visible password field (and the username field before it) without exposing secrets to the UI.
async function fillLogin(wc, id) {
  const cred = await data.getPassword(id);
  if (!cred) return false;
  const script = `(() => {
    const cred = ${JSON.stringify(cred)};
    const visible = (el) => el && el.offsetParent !== null && !el.disabled && !el.readOnly;
    const set = (el, v) => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const pass = [...document.querySelectorAll('input[type=password]')].find(visible);
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=submit])')].filter(visible);
    let user = null;
    if (pass) user = fields.filter((f) => f.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    user = user || fields.find((f) => /user|email|login/i.test(f.name + f.id + f.autocomplete + f.type));
    if (user && cred.username) set(user, cred.username);
    if (pass) set(pass, cred.password);
    return Boolean(pass || user);
  })()`;
  return wc.executeJavaScript(script, true).catch(() => false);
}

// ---- permissions: prompt once per origin, remember the answer ----
const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'mediaKeySystem',
  'storage-access', 'top-level-storage-access', 'speaker-selection', 'midi']);
const PERMISSION_LABELS = {
  media: 'use your camera and/or microphone', geolocation: 'know your location', notifications: 'show notifications',
  'display-capture': 'see your screen', 'clipboard-read': 'read your clipboard', midiSysex: 'control MIDI devices',
  'idle-detection': 'know when you are idle', 'window-management': 'manage windows on your displays',
  openExternal: 'open an external application', fileSystem: 'access files on your device',
};

function originOf(url) { try { return new URL(url).origin; } catch { return url || 'unknown'; } }

// Extensions open tabs through Ultima (Electron has no chrome.tabs.create). Web pages can't use this.
const hookedWorkers = new Set(); // worker version ids
function openTabForExtension(url) {
  if (typeof url === 'string' && /^(https?|chrome-extension):/i.test(url)) send('open-url', { url, background: false });
}
// ---------- chrome.alarms for extensions ----------
// Electron 45.0.0 schedules alarms but never delivers onAlarm to background workers (electron/electron#52451), so
// Ultima keeps extensions' alarms itself: a due alarm wakes the extension's worker and is sent to it
// (extension-compat.js holds it until a listener is added). Alarms last until Ultima quits; extensions such as
// Bitwarden create theirs again as they start.
const extAlarms = new Map(); // `${session storage path}|${extension id}` -> Map(name -> alarm)
const MAX_TIMER = 2 ** 31 - 1;
const publicAlarm = (a) => ({ name: a.name, scheduledTime: a.scheduledTime, ...(a.periodInMinutes ? { periodInMinutes: a.periodInMinutes } : {}) });
function scheduleAlarm(ses, extId, list, alarm) {
  clearTimeout(alarm.timer);
  alarm.timer = setTimeout(() => {
    if (list.get(alarm.name) !== alarm) return;
    if (Date.now() < alarm.scheduledTime - 10) { scheduleAlarm(ses, extId, list, alarm); return; } // beyond one timer's reach
    const fired = publicAlarm(alarm);
    if (alarm.periodInMinutes) {
      const period = alarm.periodInMinutes * 60000;
      while (alarm.scheduledTime <= Date.now()) alarm.scheduledTime += period;
      scheduleAlarm(ses, extId, list, alarm);
    } else {
      list.delete(alarm.name);
    }
    ses.serviceWorkers.startWorkerForScope(`chrome-extension://${extId}/`)
      .then((worker) => { try { worker.send('ultima:ext-event', 'alarms.onAlarm', [fired]); } catch { /* stopped */ } })
      .catch(() => { /* the extension has no background */ });
  }, Math.min(MAX_TIMER, Math.max(0, alarm.scheduledTime - Date.now())));
}
function extensionAlarms(ses, extId, op, args = []) {
  const key = `${ses.storagePath || ''}|${extId}`;
  if (!extAlarms.has(key)) extAlarms.set(key, new Map());
  const list = extAlarms.get(key);
  const name = String(args[0] ?? '');
  if (op === 'create') {
    const info = args[1] && typeof args[1] === 'object' ? args[1] : {};
    const period = Number(info.periodInMinutes) > 0 ? Number(info.periodInMinutes) : 0;
    const delay = Number(info.delayInMinutes) > 0 ? Number(info.delayInMinutes) : period;
    const when = Number.isFinite(Number(info.when)) && info.when != null ? Number(info.when) : Date.now() + delay * 60000;
    if (list.has(name)) clearTimeout(list.get(name).timer);
    const alarm = { name, scheduledTime: when, periodInMinutes: period || undefined, timer: null };
    list.set(name, alarm);
    scheduleAlarm(ses, extId, list, alarm);
    return null;
  }
  if (op === 'get') return list.has(name) ? publicAlarm(list.get(name)) : null;
  if (op === 'getAll') return [...list.values()].map(publicAlarm);
  if (op === 'clear') {
    if (!list.has(name)) return false;
    clearTimeout(list.get(name).timer);
    list.delete(name);
    return true;
  }
  if (op === 'clearAll') {
    const had = list.size > 0;
    for (const a of list.values()) clearTimeout(a.timer);
    list.clear();
    return had;
  }
  return null;
}
ipcMain.handle('ultima:ext-alarms', (e, op, args) => {
  const extId = extIdOf(e.senderFrame?.url);
  return extId ? extensionAlarms(e.sender.session, extId, op, Array.isArray(args) ? args : []) : null;
});

// An extension page wrote to storage: tell the extension's running background, which Electron doesn't (see
// extension-compat.js). A background that isn't running reads storage fresh when it starts.
ipcMain.on('ultima:ext-storage-changed', (e, changes, area) => {
  const extId = extIdOf(e.senderFrame?.url);
  if (!extId || !changes || typeof changes !== 'object') return;
  try {
    const workers = e.sender.session.serviceWorkers;
    const running = Object.entries(workers.getAllRunning()).find(([, info]) => info.scope === `chrome-extension://${extId}/`);
    if (running) workers.getWorkerFromVersionID(Number(running[0])).send('ultima:ext-event', 'storage.changed', [changes, area]);
  } catch { /* the worker stopped meanwhile */ }
});

ipcMain.on('ultima:ext-open-tab', (e, url) => {
  if (e.senderFrame?.url?.startsWith('chrome-extension://')) openTabForExtension(url);
});

// ---- extension log: errors and warnings from extension pages and background workers ----
// Kept on this computer only (userData/logs/extensions.log, ~1 MB, one older file kept) for when an extension misbehaves.
let extLogFile = null;
function extLog(extId, where, level, message) {
  if (!extLogFile) return;
  const entry = extensions?.list.find((e) => e.runtimeId === extId);
  const name = entry ? extensions.info(entry).name : extId;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${name} [${where}] ${String(message).replace(/\s+/g, ' ').slice(0, 2000)}\n`;
  try {
    if (fs.existsSync(extLogFile) && fs.statSync(extLogFile).size > 1_000_000) fs.renameSync(extLogFile, `${extLogFile}.old`);
    fs.appendFileSync(extLogFile, line);
  } catch { /* logging must never break browsing */ }
}

// chrome.runtime.getContexts (Electron lacks it): an extension's open popup, extension tabs, offscreen
// documents and background. Extensions use it to tell whether their popup is open (Bitwarden does).
const extIdOf = (url) => { try { const u = new URL(url); return u.protocol === 'chrome-extension:' ? u.host : null; } catch { return null; } };
function extensionContexts(extId, filter = {}) {
  if (!extId) return [];
  const origin = `chrome-extension://${extId}`;
  let popupPath = null;
  const entry = extensions?.list.find((e) => e.runtimeId === extId);
  if (entry) { const popup = extensions.info(entry).popup; if (popup) popupPath = `/${popup.replace(/^\//, '')}`; }
  const out = [];
  for (const wc of webContents.getAllWebContents()) {
    const url = wc.getURL();
    if (!url.startsWith(`${origin}/`)) continue;
    const type = wc.getType();
    let contextType;
    if (type === 'remote') contextType = 'OFFSCREEN_DOCUMENT';
    else if (type === 'backgroundPage') contextType = 'BACKGROUND';
    else if (type === 'webview') contextType = popupPath && new URL(url).pathname === popupPath && !popouts.has(wc.id) ? 'POPUP' : 'TAB';
    else continue;
    const windowId = popouts.has(wc.id) ? POPOUT_WINDOW : contextType === 'TAB' || contextType === 'POPUP' ? 0 : -1;
    out.push({
      contextId: `wc-${wc.id}`, contextType, documentId: `wc-${wc.id}`, documentOrigin: origin, documentUrl: url, frameId: 0,
      incognito: false, tabId: contextType === 'TAB' ? wc.id : -1, windowId,
    });
  }
  for (const name of configuredSessions) {
    for (const [versionId, info] of Object.entries(session.fromPartition(name).serviceWorkers.getAllRunning())) {
      if (!info.scope.startsWith(`${origin}/`) || out.some((c) => c.contextId === `sw-${versionId}`)) continue;
      out.push({ contextId: `sw-${versionId}`, contextType: 'BACKGROUND', documentOrigin: origin, documentUrl: info.scriptUrl, frameId: -1, incognito: false, tabId: -1, windowId: -1 });
    }
  }
  const keep = (list, value) => !Array.isArray(list) || list.includes(value);
  return out.filter((c) => keep(filter.contextTypes, c.contextType) && keep(filter.contextIds, c.contextId) && keep(filter.tabIds, c.tabId)
    && keep(filter.windowIds, c.windowId) && keep(filter.documentUrls, c.documentUrl) && keep(filter.documentOrigins, c.documentOrigin)
    && (filter.incognito === undefined || filter.incognito === false));
}
ipcMain.handle('ultima:ext-contexts', (e, filter) => extensionContexts(extIdOf(e.senderFrame?.url), filter));
// chrome.tabs.remove: tab ids are webContents ids; the UI closes the matching tabs
function closeTabsForExtension(ids) {
  const list = [].concat(ids).map(Number).filter(Number.isFinite);
  if (list.length) send('ext-close-tabs', list);
}
ipcMain.on('ultima:ext-close-tabs', (e, ids) => { if (extIdOf(e.senderFrame?.url)) closeTabsForExtension(ids); });

// chrome.windows.create({ type: 'popup' }) of an extension's own page, e.g. Bitwarden's "Unlock account": Ultima has
// no separate small windows, so the page opens in the extension's popup (the one its toolbar button opens) instead
// of a tab. Like Chrome's popup window it counts as a window of its own (POPOUT_WINDOW) holding one tab, so the
// extension can find it with tabs.query, close it with windows.remove or tabs.remove, and hear tabs.onRemoved.
const POPOUT_WINDOW = 1;
const popouts = new Set(); // webContents ids of extension pages open as popouts
function openPopoutForExtension(extId, url, width, height) {
  if (!extId || typeof url !== 'string' || extIdOf(url) !== extId) return; // only the extension's own pages
  const entry = extensions?.list.find((e) => e.runtimeId === extId);
  if (!entry) return;
  send('ext-open-popout', { id: entry.id, path: url.slice(`chrome-extension://${extId}/`.length), width: Number(width) || 0, height: Number(height) || 0 });
}
ipcMain.on('ultima:ext-open-popout', (e, url, width, height) => openPopoutForExtension(extIdOf(e.senderFrame?.url), url, width, height));
ipcMain.on('ultima:ext-close-popout', (e) => { if (extIdOf(e.senderFrame?.url)) send('ext-close-popout'); });
// Gives an extension popup's page the real keyboard focus. When a popup opens, the web page behind it still has the
// keyboard: the popup shows its cursor (Bitwarden focuses its PIN field) but key presses keep going to the page until
// you click or Tab inside the popup. Chromium only moves the keyboard between pages on real input — focus() calls,
// even webContents.focus(), are refused as focus stealing — so the UI asks for a click on the very field the popup
// already focused (`point`, in UI coordinates), delivered through the window like your own click. Without a point
// (nothing focused to type into) it falls back to focus(), which is harmless.
ipcMain.on('ultima:focus-guest', (e, id, point) => {
  const wc = e.sender === win?.webContents && webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed() || wc.hostWebContents !== win.webContents) return;
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
  } else {
    win.webContents.focus();
    wc.focus();
  }
});
// the UI says which popup page is showing as a popout
ipcMain.on('ultima:popout-shown', (e, id) => {
  const wc = e.sender === win?.webContents && webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed() || !extIdOf(wc.getURL())) return;
  popouts.add(wc.id);
  wc.once('destroyed', () => popouts.delete(wc.id));
});

// ---- tab and navigation events for extensions ----
// Electron doesn't send chrome.tabs / chrome.webNavigation / chrome.windows events, so Ultima watches its tabs and
// forwards them (extension-compat.js turns them back into the real chrome.* events). Tab ids are webContents ids,
// as in Electron's own chrome.tabs; there is one window, id 0. Frame ids follow Chrome: 0 for the top frame.
let activeTabWcId = null;
const frameIdOf = (wc, frame) => (!frame || frame === wc.mainFrame ? 0 : frame.frameTreeNodeId);
const frameOf = (processId, routingId) => { try { return webFrameMain.fromId(processId, routingId); } catch { return null; } };
function frameDetails(wc, frame) {
  return {
    frameId: frameIdOf(wc, frame), parentFrameId: frame.parent ? frameIdOf(wc, frame.parent) : -1, url: frame.url, errorOccurred: false,
    frameType: frame.parent ? 'sub_frame' : 'outermost_frame', documentLifecycle: 'active', processId: frame.processId,
  };
}
function tabDetails(wc) {
  return {
    id: wc.id, windowId: 0, index: 0, url: wc.getURL(), title: wc.getTitle(), status: wc.isLoading() ? 'loading' : 'complete',
    active: wc.id === activeTabWcId, highlighted: wc.id === activeTabWcId, selected: wc.id === activeTabWcId, pinned: false,
    audible: wc.isCurrentlyAudible(), mutedInfo: { muted: wc.isAudioMuted() }, discarded: false, autoDiscardable: true,
    incognito: false, groupId: -1,
  };
}
// events worth waking a sleeping background worker for (others go only to workers already running)
const WAKING_EVENTS = new Set(['tabs.onActivated', 'tabs.onUpdated', 'webNavigation.onCommitted', 'webNavigation.onCompleted', 'windows.onFocusChanged']);
// Never throws: losing one event is fine, taking the browser down is not.
function dispatchExtEvent(name, args) {
  dispatchExtEventUnsafe(name, args).catch(() => { /* a page or worker went away mid-dispatch */ });
}
async function dispatchExtEventUnsafe(name, args) {
  if (!extensions?.list.some((e) => e.enabled !== false)) return;
  for (const wc of webContents.getAllWebContents()) {
    try { if (!wc.isDestroyed() && extIdOf(wc.getURL())) wc.send('ultima:ext-event', name, args); } catch { /* closing */ }
  }
  for (const sesName of configuredSessions) {
    const workers = session.fromPartition(sesName).serviceWorkers;
    const running = Object.entries(workers.getAllRunning());
    for (const entry of extensions.list) {
      if (entry.enabled === false || !entry.runtimeId) continue;
      const scope = `chrome-extension://${entry.runtimeId}/`;
      const hit = running.find(([, info]) => info.scope === scope);
      let worker = null;
      try { worker = hit ? workers.getWorkerFromVersionID(Number(hit[0])) : null; } catch { /* stopped meanwhile */ }
      if (!worker && WAKING_EVENTS.has(name) && extensions.info(entry).hasWorker) {
        try { worker = await workers.startWorkerForScope(scope); } catch { worker = null; }
      }
      if (worker && !worker.isDestroyed()) { try { worker.send('ultima:ext-event', name, args); } catch { /* worker went away */ } }
    }
  }
}
// While an extension's popup or page is open, Chrome keeps that extension's background running. Electron may stop
// it, which cuts the page's connections (Bitwarden's popup then spins forever), so Ultima holds it open the same way.
const workerHolds = new Map(); // page webContents id -> { versionId, task }
function holdWorkerFor(wc) {
  const extId = extIdOf(wc.getURL());
  const entry = extId && extensions?.list.find((e) => e.runtimeId === extId);
  if (!entry || !extensions.info(entry).hasWorker) { releaseWorkerFor(wc.id); return; }
  const workers = wc.session.serviceWorkers;
  const scope = `chrome-extension://${extId}/`;
  const hold = (versionId, worker) => {
    if (wc.isDestroyed() || workerHolds.get(wc.id)?.versionId === versionId) return;
    releaseWorkerFor(wc.id);
    try { workerHolds.set(wc.id, { versionId, task: worker.startTask() }); } catch { /* stopped meanwhile */ }
  };
  const running = Object.entries(workers.getAllRunning()).find(([, info]) => info.scope === scope);
  if (running) {
    try { hold(Number(running[0]), workers.getWorkerFromVersionID(Number(running[0]))); } catch { /* stopped meanwhile */ }
  } else {
    workers.startWorkerForScope(scope).then((w) => hold(w.versionId, w)).catch(() => { /* no worker */ });
  }
}
function releaseWorkerFor(id) {
  const held = workerHolds.get(id);
  workerHolds.delete(id);
  try { held?.task.end(); } catch { /* already gone */ }
}
// An extension's background (re)started: hold it for its open pages, and tell the UI so an open popup reconnects.
function extensionWorkerStarted(extId) {
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.isDestroyed() && wc.getType() === 'webview' && extIdOf(wc.getURL()) === extId) holdWorkerFor(wc);
    } catch { /* page closing */ }
  }
  send('ext-worker-started', extId);
}

// Extension popups are webviews too, but in Chrome they aren't tabs
function isExtensionPopup(wc) {
  const extId = extIdOf(wc.getURL());
  if (!extId) return false;
  const entry = extensions?.list.find((e) => e.runtimeId === extId);
  const popup = entry && extensions.info(entry).popup;
  return Boolean(popup) && new URL(wc.getURL()).pathname === `/${popup.replace(/^\//, '')}`;
}
function hookTabEvents(wc) {
  // every handler is guarded: a page closing mid-event must not crash Ultima
  const on = (ev, fn) => wc.on(ev, (...a) => { try { if (!wc.isDestroyed()) fn(...a); } catch { /* ignore */ } });
  const tabId = wc.id;
  let announced = false;
  const emit = (name, ...args) => { if (!wc.isDestroyed() && !isExtensionPopup(wc)) dispatchExtEvent(name, args); };
  const nav = (frame, url) => ({ tabId, frameId: frameIdOf(wc, frame), parentFrameId: frame?.parent ? frameIdOf(wc, frame.parent) : -1, url, timeStamp: Date.now(), processId: frame?.processId ?? -1, documentLifecycle: 'active', frameType: frame?.parent ? 'sub_frame' : 'outermost_frame' });
  on('did-start-navigation', (d) => {
    if (!d.frame || d.isSameDocument) return;
    if (!announced && d.isMainFrame) { announced = true; emit('tabs.onCreated', tabDetails(wc)); }
    emit('webNavigation.onBeforeNavigate', nav(d.frame, d.url));
  });
  on('did-frame-navigate', (_e, url, _code, _status, isMainFrame, processId, routingId) => {
    emit('webNavigation.onCommitted', { ...nav(isMainFrame ? wc.mainFrame : frameOf(processId, routingId), url), transitionType: 'link', transitionQualifiers: [] });
    if (isMainFrame) emit('tabs.onUpdated', tabId, { url, status: 'loading' }, tabDetails(wc));
  });
  on('dom-ready', () => emit('webNavigation.onDOMContentLoaded', nav(wc.mainFrame, wc.getURL())));
  on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    const frame = isMainFrame ? wc.mainFrame : frameOf(processId, routingId);
    if (frame) emit('webNavigation.onCompleted', nav(frame, frame.url));
  });
  on('did-navigate-in-page', (_e, url, isMainFrame, processId, routingId) => {
    emit('webNavigation.onHistoryStateUpdated', { ...nav(isMainFrame ? wc.mainFrame : frameOf(processId, routingId), url), transitionType: 'link', transitionQualifiers: [] });
    if (isMainFrame) emit('tabs.onUpdated', tabId, { url }, tabDetails(wc));
  });
  on('did-fail-load', (_e, code, desc, url, isMainFrame, processId, routingId) => {
    if (code !== -3) emit('webNavigation.onErrorOccurred', { ...nav(isMainFrame ? wc.mainFrame : frameOf(processId, routingId), url), error: desc });
  });
  on('did-stop-loading', () => emit('tabs.onUpdated', tabId, { status: 'complete' }, tabDetails(wc)));
  on('page-title-updated', (_e, title) => emit('tabs.onUpdated', tabId, { title }, tabDetails(wc)));
  wc.once('destroyed', () => {
    if (activeTabWcId === tabId) activeTabWcId = null;
    if (announced) dispatchExtEvent('tabs.onRemoved', [tabId, { windowId: 0, isWindowClosing: false }]);
  });
}
// chrome.tabs.query, answered from Ultima's own tabs: Electron's version ignores most filters and counts
// extension popups as tabs, so an extension could act on the wrong page.
function matchesPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/i.test(url);
  // (chrome-extension:// too: an extension looks for its own pages, e.g. Bitwarden finding its unlock popout)
  const m = pattern.match(/^(\*|https?|file|ftp|chrome-extension):\/\/([^/]*)(\/.*)$/i);
  if (!m) return false;
  const glob = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  let u;
  try { u = new URL(url); } catch { return false; }
  const scheme = m[1] === '*' ? /^https?:$/i.test(u.protocol) : u.protocol === `${m[1].toLowerCase()}:`;
  const host = m[2] === '*' || (m[2].startsWith('*.') ? u.hostname === m[2].slice(2) || u.hostname.endsWith(m[2].slice(1)) : u.hostname === m[2]);
  return scheme && host && new RegExp(`^${glob(m[3])}$`).test(u.pathname + u.search);
}
function queryTabs(q = {}) {
  // an extension page open as a popout is the one tab of its popup window
  const tabs = webContents.getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && wc.getType() === 'webview' && (!isExtensionPopup(wc) || popouts.has(wc.id)) && wc.hostWebContents === win?.webContents)
    .map((wc) => (popouts.has(wc.id) ? { ...tabDetails(wc), windowId: POPOUT_WINDOW, active: true, highlighted: true, selected: true } : tabDetails(wc)));
  const urls = q.url === undefined ? null : [].concat(q.url);
  const titleRe = typeof q.title === 'string' ? new RegExp(`^${q.title.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) : null;
  const windowType = (t) => (t.windowId === POPOUT_WINDOW ? 'popup' : 'normal');
  return tabs.filter((t) => (q.active === undefined || t.active === q.active)
    && (q.windowType === undefined || q.windowType === windowType(t))
    && (q.windowId !== -2 || t.windowId !== POPOUT_WINDOW) // "the current window" is Ultima's, not the popout
    && (q.currentWindow === undefined || q.currentWindow === (t.windowId !== POPOUT_WINDOW))
    && (q.lastFocusedWindow === undefined || q.lastFocusedWindow === (t.windowId !== POPOUT_WINDOW))
    && (q.highlighted === undefined || t.highlighted === q.highlighted)
    && (q.windowId === undefined || q.windowId === -2 || q.windowId === t.windowId)
    && (q.status === undefined || t.status === q.status)
    && (q.audible === undefined || t.audible === q.audible)
    && (q.muted === undefined || t.mutedInfo.muted === q.muted)
    && (q.pinned === undefined || q.pinned === false)
    && (!urls || urls.some((p) => matchesPattern(p, t.url)))
    && (!titleRe || titleRe.test(t.title)));
}
ipcMain.handle('ultima:ext-tabs', (e, q) => (extIdOf(e.senderFrame?.url) ? queryTabs(q) : []));

// webNavigation.getAllFrames / getFrame
function extensionFrames({ tabId, frameId } = {}) {
  const wc = webContents.fromId(Number(tabId));
  if (!wc || wc.isDestroyed()) return frameId === undefined ? [] : null;
  const frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame)].map((f) => frameDetails(wc, f));
  return frameId === undefined ? frames : frames.find((f) => f.frameId === Number(frameId)) || null;
}
ipcMain.handle('ultima:ext-frames', (e, details) => (extIdOf(e.senderFrame?.url) ? extensionFrames(details) : null));

// Spaces with separate sign-ins get their own persistent partition: persist:ultima-space-<id>.
const SPACE_PARTITION = /^persist:ultima(-space-[a-z0-9]{1,16})?$/;
const configuredSessions = new Set();
function partitionSession(partition) {
  const name = SPACE_PARTITION.test(partition || '') ? partition : PARTITION;
  const ses = session.fromPartition(name);
  if (!configuredSessions.has(name)) {
    configuredSessions.add(name);
    setupSession(ses);
    extensions?.attach(ses, name).then(() => send('extensions-changed'));
  }
  return ses;
}

function setupSession(ses) {
  ses.setUserAgent(app.userAgentFallback);
  // fills gaps in Electron's extension APIs (storage.sync/managed) inside extension workers and pages
  for (const type of ['service-worker', 'frame']) {
    ses.registerPreloadScript({ type, id: `ultima-extension-compat-${type}`, filePath: path.join(__dirname, '..', 'extension-compat.js') });
  }
  ses.serviceWorkers.on('console-message', (_e, d) => {
    const extId = extIdOf(d.sourceUrl || '');
    if (extId && d.level >= 2) extLog(extId, `background ${String(d.sourceUrl).split('/').pop()}:${d.lineNumber}`, d.level >= 3 ? 'error' : 'warning', d.message);
  });
  // extension background workers asking to open a tab (see extension-compat.js); only extension workers are heard
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    // Hooked once per worker version (status changes repeat, and each lookup may return a new wrapper object).
    // Electron throws for a worker that has already gone; that must never take the browser down.
    if ((runningStatus !== 'starting' && runningStatus !== 'running') || hookedWorkers.has(versionId)) return;
    try {
      const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId);
      if (!worker || !worker.scope.startsWith('chrome-extension://')) return;
      hookedWorkers.add(versionId);
      setTimeout(() => extensionWorkerStarted(extIdOf(worker.scope)), 0);
      const extId = extIdOf(worker.scope);
      worker.ipc.on('ultima:ext-open-tab', (_e, url) => openTabForExtension(url));
      worker.ipc.on('ultima:ext-close-tabs', (_e, ids) => closeTabsForExtension(ids));
      worker.ipc.on('ultima:ext-open-popout', (_e, url, width, height) => openPopoutForExtension(extId, url, width, height));
      worker.ipc.on('ultima:ext-close-popout', () => send('ext-close-popout'));
      worker.ipc.handle('ultima:ext-contexts', (_e, filter) => extensionContexts(extId, filter));
      worker.ipc.handle('ultima:ext-frames', (_e, details) => extensionFrames(details));
      worker.ipc.handle('ultima:ext-tabs', (_e, q) => queryTabs(q));
      worker.ipc.handle('ultima:ext-alarms', (_e, op, args) => extensionAlarms(ses, extId, op, Array.isArray(args) ? args : []));
      worker.ipc.handle('ultima:ext-installed', () => extensions?.takeInstalled(ses, extId) || null);
    } catch { /* the worker stopped before it could be hooked; it is hooked when it runs again */ }
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    const stored = settings.data.permissions[originOf(requestingOrigin)]?.[permission];
    return stored === true;
  });

  ses.setPermissionRequestHandler(async (wc, requested, callback, details) => {
    // Electron 44 reports screen sharing as `media` with no devices listed (45 names it `display-capture`): treat it
    // as screen sharing, so it's asked as such and remembered apart from the camera and microphone.
    const permission = requested === 'media' && !details.mediaTypes?.length ? 'display-capture' : requested;
    if (AUTO_ALLOW.has(permission)) return callback(true);
    const origin = originOf(details.requestingUrl || wc.getURL());
    const stored = settings.data.permissions[origin]?.[permission];
    if (stored !== undefined) return callback(stored);
    let what = PERMISSION_LABELS[permission] || `use “${permission}”`;
    if (permission === 'media' && details.mediaTypes?.length) {
      what = `use your ${details.mediaTypes.map((m) => (m === 'video' ? 'camera' : 'microphone')).join(' and ')}`;
    }
    if (permission === 'openExternal' && details.externalURL) what = `open ${new URL(details.externalURL).protocol} links in another app`;
    // asked in Ultima's own dialog; no window to ask in means no
    const answer = await askUi('permission', { site: hostOf(origin) || origin, what });
    const allow = Boolean(answer?.allow);
    if (answer?.remember) {
      settings.data.permissions[origin] = { ...settings.data.permissions[origin], [permission]: allow };
      settings.save();
    }
    callback(allow);
  });

  ses.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename());
    let target = path.join(dir, parsed.base);
    for (let i = 1; fs.existsSync(target); i += 1) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    item.setSavePath(target);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const report = (state) => {
      const d = {
        id, state, filename: path.basename(target), path: target, url: item.getURL(),
        received: item.getReceivedBytes(), total: item.getTotalBytes(), started: item.getStartTime() * 1000,
      };
      downloads.set(id, d);
      send('download', d);
    };
    report('progressing');
    item.on('updated', (_ev, state) => report(state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'));
    item.once('done', (_ev, state) => report(state));
  });
}

// Mica/vibrancy take their light or dark tint from the native theme, so keep it in step with ours.
function syncNativeTheme() {
  nativeTheme.themeSource = ['dark', 'light'].includes(settings.data.theme) ? settings.data.theme : 'system';
}

// ---- window ----
function createWindow() {
  const bounds = settings.data.window;
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 480,
    title: 'Ultima Browser',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: GLASS ? CLEAR : '#111114',
    backgroundMaterial: BACKDROPS ? settings.data.windowMaterial : undefined,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: GLASS ? CLEAR : '#111114', symbolColor: '#e6e6ee', height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  hookShortcuts(win.webContents);

  const rememberBounds = () => {
    if (win.isDestroyed()) return;
    settings.data.window = win.isMaximized() || win.isFullScreen()
      ? { ...settings.data.window, maximized: win.isMaximized() }
      : { ...win.getBounds(), maximized: false };
    settings.save();
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('enter-full-screen', () => send('window-fullscreen', true));
  win.on('focus', () => dispatchExtEvent('windows.onFocusChanged', [0]));
  win.on('blur', () => dispatchExtEvent('windows.onFocusChanged', [-1]));
  win.on('leave-full-screen', () => send('window-fullscreen', false));

  // Lock down every <webview> the UI creates.
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preloadURL;
    prefs.preload = path.join(__dirname, '..', 'webview-preload.js'); // only reports text-box focus
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.spellcheck = true;
    params.partition = SPACE_PARTITION.test(params.partition || '') ? params.partition : PARTITION;
    partitionSession(params.partition);
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-start-loading', () => { recordingKeys = false; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
}

app.on('web-contents-created', (_e, wc) => {
  // extension pages (popups, options, offscreen documents) report their errors to the extension log
  wc.on('console-message', (d) => {
    try {
      const extId = extIdOf(wc.getURL());
      if (extId && (d.level === 'error' || d.level === 'warning')) extLog(extId, `${new URL(wc.getURL()).pathname.slice(1)}:${d.lineNumber}`, d.level, d.message);
    } catch { /* logging must never break browsing */ }
  });
  if (wc.getType() !== 'webview') return;
  // extension pages (popups, extension tabs) keep their extension's background alive until they close or leave
  const id = wc.id;
  wc.on('did-finish-load', () => { try { holdWorkerFor(wc); } catch { /* never break page loads */ } });
  wc.once('destroyed', () => releaseWorkerFor(id));
  hookShortcuts(wc);
  hookTabEvents(wc);
  wc.on('context-menu', (_ev, params) => pageContextMenu(wc, params));
  wc.setWindowOpenHandler(({ url, disposition }) => {
    // Real popups (OAuth, payment flows) need window.opener, so give them a window of their own.
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#ffffff' },
      };
    }
    send('open-url', { url, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });
});

// ---- IPC ----
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

  handle('state:get', () => {
    const url = launchUrl; // opened once, not again if the UI reloads
    launchUrl = null;
    return {
      settings: settings.data,
      session: sessionStore.data,
      platform: process.platform,
      versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      downloads: [...downloads.values()],
      systemDark: nativeTheme.shouldUseDarkColors,
      glass: GLASS,
      backdrops: BACKDROPS,
      launchUrl: url,
    };
  });
  handle('session:save', (s) => { sessionStore.data = s; sessionStore.save(800); });
  handle('settings:set', (patch) => {
    Object.assign(settings.data, patch);
    settings.save();
    if (patch.keybindings) rebuildKeymap();
    if (patch.windowMaterial && BACKDROPS && win) win.setBackgroundMaterial(patch.windowMaterial);
    return settings.data;
  });
  // The UI decides light/dark (a space can override the app setting); Acrylic/Mica and web pages follow it.
  handle('theme:native', (mode) => {
    if (['system', 'light', 'dark'].includes(mode) && nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
  });
  // A favicon as a data: URL, so the UI can read its colors (a canvas can't read a cross-site image). Fetched through
  // the UI's own session, so it usually comes straight from the cache the sidebar loaded it into. Images only, ≤ 1 MB.
  handle('favicon:data', async (url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || !win) return null;
    try {
      const res = await win.webContents.session.fetch(url);
      if (!res.ok) return null;
      let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) {
        const ext = new URL(url).pathname.split('.').pop().toLowerCase();
        type = { ico: 'image/x-icon', png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
        if (!type) return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= 1e6 ? `data:${type};base64,${buf.toString('base64')}` : null;
    } catch { return null; }
  });
  // A tab's back/forward list for Tab History in the address bar menu, and jumping to one of its pages.
  // Only Ultima's own tabs (webviews in its window) are answered.
  const tabContents = (id) => {
    const wc = webContents.fromId(Number(id));
    return wc && !wc.isDestroyed() && wc.getType() === 'webview' && wc.hostWebContents === win?.webContents ? wc : null;
  };
  handle('tab:history', (id) => {
    const wc = tabContents(id);
    if (!wc) return null;
    return { entries: wc.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title })), active: wc.navigationHistory.getActiveIndex() };
  });
  handle('tab:history-go', (id, index) => {
    const wc = tabContents(id);
    if (wc && Number.isInteger(index) && wc.navigationHistory.canGoToOffset(index - wc.navigationHistory.getActiveIndex())) wc.navigationHistory.goToIndex(index);
  });
  handle('default-browser:get', () => defaultBrowser.status());
  handle('default-browser:set', () => defaultBrowser.makeDefault());
  handle('keys:recording', (on) => { recordingKeys = Boolean(on); });
  handle('permissions:reset', () => { settings.data.permissions = {}; settings.save(); });
  handle('overlay:set', ({ color, symbolColor }) => {
    if (win && process.platform !== 'darwin') win.setTitleBarOverlay({ color: GLASS ? CLEAR : color, symbolColor, height: 40 });
  });

  handle('history:add', (entry) => data.addHistory(entry));
  handle('history:list', (opts) => data.listHistory(opts));
  handle('history:delete', (url) => data.deleteHistory(url));
  handle('history:clear', () => data.clearHistory());
  handle('topsites', () => data.topSites(8));
  handle('search', (q) => data.search(q));

  handle('bookmarks:list', () => data.bookmarks);
  handle('bookmarks:tree', () => data.bookmarkTree());
  handle('bookmarks:has', (url) => data.isBookmarked(url));
  handle('bookmarks:toggle', (b) => data.toggleBookmark(b));
  handle('bookmarks:remove', (id) => data.removeBookmark(id));
  handle('bookmarks:add', (b) => data.addBookmark(b || {}));
  handle('bookmarks:add-folder', (f) => data.addBookmarkFolder(f || {}));
  handle('bookmarks:update', ({ id, ...change }) => data.updateBookmark(id, change));
  handle('bookmarks:move', ({ id, parent, index }) => data.moveBookmark(id, { parent, index }));
  // Chromium browsers whose bookmarks bar can be copied onto Ultima's
  handle('bookmarks:bar-sources', () => importer.detect().filter((s) => s.kind === 'chromium' && s.has.bookmarks)
    .map((s) => ({ id: s.id, label: s.label, profile: s.profile, browser: s.browser })));
  handle('bookmarks:import-bar', (sourceId) => {
    const src = importer.detect().find((s) => s.id === sourceId && s.kind === 'chromium');
    if (!src) throw new Error('That browser wasn’t found');
    return data.mergeBookmarks(importer.chromiumBookmarksBar(src), 'bar');
  });

  // ---- extensions ----
  const extChanged = (result) => { send('extensions-changed'); return result; };
  handle('ext:list', () => extensions.all());
  handle('ext:install-webstore', async (input) => extChanged(await extensions.installFromWebStore(input)));
  handle('ext:install-unpacked', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose an unpacked extension folder', properties: ['openDirectory'] });
    if (canceled || !filePaths[0]) return null;
    return extChanged(await extensions.installUnpacked(filePaths[0]));
  });
  handle('ext:set-enabled', async ({ id, enabled }) => extChanged(await extensions.setEnabled(id, enabled)));
  handle('ext:set-pinned', ({ id, pinned }) => extChanged(extensions.setPinned(id, pinned)));
  handle('ext:remove', (id) => extChanged(extensions.remove(id)));
  // the UI reports which tab is showing, for chrome.tabs.onActivated
  handle('tabs:active', (id) => {
    const next = Number.isFinite(id) ? id : null;
    if (next === activeTabWcId) return;
    activeTabWcId = next;
    if (next !== null) dispatchExtEvent('tabs.onActivated', [{ tabId: next, windowId: 0 }]);
  });
  handle('ext:open-log', () => {
    if (!fs.existsSync(extLogFile)) fs.writeFileSync(extLogFile, '');
    return shell.openPath(extLogFile);
  });
  handle('ext:runtime-id',({ id, partition }) => extensions.runtimeIdFor(id, SPACE_PARTITION.test(partition || '') ? partition : PARTITION));

  handle('import:detect', () => importer.detect());
  handle('import:run', async ({ sourceId, what, partition }) => {
    const src = importer.detect().find((s) => s.id === sourceId);
    if (!src) throw new Error('That browser profile is no longer available.');
    return importer.runImport(src, what, data, partitionSession(partition));
  });
  handle('import:passwords-csv', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import passwords from CSV', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const entries = importer.passwordsFromCsv(fs.readFileSync(filePaths[0], 'utf8'));
    return { found: entries.length, added: await data.mergePasswords(entries, path.basename(filePaths[0])), file: filePaths[0] };
  });
  handle('import:bookmarks-html', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import bookmarks from HTML', properties: ['openFile'], filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const entries = importer.bookmarksFromHtml(fs.readFileSync(filePaths[0], 'utf8'), 'Imported HTML');
    return { found: entries.length, added: data.mergeBookmarks(entries) };
  });

  handle('passwords:list', () => data.listPasswords());
  handle('passwords:for', (url) => data.passwordsFor(url));
  handle('passwords:copy', async ({ id, field }) => {
    const cred = await data.getPassword(id);
    if (!cred) return false;
    await clipboard.writeText(field === 'username' ? cred.username : cred.password);
    // clear a copied password after 30s, unless something else has been copied since (the clipboard API is async)
    if (field !== 'username') setTimeout(async () => { if (await clipboard.readText() === cred.password) clipboard.clear(); }, 30000);
    return true;
  });
  handle('passwords:fill', ({ webContentsId, id }) => {
    const wc = webContents.fromId(webContentsId);
    return wc ? fillLogin(wc, id) : false;
  });
  handle('passwords:delete', (id) => data.deletePassword(id));

  handle('data:clear', async ({ history, cookies, cache, partitions = [] }) => {
    if (history) data.clearHistory();
    for (const p of new Set([PARTITION, ...partitions])) {
      const s = partitionSession(p);
      if (cache) await s.clearCache();
      if (cookies) await s.clearStorageData();
    }
  });

  handle('download:open', (id) => downloads.get(id) && shell.openPath(downloads.get(id).path));
  handle('download:show', (id) => downloads.get(id) && shell.showItemInFolder(downloads.get(id).path));
  handle('download:clear', () => {
    for (const [id, d] of downloads) if (d.state !== 'progressing') downloads.delete(id);
  });

  // The UI drew a page's right-click menu; run what was picked (stale picks from an older menu are ignored).
  // (for webviews, Electron reports the click — and copyImageAt/inspectElement expect it — in window coordinates)
  handle('page-menu:choose', ({ token, id }) => {
    if (!pageMenu || pageMenu.token !== token) return;
    const action = pageMenu.actions.get(id);
    pageMenu = null;
    action?.();
  });
  // Edit commands for Ultima's own text boxes (its custom right-click menu)
  handle('ui:edit', (action) => {
    if (win && ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll'].includes(action)) win.webContents[action]();
  });
  handle('ask:answer', ({ id, answer }) => {
    pendingAsks.get(id)?.(answer);
    pendingAsks.delete(id);
  });
}

// Questions for the user (e.g. permission prompts) are shown by the UI in Ultima's own dialogs.
const pendingAsks = new Map();
let askSeq = 0;
function askUi(kind, payload) {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    askSeq += 1;
    pendingAsks.set(askSeq, resolve);
    send('ask', { id: askSeq, kind, payload });
  });
}

// ---- Widevine (DRM video: Netflix, Disney+, Prime Video…) ----
// Ultima runs on castLabs' Electron for Content Security, which installs Google's Widevine CDM on first launch and
// keeps it updated in the background (`components`). Pages can only use it once it's in, so the window waits for it:
// at most a few seconds, so a first launch offline (or on standard Electron, which has no `components`) isn't held up.
async function widevineReady() {
  const { components } = require('electron');
  if (!components?.whenReady) return;
  const timeout = new Promise((resolve) => { setTimeout(resolve, 10000, 'still installing'); });
  try {
    const result = await Promise.race([components.whenReady().then(() => 'ready'), timeout]);
    console.log(`[widevine] ${result}`, JSON.stringify(components.status()));
  } catch (err) {
    console.warn('[widevine] not available:', err?.message || err);
  }
}

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = defaultBrowser.launchTarget(argv);
  if (url) send('open-url', { url, background: false });
});

// macOS hands links over as an event, also before the window exists
app.on('open-url', (e, url) => {
  e.preventDefault();
  if (win && !win.isDestroyed()) send('open-url', { url, background: false });
  else launchUrl = url;
});

app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  settings = new JsonStore(dir, 'settings', DEFAULT_SETTINGS);
  syncNativeTheme();
  rebuildKeymap();
  sessionStore = new JsonStore(dir, 'session', { tabs: [], activeIndex: 0 });
  data = new BrowserData(dir);
  data.onBookmarksChanged = () => send('bookmarks-changed');
  extensions = new ExtensionManager(dir);
  extLogFile = path.join(dir, 'logs', 'extensions.log');
  fs.mkdirSync(path.dirname(extLogFile), { recursive: true });
  Menu.setApplicationMenu(null);
  partitionSession(PARTITION);
  registerIpc();
  await widevineReady();
  createWindow();
  defaultBrowser.refreshRegistration();
  nativeTheme.on('updated', () => send('system-theme', nativeTheme.shouldUseDarkColors));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => {
  data?.flush();
  for (const s of [settings, sessionStore]) if (s?.timer) s.flush();
});

app.on('window-all-closed', () => {
  data?.flush();
  if (process.platform !== 'darwin') app.quit();
});
