// Gives web pages Chrome's own window.chrome (app, csi, loadTimes), which Electron leaves empty. Google's sign-in
// refuses a browser whose pages lack chrome.app ("Couldn't sign you in: this browser or app may not be secure");
// Chrome, Edge, Brave and Vivaldi all have it. A session preload (see setupSession in main.js), so it runs in every
// frame and popup before the page's own scripts; extension pages are left alone (they have their own chrome.*).
const { contextBridge } = require('electron');

function installChromeObject() {
  try {
    if (/^(chrome-extension|devtools):$/.test(location.protocol)) return;
    // the page's performance object and clock as they are now, before its scripts could replace them
    const perf = window.performance;
    const timing = perf && perf.timing;
    const getEntries = perf && perf.getEntriesByType ? perf.getEntriesByType.bind(perf) : () => [];
    const dateNow = Date.now;
    const chrome = window.chrome && typeof window.chrome === 'object' ? window.chrome : {};
    if (chrome !== window.chrome) Object.defineProperty(window, 'chrome', { value: chrome, writable: true, configurable: true, enumerable: true });

    // Chrome's own functions print as native code
    const native = (fn) => {
      Object.defineProperty(fn, 'toString', { value: () => 'function () { [native code] }', configurable: true, writable: true });
      return fn;
    };
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
  } catch {
    // never break a page over this
  }
}

if (process.contextIsolated) contextBridge.executeInMainWorld({ func: installChromeObject });
else installChromeObject();
