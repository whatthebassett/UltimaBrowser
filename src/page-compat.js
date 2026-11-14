// Gives web pages Chrome's own window.chrome (app, csi, loadTimes), which Electron leaves empty. Google's sign-in
// refuses a browser whose pages lack chrome.app ("Couldn't sign you in: this browser or app may not be secure");
// Chrome, Edge, Brave and Vivaldi all have it. A session preload (see setupSession in main.js), so it runs in every
// frame and popup before the page's own scripts; extension pages are left alone (they have their own chrome.*).
// A page an installed extension lets talk to it (externally_connectable) also gets chrome.runtime.sendMessage for it.
const { contextBridge, ipcRenderer } = require('electron');

// the extensions this page may message (asked once, as the page starts: main.js checks their manifests)
const externalIds = (() => {
  if (!/^https?:$/.test(location.protocol)) return [];
  try { return ipcRenderer.sendSync('ultima:ext-external-ids', location.href) || []; } catch { return []; }
})();
const sendExternal = (id, message) => ipcRenderer.invoke('ultima:ext-external-message', String(id), message);

function installChromeObject(extensionIds = [], sendToExtension = null, token = null) {
  try {
    if (/^(chrome-extension|devtools):$/.test(location.protocol)) return;
    // the page's performance object and clock as they are now, before its scripts could replace them
    const perf = window.performance;
    const timing = perf && perf.timing;
    const getEntries = perf && perf.getEntriesByType ? perf.getEntriesByType.bind(perf) : () => [];
    const dateNow = Date.now;
    const chrome = window.chrome && typeof window.chrome === 'object' ? window.chrome : {};
    if (chrome !== window.chrome) Object.defineProperty(window, 'chrome', { value: chrome, writable: true, configurable: true, enumerable: true });

    // like Chrome's own functions: no prototype, and they print as built-in (native-preload.js)
    const native = (fn, text = 'function () { [native code] }') => { try { Function.prototype.toString.call(fn, token, text); } catch { /* as it is */ } return fn; };
    const add = (name, value) => {
      if (!(name in chrome)) Object.defineProperty(chrome, name, { value, writable: true, configurable: true, enumerable: true });
    };
    const navEntry = () => getEntries('navigation')[0];
    const seconds = (ms) => (ms ? ms / 1000 : 0);

    add('loadTimes', native(() => {
      const nav = navEntry();
      const protocol = (nav && nav.nextHopProtocol) || '';
      const paint = getEntries('paint').find((e) => e.name === 'first-paint');
      const type = nav && nav.type;
      return {
        requestTime: seconds(timing.navigationStart),
        startLoadTime: seconds(timing.navigationStart),
        commitLoadTime: seconds(timing.responseStart),
        finishDocumentLoadTime: seconds(timing.domContentLoadedEventEnd),
        finishLoadTime: seconds(timing.loadEventEnd),
        firstPaintTime: paint ? seconds(timing.navigationStart + paint.startTime) : 0,
        firstPaintAfterLoadTime: 0,
        navigationType: type === 'reload' ? 'Reload' : type === 'back_forward' ? 'BackForward' : 'Other',
        wasFetchedViaSpdy: protocol === 'h2' || protocol === 'h3',
        wasNpnNegotiated: protocol === 'h2' || protocol === 'h3',
        npnNegotiatedProtocol: protocol === 'h2' || protocol === 'h3' ? protocol : 'unknown',
        wasAlternateProtocolAvailable: false,
        connectionInfo: protocol || 'http/1.1',
      };
    }));

    add('csi', native(() => {
      const nav = navEntry();
      return {
        startE: timing.navigationStart,
        onloadT: timing.domContentLoadedEventEnd || dateNow(),
        pageT: dateNow() - timing.navigationStart,
        tran: nav && nav.type === 'reload' ? 16 : nav && nav.type === 'back_forward' ? 6 : 15,
      };
    }));

    const InstallState = { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' };
    const RunningState = { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' };
    add('app', {
      isInstalled: false,
      InstallState,
      RunningState,
      getDetails: native(() => null),
      getIsInstalled: native(() => false),
      installState: native((callback) => { if (typeof callback === 'function') setTimeout(() => callback(InstallState.NOT_INSTALLED), 0); }),
      runningState: native(() => RunningState.CANNOT_RUN),
    });

    // chrome.runtime.sendMessage(extensionId, message[, options][, callback]), as Chrome gives a page an extension lets
    // talk to it (claude.ai and Claude's extension): only then, as other pages have no chrome.runtime at all. Electron
    // puts its own chrome.runtime on such pages, whose sendMessage never reaches the extension: Ultima's replaces it.
    if (extensionIds.length && sendToExtension) {
      const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
      const runtime = chrome.runtime && typeof chrome.runtime === 'object' ? chrome.runtime : {};
      // (an error from main arrives wrapped in its IPC's words: the page sees Chrome's)
      const plain = (err) => new Error(String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
      const ask = (id, message) => (extensionIds.includes(id)
        ? Promise.resolve(sendToExtension(id, message)).catch((err) => { throw plain(err); })
        : Promise.reject(new Error(NO_RECEIVER)));
      const sendMessage = native({ sendMessage(id, message, ...rest) {
        const callback = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
        const answer = ask(id, message);
        if (!callback) return answer;
        answer.then((response) => callback(response), (err) => {
          runtime.lastError = { message: err.message };
          try { callback(); } finally { delete runtime.lastError; }
        });
        return undefined;
      } }.sendMessage, 'function sendMessage() { [native code] }');
      Object.defineProperty(runtime, 'sendMessage', { value: sendMessage, writable: true, configurable: true, enumerable: true });
      add('runtime', runtime);
    }
  } catch {
    // never break a page over this
  }
}

if (process.contextIsolated) contextBridge.executeInMainWorld({ func: installChromeObject, args: [externalIds, sendExternal, globalThis.__ultimaNativeToken] });
else installChromeObject(externalIds, sendExternal, globalThis.__ultimaNativeToken);
