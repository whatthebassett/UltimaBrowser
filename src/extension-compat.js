// Compatibility for Chrome extensions, run in their service workers and pages (never in websites).
// Electron implements only part of Chrome's extension API. Extensions that touch a missing API at start-up
// crash (e.g. Bitwarden's background reads chrome.webNavigation.onCommitted), so here:
//   • storage.sync / storage.managed are backed by storage.local (there's no Chrome account to sync with);
//   • commonly used calls get sensible versions (current window, opening tabs, tabs.get/getCurrent…);
//   • any other missing API becomes a harmless stand-in (events that never fire, calls that resolve empty),
//     so the extension degrades instead of failing to start.
const { contextBridge, ipcRenderer } = require('electron');

// Lets extension code ask Ultima to open/close tabs and list its contexts. Main ignores anything not sent by an extension.
// Ultima also forwards tab, navigation and window events here (see dispatchExtEvent in main.js).
// Events can arrive while the worker is still starting, before the code below has subscribed: hold those until it does.
let onHostEvent = null;
const early = [];
const hostEvent = (name, args) => { if (onHostEvent) onHostEvent(name, args); else if (early.length < 50) early.push([name, args]); };
ipcRenderer.on('ultima:ext-event', (_e, name, args) => hostEvent(name, args));
// Main hooks up each background worker as it starts, and a worker can call before that (Stylus sets its alarms at
// once): the call then fails with "No handler registered", and an extension that waits on it never finishes
// starting. So a worker's calls wait until it is hooked up: its first call below answers, or main says so after
// hooking it (there are no timers here to try again with).
const isWorker = typeof document === 'undefined';
const takeInstalled = () => ipcRenderer.invoke('ultima:ext-installed')
  .then((details) => { if (details) hostEvent('runtime.onInstalled', [details]); });
const hooked = !isWorker ? Promise.resolve() : new Promise((resolve) => {
  ipcRenderer.once('ultima:ext-hooked', () => resolve(takeInstalled().catch(() => {})));
  // A background worker asks straight away whether it was just installed or updated (Electron never says).
  takeInstalled().then(resolve, () => { /* not hooked yet: main says when it is */ });
});
const invoke = (channel, ...args) => hooked.then(() => ipcRenderer.invoke(channel, ...args));
const send = (channel, ...args) => { hooked.then(() => ipcRenderer.send(channel, ...args)); };
const hostApi = {
  openTab: (url) => send('ultima:ext-open-tab', String(url)),
  closeTabs: (ids) => send('ultima:ext-close-tabs', ids),
  openPopout: (url, width, height) => send('ultima:ext-open-popout', String(url), Number(width) || 0, Number(height) || 0),
  closePopout: () => send('ultima:ext-close-popout'),
  getContexts: (filter) => invoke('ultima:ext-contexts', filter && typeof filter === 'object' ? filter : {}),
  frames: (details) => invoke('ultima:ext-frames', details && typeof details === 'object' ? details : {}),
  queryTabs: (q) => invoke('ultima:ext-tabs', q && typeof q === 'object' ? q : {}),
  storageChanged: (changes, area) => send('ultima:ext-storage-changed', changes, String(area)),
  alarms: (op, args) => invoke('ultima:ext-alarms', String(op), Array.isArray(args) ? args : []),
  unsupported: (name) => send('ultima:ext-unsupported', String(name)),
  call: (area, op, args) => invoke('ultima:ext-call', String(area), String(op), Array.isArray(args) ? args : []),
  onEvent: (cb) => {
    onHostEvent = cb;
    while (early.length) { const [name, args] = early.shift(); cb(name, args); }
  },
};

// Most extension contexts are isolated, so the fixes are run in the extension's own world through the bridge.
// Offscreen documents run with isolation off: there this preload already shares the extension's world.
// Chrome's API list (src/extension-api.json) comes first in the copy of this file main registers: preloads can't read files.
/* global EXTENSION_API */
const api = typeof EXTENSION_API === 'undefined' ? null : EXTENSION_API;
function install(compat) {
  if (process.contextIsolated === false) {
    globalThis.__ultimaExtHost = hostApi;
    compat(api);
    return;
  }
  try { contextBridge.exposeInMainWorld('__ultimaExtHost', hostApi); } catch { /* not available in this context */ }
  contextBridge.executeInMainWorld({ func: compat, args: [api] });
}

// The extension check happens inside the page/worker itself: a worker's preload context has no `location`.
install(
  (api) => {
    if (globalThis.location?.protocol !== 'chrome-extension:') return;
    const chrome = globalThis.chrome;
    if (!chrome) return;
    const host = globalThis.__ultimaExtHost;
    try { // a failure here is reported in the extension log (Settings → Extensions → Troubleshooting)

    // Electron also defines a Firefox-style `browser`; Chrome doesn't, and extensions treat it as "this is Firefox".
    // (Web Store copies also hide it in their content scripts; see makeChromeLike in extensions.js.)
    if (typeof globalThis.browser !== 'undefined' && globalThis.browser !== chrome) {
      try { delete globalThis.browser; } catch { /* not deletable */ }
      if (typeof globalThis.browser !== 'undefined') {
        try { Object.defineProperty(globalThis, 'browser', { value: undefined, configurable: true, writable: true }); } catch { /* fixed */ }
      }
    }

    // calls resolve their promise and also call a trailing callback, like Chrome's own
    const done = (args, value) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') setTimeout(() => { try { cb(value); } catch { /* the extension's own error */ } });
      return Promise.resolve(value);
    };
    // A call Ultima answers itself (EXTENSION_CALLS in main.js): it resolves or rejects like Chrome's, and a trailing
    // callback gets the answer, with chrome.runtime.lastError set while it runs if the call failed.
    const withLastError = (message, fn) => {
      const runtime = chrome.runtime;
      try { Object.defineProperty(runtime, 'lastError', { value: { message }, configurable: true }); } catch { /* fixed */ }
      try { fn(); } finally { try { delete runtime.lastError; } catch { /* fixed */ } }
    };
    const viaUltima = (area, op, args) => {
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      const clean = (err) => new Error(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      const answer = host?.call ? host.call(area, op, args).catch((err) => { throw clean(err); }) : Promise.reject(new Error('Not available here'));
      if (!cb) return answer;
      answer.then((v) => cb(v ?? undefined), (err) => withLastError(err.message, () => cb()));
      return undefined;
    };

    // Events Ultima really delivers (tabs.*, webNavigation.*, windows.onFocusChanged), keyed by "namespace.onName"
    const live = {};
    // Some events can arrive before the extension subscribes (runtime.onInstalled is sent as its background starts);
    // like Chrome, those are held and handed to the first listener instead of being lost.
    const HELD = new Set(['runtime.onInstalled', 'alarms.onAlarm']);
    const liveEvent = (name) => {
      if (!live[name]) {
        const listeners = new Set();
        const held = [];
        const call = (f, args) => { try { f(...args); } catch (err) { setTimeout(() => { throw err; }); } }; // reported as uncaught
        live[name] = {
          addListener: (f) => {
            listeners.add(f);
            while (held.length) { const args = held.shift(); setTimeout(() => call(f, args)); }
          },
          removeListener: (f) => listeners.delete(f),
          hasListener: (f) => listeners.has(f),
          hasListeners: () => listeners.size > 0,
          fire: (args) => {
            if (!listeners.size && HELD.has(name)) { held.push(args); return; }
            for (const f of [...listeners]) call(f, args);
          },
        };
      }
      return live[name];
    };
    host?.onEvent?.((name, args) => live[name]?.fire(args));
    const liveEvents = (ns, names) => Object.fromEntries(names.map((n) => [n, liveEvent(`${ns}.${n}`)]));

    const event = () => {
      const listeners = new Set();
      return {
        addListener: (f) => listeners.add(f),
        removeListener: (f) => listeners.delete(f),
        hasListener: (f) => listeners.has(f),
        hasListeners: () => listeners.size > 0,
      };
    };
    const LISTS = /^(getAll|query|search|getTree|getRecent|getSubTree|getVisits|getContexts|getChildren|getDevices|getScripts|getFontList)/;
    const stand = (cache, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (!(key in cache)) {
        if (/^on[A-Z]/.test(key)) cache[key] = event();
        else if (/^[A-Z][A-Z_]*$/.test(key)) return undefined; // constants
        else cache[key] = (...args) => done(args, LISTS.test(key) ? [] : undefined);
      }
      return cache[key];
    };
    // a namespace Electron lacks entirely
    const missing = (extras = {}) => new Proxy(extras, { get: (t, k) => (k in t ? t[k] : stand(t, k)) });
    // a namespace Electron has, with our additions and stand-ins for what it lacks
    const patched = (ns, extras = {}) => {
      const cache = {};
      const bound = new Map();
      return new Proxy(ns, {
        get: (t, k) => {
          if (k in extras) return extras[k];
          if (k in t) {
            // Electron's own functions must run on the real namespace, not this wrapper (or they quietly return nothing)
            const v = Reflect.get(t, k);
            if (typeof v !== 'function') return v;
            if (!bound.has(k)) bound.set(k, v.bind(t));
            return bound.get(k);
          }
          // On namespaces Electron does have, only missing *events* get stand-ins. Other absent properties stay
          // absent: some are meant to be missing most of the time (runtime.lastError only exists after an error).
          return typeof k === 'string' && /^on[A-Z]/.test(k) ? stand(cache, k) : undefined;
        },
      });
    };
    // Pinned: when another extension is installed, Electron rebuilds chrome.* in running extensions, which would
    // silently drop these fixes (Bitwarden then failed with "chrome.tabs.create is not a function").
    const define = (key, value) => {
      try { Object.defineProperty(chrome, key, { get: () => value, set: () => {}, configurable: false, enumerable: true }); } catch { /* fixed */ }
    };

    // ---- storage: change events in the background ----
    // Electron 45.0.0 never delivers extension events to background service workers (electron/electron#52451, fixed
    // by #55146 in a later 45.x). Bitwarden's state only updates through storage.onChanged, so without it a fresh
    // install never finishes setting up. A worker hears its own writes (each write compares its keys before and after)
    // and extension pages' writes, which pages forward to it. The events are replaced rather than added to, so nothing
    // fires twice once Electron delivers them itself.
    const storage = chrome.storage;
    const isWorker = typeof document === 'undefined';
    const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
    const diff = (before, after, keys) => {
      const changes = {};
      for (const k of keys) {
        if (sameValue(before[k], after[k])) continue;
        changes[k] = {};
        if (before[k] !== undefined) changes[k].oldValue = before[k];
        if (after[k] !== undefined) changes[k].newValue = after[k];
      }
      return changes;
    };
    const emitChanges = (changes, area) => {
      if (!changes || !Object.keys(changes).length) return;
      live[`storage.${area}.onChanged`]?.fire([changes]);
      live['storage.onChanged']?.fire([changes, area]);
    };
    const report = isWorker ? emitChanges : (changes, area) => { if (Object.keys(changes).length) host?.storageChanged?.(changes, area); };
    const watchWrites = (area, name) => {
      if (typeof area?.get !== 'function' || typeof area.set !== 'function') return;
      const get = area.get.bind(area);
      const keysOf = { set: (items) => (items && typeof items === 'object' ? Object.keys(items) : []), remove: (keys) => [].concat(keys ?? []), clear: () => null };
      for (const [m, keysFor] of Object.entries(keysOf)) {
        if (typeof area[m] !== 'function') continue;
        const real = area[m].bind(area);
        const wrapped = (...args) => {
          const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          const write = (async () => {
            const keys = keysFor(args[0]);
            let before = null;
            try { before = await get(keys); } catch { /* can't compare: the write still happens */ }
            await real(...args);
            if (!before) return;
            try { report(diff(before, keys ? await get(keys) : {}, keys || Object.keys(before)), name); } catch { /* not reported */ }
          })();
          if (!cb) return write;
          write.then(() => cb(), () => cb());
          return undefined;
        };
        try { Object.defineProperty(area, m, { value: wrapped, configurable: true, writable: true }); } catch { /* fixed */ }
      }
      if (isWorker) { try { Object.defineProperty(area, 'onChanged', { value: liveEvent(`storage.${name}.onChanged`), configurable: true, writable: true }); } catch { /* fixed */ } }
    };
    if (storage) {
      for (const name of ['local', 'session']) watchWrites(storage[name], name);
      if (isWorker) {
        try { Object.defineProperty(storage, 'onChanged', { value: liveEvent('storage.onChanged'), configurable: true, writable: true }); } catch { /* fixed */ }
        live['storage.changed'] = { fire: ([changes, area]) => emitChanges(changes, area) }; // a page's write, forwarded
      }
    }

    // ---- storage: sync and managed ----
    if (storage?.local) {
      const local = storage.local;
      const asLocal = {};
      for (const m of ['get', 'set', 'remove', 'clear', 'getBytesInUse', 'getKeys', 'setAccessLevel']) if (typeof local[m] === 'function') asLocal[m] = local[m].bind(local);
      Object.assign(asLocal, { QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512, onChanged: local.onChanged });
      const empty = (keys, cb) => (typeof keys === 'function' ? keys({}) : cb ? cb({}) : Promise.resolve({}));
      const managed = { get: empty, getBytesInUse: (k, cb) => (cb ? cb(0) : Promise.resolve(0)), onChanged: local.onChanged };
      for (const [name, value] of [['sync', asLocal], ['managed', managed]]) {
        try { Object.defineProperty(storage, name, { value, configurable: true, enumerable: true }); } catch {
          for (const [k, v] of Object.entries(value)) { try { storage[name][k] = v; } catch { /* read-only */ } }
        }
      }
    }

    // ---- windows: the one Ultima is showing, plus a popup window while an extension page is open as one ----
    // id 0 matches the windowId Electron gives its tabs
    const theWindow = { id: 0, focused: true, top: 0, left: 0, width: 1280, height: 800, incognito: false, type: 'normal', state: 'normal', alwaysOnTop: false };
    const POPOUT_WINDOW = 1; // as in main.js
    const popoutWindow = { ...theWindow, id: POPOUT_WINDOW, type: 'popup', width: 380, height: 600 };
    const openTab = (url) => {
      const href = new URL(url, location.href).href;
      if (host?.openTab) host.openTab(href); else if (typeof globalThis.open === 'function') globalThis.open(href, '_blank');
    };
    const windowsExtras = {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      get: (id, ...a) => done(a, id === POPOUT_WINDOW ? popoutWindow : theWindow),
      getCurrent: (...a) => done(a, theWindow),
      getLastFocused: (...a) => done(a, theWindow),
      getAll: (...a) => done(a, [theWindow]),
      create: (data = {}, ...a) => {
        const urls = [].concat(data.url || []).map((u) => new URL(u, location.href).href);
        // A popup window of the extension's own page (Bitwarden's "Unlock account"): Ultima shows it in the
        // extension's popup, at the size asked for, rather than as a tab.
        if (data.type === 'popup' && urls.length === 1 && urls[0].startsWith(`${location.origin}/`) && host?.openPopout) {
          host.openPopout(urls[0], data.width, data.height);
          return done(a, { ...popoutWindow, width: data.width || popoutWindow.width, height: data.height || popoutWindow.height });
        }
        for (const u of urls) openTab(u);
        return done(a, theWindow);
      },
      update: (id, info, ...a) => done(a, id === POPOUT_WINDOW ? popoutWindow : theWindow),
      remove: (id, ...a) => { if (id === POPOUT_WINDOW) host?.closePopout?.(); return done(a); },
      ...liveEvents('windows', ['onFocusChanged']),
    };
    define('windows', chrome.windows ? patched(chrome.windows, windowsExtras) : missing(windowsExtras));

    // ---- tabs: fill in what Electron doesn't implement ----
    if (chrome.tabs) {
      const tabs = chrome.tabs;
      define('tabs', patched(tabs, {
        TAB_ID_NONE: -1,
        ...liveEvents('tabs', ['onUpdated', 'onActivated', 'onCreated', 'onRemoved']),
        getCurrent: (...a) => done(a, undefined), // extension popups aren't tabs, as in Chrome
        remove: (ids, ...a) => { host?.closeTabs?.(ids); return done(a); },
        // Ultima answers these from its own tabs (which one is really active, real filters)
        query: async (info, ...a) => {
          const q = info && typeof info === 'object' ? info : {};
          return done(typeof info === 'function' ? [info] : a, host?.queryTabs ? await host.queryTabs(q) : await tabs.query(q));
        },
        get: async (id, ...a) => done(a, (host?.queryTabs ? await host.queryTabs({}) : await tabs.query({})).find((t) => t.id === id)),
        // tab groups Ultima keeps for extensions, and pictures of the tab in front (see main.js)
        group: (...a) => viaUltima('tabGroups', 'group', a),
        ungroup: (...a) => viaUltima('tabGroups', 'ungroup', a),
        captureVisibleTab: (...a) => {
          const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null;
          const options = a.find((x) => x && typeof x === 'object') || {};
          return viaUltima('capture', 'visibleTab', cb ? [options, cb] : [options]);
        },
        create: (props = {}, ...a) => {
          if (props.url) openTab(props.url);
          return done(a, { id: -1, index: 0, windowId: 1, active: props.active !== false, pinned: false, highlighted: true, incognito: false, url: props.url || '' });
        },
      }));
    }

    // ---- native messaging: apps on this computer an extension talks to (Ultima starts them; see extensionNative) ----
    // A Port as Chrome's: messages can be posted at once (they wait until the app has started), and onDisconnect
    // says why with chrome.runtime.lastError.
    const nativePorts = new Map(); // port id -> { port, lost(error) }
    const endedEarly = new Map(); // port id -> why: the app ended before the port heard its id
    const portEvent = () => {
      const listeners = new Set();
      return {
        addListener: (f) => listeners.add(f),
        removeListener: (f) => listeners.delete(f),
        hasListener: (f) => listeners.has(f),
        hasListeners: () => listeners.size > 0,
        fire: (...args) => { for (const f of [...listeners]) { try { f(...args); } catch (err) { setTimeout(() => { throw err; }); } } },
      };
    };
    liveEvent('native.message').addListener((id, msg) => { const p = nativePorts.get(id)?.port; p?.onMessage.fire(msg, p); });
    liveEvent('native.disconnect').addListener((id, error) => {
      const open = nativePorts.get(id);
      nativePorts.delete(id);
      if (open) open.lost(error); else endedEarly.set(id, error);
    });
    const connectNative = (application) => {
      let id = null;
      let closed = false;
      const waiting = [];
      const post = (msg) => viaUltima('native', 'post', [id, msg]).catch(() => { /* the port closed meanwhile: onDisconnect says so */ });
      const port = {
        name: String(application),
        onMessage: portEvent(),
        onDisconnect: portEvent(),
        postMessage: (msg) => {
          if (closed) throw new Error('Attempting to use a disconnected port object');
          if (id === null) waiting.push(msg); else post(msg);
        },
        disconnect: () => {
          if (closed) return;
          closed = true;
          if (id !== null) { nativePorts.delete(id); viaUltima('native', 'disconnect', [id]).catch(() => {}); }
        },
      };
      const lost = (error) => {
        if (closed) return;
        closed = true;
        withLastError(error || 'Native host has exited.', () => port.onDisconnect.fire(port));
      };
      viaUltima('native', 'connect', [String(application)]).then((pid) => {
        id = pid;
        if (closed) { viaUltima('native', 'disconnect', [id]).catch(() => {}); return; }
        if (endedEarly.has(id)) { const why = endedEarly.get(id); endedEarly.delete(id); lost(why); return; }
        nativePorts.set(id, { port, lost });
        for (const msg of waiting.splice(0)) post(msg);
      }, (err) => setTimeout(() => lost(err.message)));
      return port;
    };

    // ---- runtime extras ----
    if (chrome.runtime) {
      const manifest = chrome.runtime.getManifest?.() || {};
      define('runtime', patched(chrome.runtime, {
        // real answers from Ultima: which popups, tabs, offscreen documents and workers this extension has open
        onInstalled: liveEvent('runtime.onInstalled'), // Electron never fires it; Ultima does (see announceInstall)
        getContexts: async (filter, ...a) => done(typeof filter === 'function' ? [filter] : a, host?.getContexts ? await host.getContexts(typeof filter === 'object' ? filter : {}) : []),
        openOptionsPage: (...a) => {
          const page = manifest.options_ui?.page || manifest.options_page;
          if (page) openTab(chrome.runtime.getURL(page));
          return done(a);
        },
        setUninstallURL: (...a) => done(a),
        ...[...(manifest.permissions || []), ...(manifest.optional_permissions || [])].includes('nativeMessaging') ? { // Bitwarden asks for it as optional
          connectNative,
          sendNativeMessage: (application, message, ...a) => viaUltima('native', 'send', [String(application), message, ...a]),
        } : {},
        requestUpdateCheck: (...a) => done(a, { status: 'no_update' }),
      }));
    }

    // ---- extension: Electron keeps almost none of this older namespace ----
    // Dark Reader's background asks isAllowedFileSchemeAccess as it starts; without it, it never starts and its
    // popup waits forever. Extensions here never get file:// or private-window access.
    if (chrome.extension) {
      define('extension', patched(chrome.extension, {
        getURL: (p) => chrome.runtime.getURL(p),
        isAllowedFileSchemeAccess: (...a) => done(a, false),
        isAllowedIncognitoAccess: (...a) => done(a, false),
      }));
    }

    // ---- toolbar button calls Ultima doesn't use ----
    // a click on the toolbar button of an extension without a popup (Electron never sends it; Ultima does)
    if (chrome.action) define('action', patched(chrome.action, { onClicked: liveEvent('action.onClicked') }));

    // Scripts an extension registered survive its background restarting here, so registering them again fails with
    // "Duplicate script ID" (Bitwarden's passkey support does this). Replace the old registration instead.
    if (chrome.scripting?.registerContentScripts) {
      const scripting = chrome.scripting;
      const register = scripting.registerContentScripts.bind(scripting);
      define('scripting', patched(scripting, {
        registerContentScripts: async (scripts, ...a) => {
          try {
            return done(a, await register(scripts));
          } catch (err) {
            if (!/Duplicate script ID/i.test(String(err?.message))) throw err;
            await scripting.unregisterContentScripts({ ids: scripts.map((s) => s.id) }).catch(() => {});
            return done(a, await register(scripts));
          }
        },
      }));
    }

    // ---- alarms ----
    // Electron schedules alarms but never delivers onAlarm to background workers (the same Electron bug as storage
    // above), and Bitwarden locks the vault on timeout from an alarm. Ultima keeps the alarms instead: a due alarm
    // wakes the worker and is sent to it (see extensionAlarms in main.js).
    if (chrome.alarms && host?.alarms) {
      const settle = (cb, promise) => { if (!cb) return promise; promise.then((v) => cb(v), () => cb()); return undefined; };
      const split = (a) => [typeof a[a.length - 1] === 'function' ? a.pop() : null, a];
      const named = (fn) => (...args) => { const [cb, a] = split(args); return settle(cb, fn(typeof a[0] === 'string' ? a[0] : '')); };
      define('alarms', patched(chrome.alarms, {
        create: (...args) => {
          const [cb, a] = split(args);
          const [name, info] = typeof a[0] === 'string' ? a : ['', a[0]];
          return settle(cb, host.alarms('create', [name, info && typeof info === 'object' ? { ...info } : {}]).then(() => undefined));
        },
        get: named((name) => host.alarms('get', [name]).then((x) => x || undefined)),
        getAll: (...args) => settle(split(args)[0], host.alarms('getAll')),
        clear: named((name) => host.alarms('clear', [name])),
        clearAll: (...args) => settle(split(args)[0], host.alarms('clearAll')),
        onAlarm: liveEvent('alarms.onAlarm'),
      }));
    }

    // ---- permissions Electron doesn't know ----
    // e.g. Bitwarden asks for "privacy" to switch off the browser's own password saving. Ultima has none, so
    // permissions for APIs Ultima stands in for count as granted instead of failing.
    if (chrome.permissions) {
      const STAND_IN = new Set(['privacy']);
      const perms = chrome.permissions;
      const known = (q) => ({ ...q, permissions: (q?.permissions || []).filter((p) => !STAND_IN.has(p)) });
      const onlyStandIns = (q) => !known(q).permissions.length && !(q?.origins || []).length;
      const wrap = (fn) => (q, ...a) => {
        const [cb] = typeof a[a.length - 1] === 'function' ? [a.pop()] : [null];
        const result = onlyStandIns(q) ? Promise.resolve(true) : perms[fn](known(q));
        if (!cb) return result;
        result.then((v) => cb(v), () => cb(false));
        return undefined;
      };
      define('permissions', patched(perms, { contains: wrap('contains'), request: wrap('request'), remove: wrap('remove') }));
    } else {
      // Some Electron versions (44) leave chrome.permissions out of extension pages entirely, and Bitwarden's popup
      // then fails to start ("Cannot read properties of undefined (reading 'contains')"). Electron grants an
      // extension everything its manifest asks for when it loads, so answer as that: granted, nothing to remove.
      const declared = chrome.runtime?.getManifest?.() || {};
      define('permissions', missing({
        contains: (q, ...a) => done(a, true),
        request: (q, ...a) => done(a, true),
        remove: (q, ...a) => done(a, false),
        getAll: (...a) => done(a, { permissions: [...(declared.permissions || [])], origins: [...(declared.host_permissions || [])] }),
      }));
    }

    // ---- APIs Electron lacks entirely: better answers than the stand-ins below ----
    const setting = () => ({
      get: (d, ...a) => done(a, { value: false, levelOfControl: 'not_controllable' }),
      set: (...a) => done(a),
      clear: (...a) => done(a),
      onChange: event(),
    });
    const settingsGroup = () => new Proxy({}, { get: (t, k) => (typeof k === 'string' ? (t[k] ||= setting()) : undefined) });
    const extras = {
      webNavigation: {
        ...liveEvents('webNavigation', ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onHistoryStateUpdated', 'onErrorOccurred']),
        // real frames of the page, from Ultima
        getAllFrames: async (details, ...a) => done(a, host?.frames ? await host.frames({ tabId: details?.tabId }) : []),
        getFrame: async (details, ...a) => done(a, host?.frames ? await host.frames({ tabId: details?.tabId, frameId: details?.frameId ?? 0 }) : null),
      },
      // right-click menu items: Ultima keeps them and shows them in its menus (see extensionMenus in main.js).
      // create() answers with the item's id at once, as Chrome's does; an onclick (older extensions) is kept here.
      contextMenus: (() => {
        const onclick = new Map();
        liveEvent('contextMenus.onClicked').addListener((info, tab) => onclick.get(info.menuItemId)?.(info, tab));
        const quiet = (p) => { if (p) p.catch(() => { /* reported through lastError when there's a callback */ }); };
        return {
          create: (props = {}, cb) => {
            const { onclick: fn, ...rest } = props && typeof props === 'object' ? props : {};
            const id = rest.id ?? Math.floor(Math.random() * 1e9);
            if (typeof fn === 'function') onclick.set(id, fn);
            quiet(viaUltima('menus', 'create', typeof cb === 'function' ? [{ ...rest, id }, cb] : [{ ...rest, id }]));
            return id;
          },
          update: (id, props = {}, ...a) => {
            const { onclick: fn, ...rest } = props && typeof props === 'object' ? props : {};
            if (typeof fn === 'function') onclick.set(id, fn);
            return viaUltima('menus', 'update', [id, rest, ...a]);
          },
          remove: (id, ...a) => { onclick.delete(id); return viaUltima('menus', 'remove', [id, ...a]); },
          removeAll: (...a) => { onclick.clear(); return viaUltima('menus', 'removeAll', a); },
          ACTION_MENU_TOP_LEVEL_LIMIT: 6,
          ...liveEvents('contextMenus', ['onClicked']),
        };
      })(),
      notifications: { getAll: (...a) => done(a, {}), getPermissionLevel: (...a) => done(a, 'granted'), create: (id, ...a) => done(a, typeof id === 'string' ? id : String(Date.now())) },
      // keyboard shortcuts: Ultima listens for them and tells the extension (see extensionCommands in main.js)
      commands: { getAll: (...a) => viaUltima('commands', 'getAll', a), ...liveEvents('commands', ['onCommand']) },
      // Ultima's own versions (see EXTENSION_CALLS in main.js)
      debugger: {
        attach: (...a) => viaUltima('debugger', 'attach', a),
        detach: (...a) => viaUltima('debugger', 'detach', a),
        sendCommand: (...a) => viaUltima('debugger', 'sendCommand', a),
        getTargets: (...a) => viaUltima('debugger', 'getTargets', a),
        ...liveEvents('debugger', ['onEvent', 'onDetach']),
      },
      tabGroups: {
        get: (...a) => viaUltima('tabGroups', 'get', a),
        query: (...a) => viaUltima('tabGroups', 'query', a),
        update: (...a) => viaUltima('tabGroups', 'update', a),
        move: (...a) => viaUltima('tabGroups', 'move', a),
        ...liveEvents('tabGroups', ['onCreated', 'onUpdated', 'onMoved', 'onRemoved']),
      },
      sidePanel: {
        ...Object.fromEntries(['setOptions', 'getOptions', 'setPanelBehavior', 'getPanelBehavior', 'open', 'close', 'getLayout'].map((op) => [op, (...a) => viaUltima('sidePanel', op, a)])),
        ...liveEvents('sidePanel', ['onOpened', 'onClosed']),
      },
      // Dark Reader's popup waits on this list before it shows anything
      fontSettings: { getFontList: (...a) => done(a, ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].map((f) => ({ fontId: f, displayName: f }))) },
      privacy: { services: settingsGroup(), network: settingsGroup(), websites: settingsGroup() },
    };

    // ---- everything else Chrome has: stand-ins from Chrome's own API list (src/extension-api.json) ----
    // An extension that touches an API Electron lacks gets a harmless stand-in instead of crashing: calls resolve
    // with an empty value of the right kind, events never fire, enums and constants are there. As in Chrome, a
    // namespace is only there when the manifest asks for its permission or key. The first call of each stand-in is
    // reported, so Settings → Extensions can say what an extension misses (listening for an event that never comes
    // is harmless, so that isn't).
    const reported = new Set();
    const unsupported = (name) => {
      if (reported.has(name)) return;
      reported.add(name);
      console.warn(`Ultima doesn't support chrome.${name} yet`);
      host?.unsupported?.(name);
    };
    const EMPTY = { a: () => [], b: () => false, n: () => 0, s: () => '', o: () => ({}), v: () => undefined };
    const standInFn = (name, kind) => (...args) => { unsupported(name); return done(args, (EMPTY[kind] || EMPTY.v)()); };
    // what `shape` (a namespace or object in the list) has that `target` lacks
    // (deep: also fill in objects already there; not inside Ultima's own answers above, which know better)
    const additions = (target, shape, name, deep = true) => {
      const add = {};
      for (const [k, kind] of Object.entries(shape.fn || {})) if (!(k in target)) add[k] = standInFn(`${name}.${k}`, kind);
      for (const k of shape.ev || []) if (!(k in target)) add[k] = event();
      for (const [k, values] of Object.entries(shape.enum || {})) if (!(k in target)) add[k] = Object.freeze({ ...values });
      for (const [k, value] of Object.entries(shape.const || {})) if (!(k in target)) add[k] = value;
      for (const [k, sub] of Object.entries(shape.props || {})) {
        if (!(k in target)) add[k] = additions({}, sub, `${name}.${k}`);
        else if (deep && target[k] && typeof target[k] === 'object') fill(target[k], sub, `${name}.${k}`);
      }
      return add;
    };
    const fill = (target, shape, name) => {
      for (const [k, v] of Object.entries(additions(target, shape, name))) {
        try { Object.defineProperty(target, k, { value: v, configurable: true, writable: true, enumerable: true }); } catch { /* fixed */ }
      }
    };
    const manifest = chrome.runtime?.getManifest?.() || {};
    const asked = new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])].filter((p) => typeof p === 'string'));
    const offered = (e) => ((!e.perm && !e.manifest) || (e.perm || []).some((p) => asked.has(p)) || (e.manifest || []).some((k) => k in manifest))
      && !(e.pagesOnly && isWorker) && !(e.mv3 && manifest.manifest_version < 3);
    for (const [name, shape] of Object.entries(api?.namespaces || {})) {
      // devtools.* exist only in DevTools pages, and extensions test for them to know where they are
      if (name.startsWith('devtools.') || !offered(shape)) continue;
      const path = name.split('.');
      let parent = chrome;
      for (const part of path.slice(0, -1)) {
        if (!parent[part]) { if (parent === chrome) define(part, {}); else parent[part] = {}; }
        parent = parent[part];
      }
      const key = path[path.length - 1];
      const own = extras[name] || {};
      if (parent[key]) {
        fill(parent[key], shape, name);
      } else if (shape.fn || shape.ev || shape.props || extras[name]) { // a namespace of only types and constants isn't one
        const ns = { ...additions(own, shape, name, false), ...own };
        if (parent === chrome) define(key, ns); else parent[key] = ns;
      }
    }
    // the namespaces with better answers above, if the list doesn't know them (an older list)
    for (const [name, own] of Object.entries(extras)) if (!chrome[name] && !api?.namespaces?.[name]) define(name, missing(own));
    if (chrome.contextMenus && !chrome.menus) define('menus', chrome.contextMenus);
    if (chrome.storage) define('storage', chrome.storage); // its areas carry the change events above
    } catch (err) { console.warn(`Ultima couldn't finish setting up extension APIs: ${err?.stack || err}`); }
  },
);
