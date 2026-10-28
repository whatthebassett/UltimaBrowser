const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, session, Menu, clipboard, dialog, shell, webContents, webFrameMain, nativeTheme, net, screen,
} = require('electron');
const { JsonStore } = require('./store');
const { BrowserData, hostOf } = require('./data');
const importer = require('./importer');
const { ExtensionManager } = require('./extensions');
const defaultBrowser = require('./defaultbrowser');
const taskManager = require('./taskmanager');
const { Blocker, ADS, TRACKERS, hostOf: urlHost, baseDomain, hostChain } = require('./blocker');
const keymap = require('../renderer/keymap');
const SITE_PERMS = require('../renderer/sitepermissions');

app.setName('Ultima Browser');
app.setAppUserModelId(defaultBrowser.APP_ID);

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
// Hardware acceleration (Settings → General → Performance): the graphics card draws pages, video and 3D unless it's
// turned off. Chromium settles this as it starts, so the setting is read here, before anything else, and a change takes
// a restart.
const HARDWARE_ACCELERATION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).hardwareAcceleration !== false;
  } catch { return true; } // first run or unreadable: on, as DEFAULT_SETTINGS has it
})();
if (!HARDWARE_ACCELERATION) app.disableHardwareAcceleration();
const RESTART_SWITCH = '--ultima-restarted'; // started again by Ultima itself (app:relaunch)
// a link or .html file Ultima was started with; the UI opens it once it has restored its tabs
let launchUrl = defaultBrowser.launchTarget(process.argv);

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
  addressBarMode: 'palette', // what clicking the address bar opens: palette, extended (palette at the bar) or classic
  loadingStyle: 'bar', // the loading animation: in the address bar (bar), or a line under the toolbar (line)
  showBookmarksBar: true,
  centerBookmarksBar: false,
  searchEngine: 'google',
  restoreSession: true,
  downloadDir: '', // '' = the system's Downloads folder
  askWhereToSave: false, // a Save As dialog for every download
  sidebarWidth: 264,
  sidebarCollapsed: false,
  sidebarHidden: false,
  essentialsHeight: 44,
  // sidebar style, in every space and window (renderer/sidebarstyle.js)
  widgetOpen: 'dropdown', // what the Waypoints, History and Downloads buttons open: a dropdown, or the page (widgets.js)
  tabLayout: 'vertical', // vertical (the sidebar) or horizontal (a tab strip across the top): renderer/tablayout.js
  sidebarFont: 'inter', // inter, system, serif, mono, or "font:<family>" for an installed font
  sidebarTextSize: 13, // px
  sidebarDensity: 'default', // tab height: compact, default or roomy
  onboarded: false, // the welcome (renderer/welcome.js) has been seen
  welcomeMuted: false, // the welcome's sound, turned off with its speaker button
  keybindings: {},
  permissions: {}, // origin → { key: true/false } (see sitepermissions.js)
  siteDefaults: {}, // key → true/false, for every site without its own choice
  blockAds: true,
  blockTrackers: true,
  cleanLinks: true, // takes tracking codes (utm_source, fbclid…) out of the links you open
  globalPrivacyControl: true, // tells sites not to sell or share your data (Sec-GPC)
  blockThirdPartyCookies: false,
  blockingOff: {}, // host → true: sites where ads and trackers aren't blocked (with their subdomains)
  glanceTrigger: 'any', // what opens a link in a glance (a preview over the page): any, alt, shift, hold or off
  // productivity: automatic tab groups (renderer/autogroup.js)
  autoGroup: true,
  autoGroupMin: 2, // tabs of one app or site in a space before they're grouped
  autoGroupWork: 'app', // app: a folder per work app; suite: one per suite (Google Workspace, Microsoft 365, Atlassian)
  autoGroupSites: true, // other websites too, not only work apps
  // accessibility (renderer/accessibility.js applies most of these; text sizes and caret browsing are set here)
  pageZoom: 100, // %
  textSize: 16, // px, for text a page doesn't size itself
  minFontSize: 0, // px, 0 = none
  pageContrast: 100, // %
  pageBrightness: 100, // %
  colorFilter: 'none', // none, grayscale, invert, protanopia, deuteranopia, tritanopia
  focusHighlight: false,
  underlineLinks: false,
  caretBrowsing: false, // a text cursor in pages (caret-preload.js), F7
  uiContrast: false,
  reduceMotion: false,
  hardwareAcceleration: true, // read at startup (HARDWARE_ACCELERATION above); a change applies after a restart
  taskManagerWindow: null, // where the task manager's window was last: { x, y, width, height }
  window:{ width: 1440, height: 900, maximized: false },
};

// ---- windows ----
// Every Ultima window, by BrowserWindow id: { win, private, key, bounds, activeTab, url }. Normal windows share the
// sidebar (spaces, Essentials and pinned tabs) and each keeps its own regular tabs, saved in the session file under its
// key. Private windows keep nothing.
const windows = new Map();
let lastFocusedId = null;
let quitting = false;
// Private windows and tabs browse in memory only: nothing reaches the disk, and it's all cleared when the last private
// page closes (and gone anyway when Ultima quits). Extensions don't run there, as in Chrome.
const PRIVATE_PARTITION = 'ultima-private';
const isPrivateSession = (ses) => ses === session.fromPartition(PRIVATE_PARTITION);
const isPrivate = (wc) => Boolean(wc) && !wc.isDestroyed() && isPrivateSession(wc.session);

const liveWindows = () => [...windows.values()].filter((w) => !w.win.isDestroyed());
// the window the UI or a page belongs to (a page's host is the UI holding its <webview>)
function windowOf(wc) {
  if (!wc || wc.isDestroyed()) return null;
  const host = wc.hostWebContents || wc;
  return liveWindows().find((w) => w.win.webContents === host) || null;
}
// where things go that don't come from a window (links from other apps, extensions): the window used last
function currentWindow({ normal = false } = {}) {
  const list = liveWindows().filter((w) => !normal || !w.private);
  return list.find((w) => w.win.id === lastFocusedId) || list[list.length - 1] || null;
}
const sendTo = (w, channel, payload) => { if (w && !w.win.isDestroyed()) w.win.webContents.send(channel, payload); };
const send = (channel, payload) => sendTo(currentWindow(), channel, payload);
const broadcast = (channel, payload, { except = null, normalOnly = false } = {}) => {
  for (const w of liveWindows()) if (w !== except && !(normalOnly && w.private)) sendTo(w, channel, payload);
};

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

// Pages open in a glance (glance.js): Esc there closes the glance, as it does in the UI
const glancePages = new Set(); // webContents ids
// each page's favicon, for the task manager's window (which has no tabs of its own to ask)
const pageFavicons = new Map(); // webContents id → favicon URL

function hookShortcuts(wc) {
  const id = wc.id;
  wc.once('destroyed', () => { typingIn.delete(id); glancePages.delete(id); });
  wc.on('before-input-event', (event, input) => {
    if (glancePages.has(id) && input.type === 'keyDown' && input.key === 'Escape' && !input.shift && !input.control && !input.alt && !input.meta) {
      event.preventDefault();
      sendTo(windowOf(wc), 'glance-escape', id);
      return;
    }
    const cmd = shortcutFor(input, wc);
    if (cmd) { event.preventDefault(); sendTo(windowOf(wc), 'command', cmd); }
  });
}

// ---- the mouse's back and forward buttons ----
// Electron leaves these to the app, and Chromium hands them to the page as mouse buttons 4 and 5 on every system
// (Windows' app commands never arrive for them). webview-preload.js sends a page's here, and it goes back or forward in
// that page, wherever it is: a tab, a split pane or a glance. Over Ultima itself, app.js handles them.
ipcMain.on('ultima:mouse-nav', (e, dir) => {
  const nav = e.sender.navigationHistory;
  if (dir === 'back' && nav.canGoBack()) nav.goBack();
  else if (dir === 'forward' && nav.canGoForward()) nav.goForward();
});

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
  const send = (channel, payload) => sendTo(windowOf(wc), channel, payload); // the window the page is in
  const priv = isPrivate(wc); // links from a private page open privately
  const openTab = (url, background = true) => send('open-url', { url, background, private: priv });
  const short = (s, n = 32) => (s.length > n ? `${s.slice(0, n)}…` : s);

  // Copy, Paste, Waypoints and Reload, always at the top as a row of buttons (overlays.js draws `type: 'actions'`)
  const saved = data.isBookmarked(wc.getURL());
  t.push({
    type: 'actions',
    buttons: [
      item('Copy', () => wc.copy(), { icon: 'copy', enabled: Boolean(p.editFlags.canCopy || p.selectionText.trim()), hint: `${MOD}+C` }),
      item('Paste', () => wc.paste(), { icon: 'paste', enabled: Boolean(p.isEditable && p.editFlags.canPaste), hint: `${MOD}+V` }),
      item(saved ? 'Remove from Waypoints' : 'Add this page to Waypoints', () => send('command', 'bookmark'), { icon: 'star', on: saved, shortcut: 'bookmark' }),
      item('Reload', () => wc.reload(), { icon: 'reload', shortcut: 'reload' }),
    ],
  });

  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) t.push(item(s, () => wc.replaceMisspelling(s), { icon: 'check' }));
    if (!p.dictionarySuggestions.length) t.push({ id: 'none', label: 'No spelling suggestions', enabled: false });
    t.push(item(`Add “${short(p.misspelledWord, 20)}” to dictionary`, () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord), { icon: 'plus' }), sep);
  }
  if (p.linkURL) {
    t.push(
      item('Open link in new tab', () => openTab(p.linkURL), { icon: 'external' }),
      item('Open link in new tab and switch', () => openTab(p.linkURL, false), { icon: 'tab' }),
      item('Open link in new window', () => createWindow({ url: p.linkURL, private: priv }), { icon: 'window' }),
      ...(priv ? [] : [
        item('Open link in private tab', () => send('open-url', { url: p.linkURL, background: false, private: true }), { icon: 'incognito' }),
        item('Open link in private window', () => createWindow({ url: p.linkURL, private: true }), { icon: 'incognito' }),
        item('Open link in a space…', () => send('open-url', { url: p.linkURL, pickSpace: true }), { icon: 'layers' }),
      ]),
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
      item('Paste as plain text', () => wc.pasteAndMatchStyle(), { enabled: f.canPaste, hint: `${MOD}+Shift+V` }),
      item('Select all', () => wc.selectAll(), { enabled: f.canSelectAll, hint: `${MOD}+A` }),
      sep,
    );
    const logins = data.passwordsFor(wc.getURL());
    if (logins.length) {
      t.push({
        id: 'logins',
        label: 'Fill saved login',
        icon: 'key',
        submenu: logins.map((s) => item(s.username || '(no username)', () => fillLogin(wc, s.id))),
      }, sep);
    }
  } else if (p.selectionText.trim()) {
    const sel = p.selectionText.trim();
    t.push(
      item(`Search for “${short(sel, 28)}”`, () => send('open-url', { search: sel, background: false, private: priv }), { icon: 'search' }),
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
      item('Copy page link', () => clipboard.writeText(wc.getURL()), { icon: 'link', shortcut: 'copy-url' }),
      item('Find in page…', () => send('command', 'find'), { icon: 'find', shortcut: 'find' }),
      item('Print…', () => send('command', 'print'), { icon: 'print', shortcut: 'print' }),
      sep,
    );
  }
  t.push(
    item('Back', () => wc.navigationHistory.goBack(), { icon: 'back', enabled: wc.navigationHistory.canGoBack(), shortcut: 'back' }),
    item('Forward', () => wc.navigationHistory.goForward(), { icon: 'forward', enabled: wc.navigationHistory.canGoForward(), shortcut: 'forward' }),
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

// What a site may do (see sitepermissions.js): true = allow, false = block, undefined = ask.
const siteAllows = (origin, key) => SITE_PERMS.effective(settings.data.permissions[origin], key, settings.data.siteDefaults);
// Choices remembered while browsing privately last only as long as private browsing does; your saved site settings
// still apply there.
const privatePermissions = {}; // origin → { key: true/false }
const allowsIn = (ses, origin, key) => (isPrivateSession(ses) && privatePermissions[origin]?.[key] !== undefined
  ? privatePermissions[origin][key] : siteAllows(origin, key));

// Saves a site's choices ({ key: true/false/null }; null = back to the default). The camera-and-microphone choice
// older versions kept as one ("media") becomes two the first time either is set.
function setSitePermissions(origin, values) {
  const record = { ...settings.data.permissions[origin] };
  if (record.media !== undefined && ('camera' in values || 'microphone' in values)) {
    record.camera ??= record.media;
    record.microphone ??= record.media;
    delete record.media;
  }
  for (const [k, v] of Object.entries(values)) { if (v === null) delete record[k]; else record[k] = v; }
  if (Object.keys(record).length) settings.data.permissions[origin] = record;
  else delete settings.data.permissions[origin];
  settings.save();
}

// Blocked JavaScript or images: a Content-Security-Policy added to the site's pages (and frames from it)
function siteContentPolicy(origin) {
  return [siteAllows(origin, 'javascript') === false && "script-src 'none'", siteAllows(origin, 'images') === false && "img-src 'none'"].filter(Boolean).join('; ');
}

// Cookies a site set or may read (its own domain, its subdomains and the parent domains it shares cookies with)
const cookieForHost = (cookie, host) => {
  const d = (cookie.domain || '').replace(/^\./, '');
  return d === host || host.endsWith(`.${d}`) || d.endsWith(`.${host}`);
};
const siteSessions = () => [...configuredSessions].map((name) => session.fromPartition(name));

// Extensions open tabs through Ultima (Electron has no chrome.tabs.create). Web pages can't use this.
const hookedWorkers = new Set(); // worker version ids
function openTabForExtension(url) {
  if (typeof url === 'string' && /^(https?|chrome-extension):/i.test(url)) sendTo(currentWindow({ normal: true }), 'open-url', { url, background: false });
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
  if (list.length) broadcast('ext-close-tabs', list);
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
  sendTo(currentWindow({ normal: true }), 'ext-open-popout', { id: entry.id, path: url.slice(`chrome-extension://${extId}/`.length), width: Number(width) || 0, height: Number(height) || 0 });
}
ipcMain.on('ultima:ext-open-popout', (e, url, width, height) => openPopoutForExtension(extIdOf(e.senderFrame?.url), url, width, height));
ipcMain.on('ultima:ext-close-popout', (e) => { if (extIdOf(e.senderFrame?.url)) broadcast('ext-close-popout'); });
// Gives an extension popup's page the real keyboard focus. When a popup opens, the web page behind it still has the
// keyboard: the popup shows its cursor (Bitwarden focuses its PIN field) but key presses keep going to the page until
// you click or Tab inside the popup. Chromium only moves the keyboard between pages on real input — focus() calls,
// even webContents.focus(), are refused as focus stealing — so the UI asks for a click on the very field the popup
// already focused (`point`, in UI coordinates), delivered through the window like your own click. Without a point
// (nothing focused to type into) it falls back to focus(), which is harmless.
ipcMain.on('ultima:focus-guest', (e, id, point) => {
  const wc = windowOf(e.sender) && webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed() || wc.hostWebContents !== e.sender) return;
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    for (const type of ['mouseDown', 'mouseUp']) e.sender.sendInputEvent({ type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
  } else {
    e.sender.focus();
    wc.focus();
  }
});
// the UI says which popup page is showing as a popout
ipcMain.on('ultima:popout-shown', (e, id) => {
  const wc = windowOf(e.sender) && webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed() || !extIdOf(wc.getURL())) return;
  popouts.add(wc.id);
  wc.once('destroyed', () => popouts.delete(wc.id));
});

// ---- tab and navigation events for extensions ----
// Electron doesn't send chrome.tabs / chrome.webNavigation / chrome.windows events, so Ultima watches its tabs and
// forwards them (extension-compat.js turns them back into the real chrome.* events). Tab ids are webContents ids,
// as in Electron's own chrome.tabs. Extensions see one window, id 0: whichever Ultima window you're using, so "the
// current window's active tab" is the one in front of you. Private tabs are hidden from them, as in Chrome.
// Frame ids follow Chrome: 0 for the top frame.
const frameIdOf = (wc, frame) => (!frame || frame === wc.mainFrame ? 0 : frame.frameTreeNodeId);
const frameOf = (processId, routingId) => { try { return webFrameMain.fromId(processId, routingId); } catch { return null; } };
function frameDetails(wc, frame) {
  return {
    frameId: frameIdOf(wc, frame), parentFrameId: frame.parent ? frameIdOf(wc, frame.parent) : -1, url: frame.url, errorOccurred: false,
    frameType: frame.parent ? 'sub_frame' : 'outermost_frame', documentLifecycle: 'active', processId: frame.processId,
  };
}
function tabDetails(wc) {
  const w = windowOf(wc);
  const active = Boolean(w) && w.activeTab === wc.id && w === currentWindow({ normal: true });
  return {
    id: wc.id, windowId: 0, index: 0, url: wc.getURL(), title: wc.getTitle(), status: wc.isLoading() ? 'loading' : 'complete',
    active, highlighted: active, selected: active, pinned: false,
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
  broadcast('ext-worker-started', extId);
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
  const emit = (name, ...args) => { if (!wc.isDestroyed() && !isExtensionPopup(wc) && !isPrivate(wc)) dispatchExtEvent(name, args); };
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
    for (const w of windows.values()) if (w.activeTab === tabId) w.activeTab = null;
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
  const cur = currentWindow({ normal: true });
  const inCurrent = new Set(); // tab ids in the window you're using ("the current window" is that one, not the popout)
  const tabs = webContents.getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && wc.getType() === 'webview' && (!isExtensionPopup(wc) || popouts.has(wc.id)) && windowOf(wc) && !isPrivate(wc))
    .map((wc) => {
      if (popouts.has(wc.id)) return { ...tabDetails(wc), windowId: POPOUT_WINDOW, active: true, highlighted: true, selected: true };
      if (windowOf(wc) === cur) inCurrent.add(wc.id);
      return tabDetails(wc);
    });
  const urls = q.url === undefined ? null : [].concat(q.url);
  const titleRe = typeof q.title === 'string' ? new RegExp(`^${q.title.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) : null;
  const windowType = (t) => (t.windowId === POPOUT_WINDOW ? 'popup' : 'normal');
  return tabs.filter((t) => (q.active === undefined || t.active === q.active)
    && (q.windowType === undefined || q.windowType === windowType(t))
    && (q.windowId !== -2 || inCurrent.has(t.id))
    && (q.currentWindow === undefined || q.currentWindow === inCurrent.has(t.id))
    && (q.lastFocusedWindow === undefined || q.lastFocusedWindow === inCurrent.has(t.id))
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
const knownPartition = (partition) => (SPACE_PARTITION.test(partition || '') || partition === PRIVATE_PARTITION ? partition : PARTITION);
function partitionSession(partition) {
  const name = knownPartition(partition);
  const ses = session.fromPartition(name);
  if (!configuredSessions.has(name)) {
    configuredSessions.add(name);
    setupSession(ses);
    if (name !== PRIVATE_PARTITION) extensions?.attach(ses, name).then(() => broadcast('extensions-changed'));
  }
  return ses;
}

// The last private page closed: forget everything private browsing kept (cookies, storage, cache, sign-ins to
// servers, remembered permissions, its finished downloads in the list).
function endPrivateBrowsingIfUnused() {
  const ses = session.fromPartition(PRIVATE_PARTITION);
  if (webContents.getAllWebContents().some((wc) => !wc.isDestroyed() && wc.session === ses)) return;
  ses.clearStorageData().catch(() => {});
  ses.clearCache().catch(() => {});
  ses.clearAuthCache().catch(() => {});
  for (const origin of Object.keys(privatePermissions)) delete privatePermissions[origin];
  for (const [id, d] of downloads) if (d.private && d.state !== 'progressing') downloads.delete(id);
}

// ---- ad and tracker blocking (the engine is blocker.js) ----
let blocker = null;
const blockLists = () => (settings.data.blockAds ? ADS : 0) | (settings.data.blockTrackers ? TRACKERS : 0);
const siteKey = (host) => host.replace(/^www\./, '');
// blocking is off on a site you turned it off for, and on its subdomains
const blockingOffFor = (pageUrl) => [...hostChain(siteKey(urlHost(pageUrl)))].some((h) => settings.data.blockingOff[h]);

// The pages a request belongs to: the document asking for it (what third-party and domain= rules look at) and the top
// page, the one in the address bar (what the per-site switch looks at). Frames that are gone, and service workers,
// fall back to the tab's page or the referrer.
function requestPages(d) {
  let frameUrl = '';
  let topUrl = '';
  try {
    const frame = d.resourceType === 'subFrame' ? d.frame?.parent : d.frame;
    frameUrl = frame?.url || '';
    topUrl = frame?.top?.url || '';
  } catch { /* the frame went away */ }
  if (!topUrl) { try { topUrl = d.webContents?.getURL() || ''; } catch { /* closed */ } }
  if (!topUrl) topUrl = d.referrer || '';
  if (!/^https?:/i.test(frameUrl)) frameUrl = topUrl; // about:blank and srcdoc frames act for the page around them
  return { frameUrl, topUrl };
}

// How many requests were blocked on each tab's page; the UI shows it on the address bar's shield
const blockedCounts = new Map(); // page webContents id → count
const countsToSend = new Set();
let countTimer = null;
function reportBlocked(wcId, reset = false) {
  if (!wcId) return;
  blockedCounts.set(wcId, reset ? 0 : (blockedCounts.get(wcId) || 0) + 1);
  countsToSend.add(wcId);
  countTimer ??= setTimeout(() => {
    countTimer = null;
    for (const id of countsToSend) {
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) sendTo(windowOf(wc), 'blocked-count', { webContentsId: id, count: blockedCounts.get(id) || 0 });
      else blockedCounts.delete(id);
    }
    countsToSend.clear();
  }, 250);
}

// Tracking codes in links: campaign tags and click ids that tell a site (and its ad networks) where you came from
const TRACKING_PARAMS = new Set(`fbclid gclid gclsrc dclid gbraid wbraid msclkid yclid ysclid twclid ttclid li_fat_id
  igshid igsh mc_cid mc_eid _hsenc _hsmi __hssc __hstc __hsfp hsctatracking mkt_tok oly_anon_id oly_enc_id vero_id
  vero_conv wickedid rb_clickid s_cid _openstat epik srsltid irclickid sc_cid trk_contact trk_msg trk_module trk_sid
  pk_campaign pk_kwd pk_source pk_medium mtm_campaign mtm_source mtm_medium mtm_keyword ga_source ga_medium
  ga_campaign ga_content ga_term`.split(/\s+/));
const isTrackingParam = (key) => key.startsWith('utm_') || TRACKING_PARAMS.has(key);
// the link without them (null when it has none); the rest of the address is left exactly as it was
function cleanLink(url) {
  const q = url.indexOf('?');
  if (q < 0) return null;
  const hash = url.indexOf('#', q);
  const parts = url.slice(q + 1, hash < 0 ? undefined : hash).split('&');
  const kept = parts.filter((part) => {
    let key = part.split('=')[0];
    try { key = decodeURIComponent(key); } catch { /* left as it is */ }
    return !isTrackingParam(key.toLowerCase());
  });
  if (kept.length === parts.length) return null;
  return url.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + (hash < 0 ? '' : url.slice(hash));
}

// a request to another site than the page's (for blocking third-party cookies)
function thirdPartyRequest(d) {
  if (d.resourceType === 'mainFrame') return false;
  const { topUrl } = requestPages(d);
  if (!/^https?:/i.test(topUrl) || blockingOffFor(topUrl)) return false;
  return baseDomain(urlHost(d.url)) !== baseDomain(urlHost(topUrl));
}

function onBlockerRequest(d, callback) {
  const wcId = d.webContentsId;
  if (d.resourceType === 'mainFrame') {
    if (wcId) reportBlocked(wcId, true); // a new page: its count starts again
    const clean = settings.data.cleanLinks && d.method === 'GET' && !blockingOffFor(d.url) && cleanLink(d.url);
    return callback(clean ? { redirectURL: clean } : {});
  }
  if (!blocker?.engine || !/^(https?|wss?):/i.test(d.url)) return callback({});
  const { frameUrl, topUrl } = requestPages(d);
  if (!/^https?:/i.test(topUrl) || blockingOffFor(topUrl)) return callback({});
  if (d.resourceType === 'subFrame' && settings.data.cleanLinks && d.method === 'GET') {
    const clean = cleanLink(d.url);
    if (clean) return callback({ redirectURL: clean });
  }
  const hit = blocker.engine.match(d.url, d.resourceType, frameUrl, blockLists());
  if (hit) reportBlocked(wcId);
  return callback(hit ? { cancel: true } : {});
}

// Global Privacy Control in every page (navigator.globalPrivacyControl) while it's on; the header is added per request
const GPC_PRELOAD = 'ultima-gpc';
function applyGpcPreload(ses) {
  const on = settings.data.globalPrivacyControl;
  const has = ses.getPreloadScripts().some((p) => p.id === GPC_PRELOAD);
  if (on && !has) ses.registerPreloadScript({ type: 'frame', id: GPC_PRELOAD, filePath: path.join(__dirname, '..', 'gpc-preload.js') });
  else if (!on && has) ses.unregisterPreloadScript(GPC_PRELOAD);
}

function setupSession(ses) {
  ses.setUserAgent(app.userAgentFallback);
  // fills gaps in Electron's extension APIs (storage.sync/managed) inside extension workers and pages
  for (const type of ['service-worker', 'frame']) {
    ses.registerPreloadScript({ type, id: `ultima-extension-compat-${type}`, filePath: path.join(__dirname, '..', 'extension-compat.js') });
  }
  // ads and trackers (blocker.js), and tracking codes in links
  ses.webRequest.onBeforeRequest(onBlockerRequest);
  ses.registerPreloadScript({ type: 'frame', id: 'ultima-blocker', filePath: path.join(__dirname, '..', 'blocker-preload.js') });
  ses.registerPreloadScript({ type: 'frame', id: 'ultima-glance', filePath: path.join(__dirname, '..', 'glance-preload.js') });
  ses.registerPreloadScript({ type: 'frame', id: 'ultima-caret', filePath: path.join(__dirname, '..', 'caret-preload.js') });
  applyGpcPreload(ses);
  // Global Privacy Control, and no cookies sent to other sites than the page's while third-party cookies are blocked
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const gpc = settings.data.globalPrivacyControl;
    const noCookies = settings.data.blockThirdPartyCookies && thirdPartyRequest(details);
    if (!gpc && !noCookies) return callback({});
    const headers = { ...details.requestHeaders };
    if (gpc) headers['Sec-GPC'] = '1';
    if (noCookies) for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k];
    callback({ requestHeaders: headers });
  });
  // blocked JavaScript or images (site settings), and no cookies set by other sites while third-party cookies are blocked
  ses.webRequest.onHeadersReceived((details, callback) => {
    const noCookies = settings.data.blockThirdPartyCookies && thirdPartyRequest(details);
    const frame = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
    const policy = frame ? siteContentPolicy(originOf(details.url)) : '';
    if (!policy && !noCookies) return callback({});
    const headers = { ...details.responseHeaders };
    if (policy) {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy') || 'Content-Security-Policy';
      headers[key] = [...(headers[key] || []), policy];
    }
    if (noCookies) for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k];
    callback({ responseHeaders: headers });
  });
  // Chrome's window.chrome in every web page, which Google's sign-in requires (see page-compat.js)
  ses.registerPreloadScript({ type: 'frame', id: 'ultima-page-compat', filePath: path.join(__dirname, '..', 'page-compat.js') });
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
      worker.ipc.on('ultima:ext-close-popout', () => broadcast('ext-close-popout'));
      worker.ipc.handle('ultima:ext-contexts', (_e, filter) => extensionContexts(extId, filter));
      worker.ipc.handle('ultima:ext-frames', (_e, details) => extensionFrames(details));
      worker.ipc.handle('ultima:ext-tabs', (_e, q) => queryTabs(q));
      worker.ipc.handle('ultima:ext-alarms', (_e, op, args) => extensionAlarms(ses, extId, op, Array.isArray(args) ? args : []));
      worker.ipc.handle('ultima:ext-installed', () => extensions?.takeInstalled(ses, extId) || null);
    } catch { /* the worker stopped before it could be hooked; it is hooked when it runs again */ }
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (AUTO_ALLOW.has(permission)) return true;
    const origin = originOf(requestingOrigin);
    if (permission === 'media') {
      const keys = details?.mediaType === 'video' ? ['camera'] : details?.mediaType === 'audio' ? ['microphone'] : ['camera', 'microphone'];
      return keys.every((k) => allowsIn(ses, origin, k) === true);
    }
    return allowsIn(ses, origin, permission) === true;
  });

  ses.setPermissionRequestHandler(async (wc, requested, callback, details) => {
    // Electron 44 reports screen sharing as `media` with no devices listed (45 names it `display-capture`): treat it
    // as screen sharing, so it's asked as such and remembered apart from the camera and microphone.
    const permission = requested === 'media' && !details.mediaTypes?.length ? 'display-capture' : requested;
    if (AUTO_ALLOW.has(permission)) return callback(true);
    const origin = originOf(details.requestingUrl || wc.getURL());
    // the camera and microphone are decided apart: a block on either refuses, and only undecided ones are asked
    const keys = permission === 'media' ? [...new Set(details.mediaTypes.map((m) => (m === 'video' ? 'camera' : 'microphone')))] : [permission];
    const states = keys.map((k) => allowsIn(ses, origin, k));
    if (states.includes(false)) return callback(false);
    if (states.every((v) => v === true)) return callback(true);
    const undecided = keys.filter((_k, i) => states[i] === undefined);
    let what = permission === 'media' ? `use your ${undecided.join(' and ')}`
      : SITE_PERMS.BY_KEY[permission]?.what || PERMISSION_LABELS[permission] || `use “${permission}”`;
    if (permission === 'openExternal' && details.externalURL) what = `open ${new URL(details.externalURL).protocol} links in another app`;
    // asked in Ultima's own dialog, in the page's window; no window to ask in means no
    const answer = await askUi('permission', { site: hostOf(origin) || origin, what }, windowOf(wc));
    const allow = Boolean(answer?.allow);
    if (answer?.remember) {
      const choices = Object.fromEntries(undecided.map((k) => [k, allow]));
      if (isPrivateSession(ses)) privatePermissions[origin] = { ...privatePermissions[origin], ...choices };
      else setSitePermissions(origin, choices);
    }
    callback(allow);
  });

  // A private download stays out of the other windows' download lists; only the window it started in shows it.
  ses.on('will-download', (_e, item, wc) => {
    const from = windowOf(wc);
    const priv = isPrivateSession(ses);
    const dir = downloadDir().dir;
    const parsed = path.parse(item.getFilename());
    let target = path.join(dir, parsed.base);
    for (let i = 1; fs.existsSync(target); i += 1) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    // Asking: Electron shows the Save As dialog once this returns (cancelling it cancels the download)
    if (settings.data.askWhereToSave) item.setSaveDialogOptions({ title: 'Save download', defaultPath: target });
    else item.setSavePath(target);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const report = (state) => {
      const saved = item.getSavePath();
      if (!saved) return; // the Save As dialog is still open, or was cancelled: nothing to show yet
      const d = {
        id, state, filename: path.basename(saved), path: saved, url: item.getURL(),
        received: item.getReceivedBytes(), total: item.getTotalBytes(), started: item.getStartTime() * 1000,
        windowId: from?.win.id, private: priv || undefined,
      };
      downloads.set(id, d);
      if (priv) sendTo(from, 'download', d);
      else broadcast('download', d);
    };
    report('progressing');
    item.on('updated', (_ev, state) => report(state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'));
    item.once('done', (_ev, state) => report(state));
  });
}

// Where downloads go: the folder chosen in Settings → General, or the system's Downloads folder (also when the chosen
// one has gone, e.g. a removed drive)
function downloadDir() {
  const chosen = settings.data.downloadDir;
  try { if (chosen && fs.statSync(chosen).isDirectory()) return { dir: chosen, isDefault: false }; } catch { /* gone */ }
  return { dir: app.getPath('downloads'), isDefault: true, missing: chosen || undefined };
}

// Mica/vibrancy take their light or dark tint from the native theme, so keep it in step with ours.
function syncNativeTheme() {
  nativeTheme.themeSource = ['dark', 'light'].includes(settings.data.theme) ? settings.data.theme : 'system';
}

// Ultima draws its own menus and handles its own shortcuts, so Windows and Linux get no menu bar. macOS keeps a small
// one: there the menu bar is what makes Quit, Hide and copy/paste in text boxes work. Its items are system roles only,
// so they never compete with Ultima's shortcuts (whose Mac defaults leave Cmd+H and Cmd+Q to the system).
function setAppMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ]));
  // run from source the Dock shows Electron's icon; the built app has its own .icns
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon-mac.png'));
}

// Where settings, history and the rest live, shortened for display: %APPDATA%\Ultima Browser, ~/Library/…
function dataFolderLabel() {
  const dir = app.getPath('userData');
  if (process.platform === 'win32') return process.env.APPDATA && dir.startsWith(process.env.APPDATA) ? `%APPDATA%${dir.slice(process.env.APPDATA.length)}` : dir;
  const home = os.homedir();
  return dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
}

// ---- window ----
// the window and taskbar icon (the .ico carries every size Windows asks for; build/make-icons.js makes both)
const APP_ICON = path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// The session file: the shared sidebar, and each open normal window's own tabs and place on screen.
//   { v: 2, sidebar: { spaces, kept }, windows: [{ key, bounds, tabs, folders, splits, activeSpaceId, active }] }
const savedWindows = () => sessionStore.data.windows;
const savedWindow = (key) => savedWindows().find((s) => s.key === key) || null;
function forgetWindow(key) {
  sessionStore.data.windows = savedWindows().filter((s) => s.key !== key);
  sessionStore.save(800);
}
// Sessions from before 0.2.0 were one window with every tab in one list: its pinned tabs and Essentials (`kept`, each
// given a key that names it in every window) become the shared sidebar, the rest that window's own tabs.
function migrateSession(s) {
  if (s.v === 2) return s;
  const tabs = Array.isArray(s.tabs) ? s.tabs : [];
  const zoneOf = (t) => (t.zone || (t.pinned ? 'essential' : 'normal'));
  const kept = tabs.filter((t) => zoneOf(t) !== 'normal').map((t) => ({
    key: Math.random().toString(36).slice(2, 12), zone: zoneOf(t), name: t.name, spaceId: t.spaceId,
    homeUrl: t.homeUrl || t.url, homeTitle: t.homeTitle || t.title, homeFavicon: t.homeFavicon ?? t.favicon,
  }));
  const own = tabs.filter((t) => zoneOf(t) === 'normal');
  const activeTab = tabs[s.activeIndex || 0];
  const active = !activeTab ? null : zoneOf(activeTab) === 'normal' ? { normal: own.indexOf(activeTab) } : { key: kept[tabs.filter((t) => zoneOf(t) !== 'normal').indexOf(activeTab)].key };
  return {
    v: 2,
    sidebar: { spaces: s.spaces || [], kept },
    windows: tabs.length || s.spaces ? [{ key: 'main', bounds: null, tabs: own, folders: s.folders, splits: s.splits, activeSpaceId: s.activeSpaceId, active }] : [],
  };
}

// A new window opens a little down and to the right of the one you're in, at its size; a restored one where it was.
function createWindow({ private: priv = false, restore = null, url = null } = {}) {
  const from = currentWindow();
  let bounds = restore?.bounds;
  if (!bounds && from && !from.win.isMaximized() && !from.win.isFullScreen()) {
    const b = from.win.getBounds();
    bounds = { ...b, x: b.x + 28, y: b.y + 28, maximized: false };
  }
  bounds = bounds || (from ? { ...settings.data.window, x: undefined, y: undefined } : settings.data.window);
  // a new normal window when none is open starts afresh: the windows closed before it aren't brought back later
  if (!priv && !restore && !liveWindows().some((w) => !w.private)) { sessionStore.data.windows = []; sessionStore.save(800); }
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 480,
    title: priv ? 'Ultima Browser — Private' : 'Ultima Browser',
    icon: APP_ICON,
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
  const w = { win, private: priv, key: restore?.key || Math.random().toString(36).slice(2, 12), bounds: { ...bounds }, activeTab: null, url };
  windows.set(win.id, w);
  lastFocusedId = win.id;
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  hookShortcuts(win.webContents);

  // each window remembers its own place; the last one moved is where the next first window opens
  const rememberBounds = () => {
    if (win.isDestroyed()) return;
    w.bounds = win.isMaximized() || win.isFullScreen()
      ? { ...w.bounds, maximized: win.isMaximized() }
      : { ...win.getBounds(), maximized: false };
    if (priv) return;
    settings.data.window = w.bounds;
    settings.save();
    const entry = savedWindow(w.key);
    if (entry) { entry.bounds = w.bounds; sessionStore.save(800); }
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  // `immersive`: Ultima's own full screen (F11), not a page's (a video), which the UI handles itself
  win.on('enter-full-screen', () => sendTo(w, 'window-fullscreen', { on: true, immersive: Boolean(w.immersive) }));
  win.on('focus', () => {
    lastFocusedId = win.id;
    dispatchExtEvent('windows.onFocusChanged', [priv ? -1 : 0]);
    if (!priv) announceActiveTab(w); // to extensions, the window you're in is "the" window, so its tab is the active one
  });
  win.on('blur', () => dispatchExtEvent('windows.onFocusChanged', [-1]));
  win.on('leave-full-screen', () => { w.immersive = false; sendTo(w, 'window-fullscreen', { on: false, immersive: false }); });

  // Lock down every <webview> the UI creates.
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preloadURL;
    prefs.preload = path.join(__dirname, '..', 'webview-preload.js'); // only reports text-box focus
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.spellcheck = true;
    // accessibility: the default zoom (each tab's own goes on top) and text sizes, for pages created from now on
    const a11y = settings.data;
    prefs.zoomFactor = Math.max(0.25, Math.min(5, (Number(a11y.pageZoom) || 100) / 100));
    prefs.defaultFontSize = Math.max(6, Math.min(72, Number(a11y.textSize) || 16));
    prefs.defaultMonospaceFontSize = Math.round(prefs.defaultFontSize * 13 / 16);
    if (Number(a11y.minFontSize) > 0) prefs.minimumFontSize = Math.min(72, Number(a11y.minFontSize));
    params.partition = priv ? PRIVATE_PARTITION : knownPartition(params.partition); // a private window's pages are all private
    partitionSession(params.partition);
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-start-loading', () => { recordingKeys = false; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Closing a window closes its tabs, unless it's the last normal one: then they're what comes back next time.
  win.on('closed', () => {
    windows.delete(win.id);
    if (lastFocusedId === win.id) lastFocusedId = null;
    if (!priv && !quitting && liveWindows().some((x) => !x.private)) forgetWindow(w.key);
    if (!liveWindows().length) taskWindow()?.close(); // the task manager goes with the last window
  });
  return w;
}

// The task manager (Shift+Esc) has a window of its own: one at a time, where it was last, closing with the last
// Ultima window. It isn't one of `windows`: it has no tabs and isn't kept for next time.
let taskWin = null;
const taskWindow = () => (taskWin && !taskWin.isDestroyed() ? taskWin : null);
const toTaskWindow = (channel, payload) => taskWindow()?.webContents.send(channel, payload);

function openTaskManager() {
  const open = taskWindow();
  if (open) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return;
  }
  // where it was, if that's still on a screen
  const b = settings.data.taskManagerWindow;
  const onScreen = b && screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 8 && b.y < a.y + a.height - 40);
  const win = new BrowserWindow({
    width: b?.width || 960,
    height: b?.height || 640,
    x: onScreen ? b.x : undefined,
    y: onScreen ? b.y : undefined,
    minWidth: 620,
    minHeight: 400,
    title: 'Task manager',
    icon: APP_ICON,
    backgroundColor: GLASS ? CLEAR : '#111114',
    backgroundMaterial: BACKDROPS ? settings.data.windowMaterial : undefined,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: GLASS ? CLEAR : '#111114', symbolColor: '#e6e6ee', height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  taskWin = win;
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'tasks.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const remember = () => {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    settings.data.taskManagerWindow = win.getBounds();
    settings.save();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('closed', () => { if (taskWin === win) taskWin = null; });
}

function announceActiveTab(w) {
  const wc = w.activeTab && webContents.fromId(w.activeTab);
  if (wc && !wc.isDestroyed() && !isPrivate(wc)) dispatchExtEvent('tabs.onActivated', [{ tabId: wc.id, windowId: 0 }]);
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
  wc.once('destroyed', () => { releaseWorkerFor(id); pageFavicons.delete(id); });
  wc.on('page-favicon-updated', (_ev, favicons) => { if (favicons?.[0]) pageFavicons.set(id, favicons[0]); });
  const priv = isPrivate(wc);
  if (priv) wc.once('destroyed', () => setTimeout(endPrivateBrowsingIfUnused, 0));
  hookShortcuts(wc);
  hookTabEvents(wc);
  wc.on('context-menu', (_ev, params) => pageContextMenu(wc, params));
  wc.setWindowOpenHandler(({ url, disposition }) => {
    // Real popups (OAuth, payment flows) need window.opener, so give them a window of their own, unless the site's
    // pop-ups are blocked (tabs the user opens from links aren't pop-ups).
    if (disposition === 'new-window' && allowsIn(wc.session, originOf(wc.getURL()), 'popups') === false) {
      const origin = originOf(wc.getURL());
      sendTo(windowOf(wc), 'popup-blocked', { origin, site: hostOf(origin) || origin, url });
      return { action: 'deny' };
    }
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#ffffff', icon: APP_ICON },
      };
    }
    sendTo(windowOf(wc), 'open-url', { url, background: disposition === 'background-tab', private: priv });
    return { action: 'deny' };
  });
});

// ---- IPC ----
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));
  // for handlers that act on the window asking (its dialogs, its tabs, its saved state)
  const handleFrom = (channel, fn) => ipcMain.handle(channel, (e, ...args) => fn(e, ...args));
  const parentOf = (e) => BrowserWindow.fromWebContents(e.sender) || undefined;

  // What a window starts with: the shared sidebar and, for a window that was open last time, its own tabs.
  // A private window gets neither.
  handleFrom('state:get', (e) => {
    const w = windowOf(e.sender);
    const url = w?.url ?? null; // opened once, not again if the UI reloads
    if (w) w.url = null;
    return {
      settings: settings.data,
      private: Boolean(w?.private),
      windowId: w?.win.id ?? null,
      sidebar: w?.private ? null : sessionStore.data.sidebar,
      window: w && !w.private ? savedWindow(w.key) : null,
      platform: process.platform,
      versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      dataFolder: dataFolderLabel(),
      downloads: [...downloads.values()].filter((d) => !d.private || d.windowId === w?.win.id),
      systemDark: nativeTheme.shouldUseDarkColors,
      glass: GLASS,
      backdrops: BACKDROPS,
      hardwareAcceleration: HARDWARE_ACCELERATION, // what this run started with
      launchUrl: url,
    };
  });
  // A window saves its own tabs; when the shared sidebar changed too, the other normal windows get it.
  handleFrom('session:save', (e, s) => {
    const w = windowOf(e.sender);
    if (!w || w.private || !s || typeof s !== 'object') return;
    if (s.window && typeof s.window === 'object') {
      const entry = { ...s.window, key: w.key, bounds: w.bounds };
      const list = savedWindows();
      const i = list.findIndex((x) => x.key === w.key);
      if (i >= 0) list[i] = entry; else list.push(entry);
    }
    // a sidebar always has at least one space: one without any comes from a window that didn't start properly
    if (s.sidebar && typeof s.sidebar === 'object' && Array.isArray(s.sidebar.spaces) && s.sidebar.spaces.length) {
      sessionStore.data.sidebar = s.sidebar;
      broadcast('sidebar-changed', s.sidebar, { except: w, normalOnly: true });
    }
    sessionStore.save(800);
  });
  handle('app:quit', () => app.quit()); // every window is kept for next time (see before-quit)
  // Quits and starts again (a new hardware acceleration setting), with the same switches but not the link or file
  // Ultima was opened with, which would open again. Every window's tabs come back, even with "Restore tabs" off.
  handle('app:relaunch', () => {
    const args = process.argv.slice(1).filter((a) => a !== '--single-argument' && a !== RESTART_SWITCH && !defaultBrowser.launchTarget(['', a]));
    app.relaunch({ args: [...args, RESTART_SWITCH] });
    app.quit();
  });
  // the task manager (taskmanager.js): Ultima's processes, and ending one. The windows showing pages from an ended
  // process are told first, so they unload those tabs instead of showing them as crashed.
  handle('tasks:list', () => taskManager.collect({
    isPrivate,
    describe: (wc) => ({ glance: glancePages.has(wc.id), favicon: pageFavicons.get(wc.id) || '', taskManager: wc === taskWindow()?.webContents }),
  }));
  handle('tasks:end', (pid) => {
    const r = taskManager.endProcess(Number(pid));
    if (!r.ok) return { ok: false };
    broadcast('tasks-ended', r.contents);
    setTimeout(r.kill, 100);
    return { ok: true, pages: r.contents.length };
  });
  handle('tasks:open', () => openTaskManager());
  // a tab's row in the task manager: its window comes forward, showing that tab
  handle('tasks:show', (id) => {
    const wc = webContents.fromId(Number(id));
    const w = wc && windowOf(wc);
    if (!w || wc === w.win.webContents) return;
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
    sendTo(w, 'show-contents', wc.id);
  });
  // what the graphics card is doing right now: Chromium also turns parts off itself, for drivers it knows are broken
  // or after the graphics process crashed
  handle('gpu:status', () => app.getGPUFeatureStatus());
  handleFrom('window:new', (_e, opts) => {
    const url = typeof opts?.url === 'string' && /^(https?|ultima):/i.test(opts.url) ? opts.url : null;
    createWindow({ private: Boolean(opts?.private), url });
  });
  handleFrom('window:close', (e) => parentOf(e)?.close()); // Ctrl+W with no tabs left
  // F11: the window fills the screen, or comes back (see enter-full-screen in createWindow)
  handleFrom('window:fullscreen', (e) => {
    const w = windowOf(e.sender);
    if (!w) return;
    const on = !w.win.isFullScreen();
    w.immersive = on;
    w.win.setFullScreen(on);
  });
  handleFrom('settings:set', (e, patch) => {
    Object.assign(settings.data, patch);
    settings.save();
    if (patch.keybindings) rebuildKeymap();
    if (patch.windowMaterial && BACKDROPS) for (const win of [...liveWindows().map((w) => w.win), taskWindow()].filter(Boolean)) win.setBackgroundMaterial(patch.windowMaterial);
    if ('globalPrivacyControl' in patch) siteSessions().forEach(applyGpcPreload);
    // caret browsing on or off in the pages already open
    if ('caretBrowsing' in patch) for (const wc of webContents.getAllWebContents()) if (wc.getType() === 'webview' && !wc.isDestroyed()) wc.send('ultima:caret', Boolean(patch.caretBrowsing));
    broadcast('settings-changed', patch, { except: windowOf(e.sender) });
    toTaskWindow('settings-changed', patch);
    return settings.data;
  });
  // The UI decides light/dark (a space can override the app setting); Acrylic/Mica and web pages follow it.
  handle('theme:native', (mode) => {
    if (['system', 'light', 'dark'].includes(mode) && nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
  });
  // A favicon as a data: URL, so the UI can read its colors (a canvas can't read a cross-site image). Fetched through
  // the UI's own session, so it usually comes straight from the cache the sidebar loaded it into. Images only, ≤ 1 MB.
  // Copying from the UI. The web clipboard API refuses while a page (not the UI) has focus, which is most of the time.
  handle('clipboard:write', (text) => { if (typeof text === 'string' && text.length <= 1e6) clipboard.writeText(text); });
  handleFrom('favicon:data', async (e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    try {
      const res = await e.sender.session.fetch(url);
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
  // Only the asking window's own tabs (webviews in it) are answered.
  const tabContents = (e, id) => {
    const wc = webContents.fromId(Number(id));
    return wc && !wc.isDestroyed() && wc.getType() === 'webview' && wc.hostWebContents === e.sender ? wc : null;
  };
  handleFrom('tab:history', (e, id) => {
    const wc = tabContents(e, id);
    if (!wc) return null;
    return { entries: wc.navigationHistory.getAllEntries().map((x) => ({ url: x.url, title: x.title })), active: wc.navigationHistory.getActiveIndex() };
  });
  handleFrom('tab:history-go', (e, id, index) => {
    const wc = tabContents(e, id);
    if (wc && Number.isInteger(index) && wc.navigationHistory.canGoToOffset(index - wc.navigationHistory.getActiveIndex())) wc.navigationHistory.goToIndex(index);
  });
  handle('downloads:dir', () => downloadDir());
  handleFrom('downloads:choose-dir', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(e), {
      title: 'Choose where downloads go', buttonLabel: 'Use this folder', defaultPath: downloadDir().dir, properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return null;
    settings.data.downloadDir = filePaths[0];
    settings.save();
    return downloadDir();
  });
  handle('downloads:reset-dir', () => { settings.data.downloadDir = ''; settings.save(); return downloadDir(); });
  handle('default-browser:get', () => defaultBrowser.status());
  handle('default-browser:set', () => defaultBrowser.makeDefault());
  handle('keys:recording', (on) => { recordingKeys = Boolean(on); });
  handle('permissions:reset', () => { settings.data.permissions = {}; settings.save(); });
  // ---- ad and tracker blocking ----
  handle('blocker:status', () => blocker.status());
  handle('blocker:update', async () => {
    const work = blocker.update(true);
    broadcast('blocker-changed');
    await work;
    broadcast('blocker-changed');
    return blocker.status();
  });
  // a site's switch: whether blocking is off there (its own host or a parent domain), and turning it on or off
  handle('blocker:site', (url) => ({ off: /^https?:/i.test(url || '') && blockingOffFor(url), site: siteKey(urlHost(url || '')) }));
  handle('blocker:set-site', ({ url, off }) => {
    const host = siteKey(urlHost(url || ''));
    if (!host) return;
    const list = { ...settings.data.blockingOff };
    if (off) list[host] = true;
    else for (const h of hostChain(host)) delete list[h];
    settings.data.blockingOff = list;
    settings.save();
    broadcast('settings-changed', { blockingOff: list });
  });
  // What blocker-preload.js asks as each web page and frame starts: its scriptlets (synchronously, so they're in place
  // before the page's own scripts run), then its element hiding and procedural rules
  const blockedFrame = (frame) => {
    if (!blocker?.engine || !frame || !blockLists()) return null;
    let topUrl = '';
    try { topUrl = frame.top?.url || ''; } catch { /* gone */ }
    if (!/^https?:/i.test(frame.url) || !/^https?:/i.test(topUrl) || blockingOffFor(topUrl)) return null;
    return { frameUrl: frame.url, topUrl };
  };
  // ---- glance (glance-preload.js notices the gestures in pages; the UI shows the preview) ----
  const tabPage = (wc) => Boolean(wc) && !wc.isDestroyed() && wc.getType() === 'webview' && Boolean(windowOf(wc));
  ipcMain.handle('ultima:glance-config', (e) => {
    if (!tabPage(e.sender)) return null;
    const t = settings.data.glanceTrigger || 'any';
    return { alt: t === 'any' || t === 'alt', shift: t === 'any' || t === 'shift', hold: t === 'any' || t === 'hold' };
  });
  ipcMain.handle('ultima:caret-config', (e) => tabPage(e.sender) && Boolean(settings.data.caretBrowsing));
  ipcMain.on('ultima:glance', (e, d) => {
    if (!tabPage(e.sender) || typeof d?.url !== 'string' || !/^https?:\/\//i.test(d.url)) return;
    const r = d.rect;
    const rect = e.senderFrame === e.sender.mainFrame && r && [r.x, r.y, r.width, r.height].every(Number.isFinite) ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    sendTo(windowOf(e.sender), 'glance', { url: d.url, rect, webContentsId: e.sender.id });
  });
  handleFrom('glance:watch', (e, id, on) => {
    const wc = webContents.fromId(Number(id));
    if (!wc || wc.hostWebContents !== e.sender) return; // only the window's own pages
    if (on) glancePages.add(wc.id); else glancePages.delete(wc.id);
  });
  ipcMain.on('ultima:scriptlets', (e) => {
    try {
      const f = blockedFrame(e.senderFrame);
      e.returnValue = f ? blocker.engine.scriptlets(f.frameUrl, f.topUrl, blockLists()) : [];
    } catch { e.returnValue = []; }
  });
  ipcMain.handle('ultima:cosmetics', (e) => {
    const f = blockedFrame(e.senderFrame);
    return f ? blocker.engine.cosmetics(f.frameUrl, f.topUrl, blockLists()) : null;
  });
  // ---- site settings (see sitepermissions.js) ----
  const webOrigin = (o) => { try { const u = new URL(o); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };
  handle('site:get', (o) => {
    const origin = webOrigin(o);
    return origin && { origin, record: { ...settings.data.permissions[origin] }, defaults: { ...settings.data.siteDefaults } };
  });
  handle('site:list', () => ({
    sites: Object.entries(settings.data.permissions).filter(([o, r]) => webOrigin(o) && r && Object.keys(r).length).map(([origin, record]) => ({ origin, record })),
    defaults: { ...settings.data.siteDefaults },
  }));
  handle('site:set', ({ origin: o, key, value }) => {
    const origin = webOrigin(o);
    if (!origin || !SITE_PERMS.BY_KEY[key] || !(value === true || value === false || value === null)) return;
    setSitePermissions(origin, { [key]: value });
  });
  handle('site:reset', (o) => { const origin = webOrigin(o); if (origin) { delete settings.data.permissions[origin]; settings.save(); } });
  handle('site:default', ({ key, value }) => {
    if (!SITE_PERMS.BY_KEY[key] || !(value === true || value === false || value === null)) return;
    // stored only when it differs from the built-in default (Ask for ask-kind, Allow for allow-kind): that's Block
    if (value === false) settings.data.siteDefaults[key] = false;
    else delete settings.data.siteDefaults[key];
    settings.save();
  });
  // cookies the site has in this space, and clearing its cache, cookies and stored data, in every space
  handle('site:data', async ({ origin: o, partition }) => {
    const origin = webOrigin(o);
    if (!origin) return null;
    const host = new URL(origin).hostname;
    const cookies = (await partitionSession(partition).cookies.get({})).filter((c) => cookieForHost(c, host));
    return { cookies: cookies.length };
  });
  handle('site:clear-data', async ({ origin: o, cache, cookies, storage }) => {
    const origin = webOrigin(o);
    if (!origin) return;
    const host = new URL(origin).hostname;
    for (const ses of siteSessions()) {
      // the pages, scripts and images it served (Chromium matches cache by the file's own origin, so a CDN's stay)
      if (cache) await ses.clearData({ dataTypes: ['cache'], origins: [origin] }).catch(() => {});
      if (cookies) {
        for (const c of (await ses.cookies.get({})).filter((x) => cookieForHost(x, host))) {
          await ses.cookies.remove(`http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`, c.name).catch(() => {});
        }
      }
      if (storage) await ses.clearStorageData({ origin, storages: ['filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'] }).catch(() => {});
    }
  });
  handleFrom('overlay:set', (e, { color, symbolColor }) => {
    const win = parentOf(e);
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
  const extChanged = (result) => { broadcast('extensions-changed'); return result; };
  handle('ext:list', () => extensions.all());
  handle('ext:install-webstore', async (input) => extChanged(await extensions.installFromWebStore(input)));
  handleFrom('ext:install-unpacked', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(e), { title: 'Choose an unpacked extension folder', properties: ['openDirectory'] });
    if (canceled || !filePaths[0]) return null;
    return extChanged(await extensions.installUnpacked(filePaths[0]));
  });
  handle('ext:set-enabled', async ({ id, enabled }) => extChanged(await extensions.setEnabled(id, enabled)));
  handle('ext:set-pinned', ({ id, pinned }) => extChanged(extensions.setPinned(id, pinned)));
  handle('ext:remove', (id) => extChanged(extensions.remove(id)));
  // each window reports which tab is showing in it, for chrome.tabs.onActivated
  handleFrom('tabs:active', (e, id) => {
    const w = windowOf(e.sender);
    const next = Number.isFinite(id) ? id : null;
    if (!w || next === w.activeTab) return;
    w.activeTab = next;
    if (next !== null && w === currentWindow({ normal: true })) announceActiveTab(w);
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
  handleFrom('import:passwords-csv', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(e), {
      title: 'Import passwords from CSV', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const entries = importer.passwordsFromCsv(fs.readFileSync(filePaths[0], 'utf8'));
    return { found: entries.length, added: await data.mergePasswords(entries, path.basename(filePaths[0])), file: filePaths[0] };
  });
  handleFrom('import:bookmarks-html', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(e), {
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
  handleFrom('ui:edit', (e, action) => {
    if (['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll'].includes(action)) e.sender[action]();
  });
  handle('ask:answer', ({ id, answer }) => {
    pendingAsks.get(id)?.(answer);
    pendingAsks.delete(id);
  });
}

// Questions for the user (e.g. permission prompts) are shown by the UI in Ultima's own dialogs.
const pendingAsks = new Map();
let askSeq = 0;
// (in the window the question comes from, or the one you're using)
function askUi(kind, payload, w = null) {
  const target = w || currentWindow();
  if (!target) return Promise.resolve(null);
  return new Promise((resolve) => {
    askSeq += 1;
    pendingAsks.set(askSeq, resolve);
    sendTo(target, 'ask', { id: askSeq, kind, payload });
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

// Ultima started again (a link from another app, the taskbar icon): the last normal window you used comes forward and
// opens the link; with only private windows open, a normal one opens for it.
app.on('second-instance', (_e, argv) => {
  const url = defaultBrowser.launchTarget(argv);
  const w = currentWindow({ normal: true });
  if (!w) { if (app.isReady()) createWindow({ url }); return; }
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  if (url) sendTo(w, 'open-url', { url, background: false });
});

// macOS hands links over as an event, also before the window exists
// A server or proxy asking for a username and password (Basic/Digest, or NTLM/Negotiate when Windows' own sign-in
// isn't accepted), e.g. a filtering proxy on a school or office network. Electron cancels these unless asked, which
// leaves pages waiting on requests that never finish; Chrome asks, and so does Ultima. Requests asking for the same
// server at once (dozens, behind a proxy) share one dialog; Chromium then reuses the answer for that server.
const pendingLogins = new Map(); // host|realm|proxy → Promise of the answer
app.on('login', (event, wc, details, authInfo, callback) => {
  event.preventDefault();
  const key = `${authInfo.host}:${authInfo.port}|${authInfo.realm}|${authInfo.isProxy}`;
  let answer = pendingLogins.get(key);
  if (!answer) {
    const defaultPort = { http: 80, https: 443 }[authInfo.scheme] || (authInfo.isProxy ? 0 : 443);
    answer = askUi('login', {
      host: authInfo.port && authInfo.port !== defaultPort ? `${authInfo.host}:${authInfo.port}` : authInfo.host,
      realm: authInfo.realm || '',
      proxy: authInfo.isProxy,
      retry: details.firstAuthAttempt === false,
      insecure: !authInfo.isProxy && /^http:/i.test(details.url || ''),
    }, windowOf(wc)).finally(() => pendingLogins.delete(key));
    pendingLogins.set(key, answer);
  }
  answer.then((a) => (a?.username ? callback(a.username, a.password || '') : callback()), () => callback());
});

app.on('open-url', (e, url) => {
  e.preventDefault();
  const w = windows.size ? currentWindow({ normal: true }) : null;
  if (w) sendTo(w, 'open-url', { url, background: false });
  else if (windows.size) createWindow({ url }); // only private windows are open
  else if (app.isReady()) createWindow({ url, restore: savedWindows()[0] }); // macOS, every window closed
  else launchUrl = url;
});

app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  settings = new JsonStore(dir, 'settings', DEFAULT_SETTINGS);
  // Glance first had a switch per gesture; now it's one choice
  for (const k of ['glanceAlt', 'glanceShift', 'glanceHold']) delete settings.data[k];
  syncNativeTheme();
  rebuildKeymap();
  sessionStore = new JsonStore(dir, 'session', { sidebar: null, windows: [] });
  sessionStore.data = migrateSession(sessionStore.data);
  data = new BrowserData(dir);
  data.onBookmarksChanged = () => broadcast('bookmarks-changed');
  extensions = new ExtensionManager(dir);
  extLogFile = path.join(dir, 'logs', 'extensions.log');
  fs.mkdirSync(path.dirname(extLogFile), { recursive: true });
  setAppMenu();
  // the ad and tracker lists on disk, ready before the first page loads; refreshed in the background when they're due
  blocker = new Blocker(path.join(dir, 'filters'), async (url) => {
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  blocker.load();
  const refreshLists = () => blocker.update().then((changed) => { if (changed) broadcast('blocker-changed'); }).catch(() => {});
  setTimeout(refreshLists, 5000);
  setInterval(refreshLists, 6 * 60 * 60 * 1000);
  partitionSession(PARTITION);
  registerIpc();
  await widevineReady();
  // every window that was open last time comes back (its regular tabs only when "Restore tabs" is on; the shared
  // sidebar always does); a link Ultima was started with opens in the last of them
  if (!settings.data.restoreSession && !process.argv.includes(RESTART_SWITCH)) sessionStore.data.windows = savedWindows().slice(0, 1).map((s) => ({ key: s.key, bounds: s.bounds }));
  const restore = savedWindows();
  if (restore.length) restore.forEach((r, i) => createWindow({ restore: r, url: i === restore.length - 1 ? launchUrl : null }));
  else createWindow({ url: launchUrl });
  launchUrl = null;
  defaultBrowser.refreshRegistration();
  nativeTheme.on('updated', () => { broadcast('system-theme', nativeTheme.shouldUseDarkColors); toTaskWindow('system-theme', nativeTheme.shouldUseDarkColors); });
  // macOS: clicking the Dock icon with every window closed brings back the last one
  app.on('activate', () => { if (!liveWindows().length) createWindow({ restore: savedWindows()[0] }); });
});

// signing out of Windows or shutting down closes the windows one by one: all of them come back, as after Quit
app.on('session-end', () => { quitting = true; });

app.on('before-quit', () => {
  quitting = true; // windows closing now are kept for next time
  taskManager.stopGpu();
  data?.flush();
  for (const s of [settings, sessionStore]) if (s?.timer) s.flush();
});

app.on('window-all-closed', () => {
  data?.flush();
  if (process.platform !== 'darwin') app.quit();
});
