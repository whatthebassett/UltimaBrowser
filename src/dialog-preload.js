// Shows a page's alert(), confirm() and prompt() in Ultima's own dialog (styled like the rest of the browser) instead
// of a plain system box; extension pages' too. A session preload (see setupSession in main.js), so it runs in every
// frame before the page's own scripts. Like everywhere else, the page waits until you answer: main replies only then.
const { contextBridge, ipcRenderer } = require('electron');

const ask = (type, message, value) => ipcRenderer.sendSync('ultima:page-dialog', type, String(message ?? ''), value === undefined ? '' : String(value));

function replace(askUltima) {
  // Chrome's own functions print as native code
  const native = (fn) => {
    Object.defineProperty(fn, 'toString', { value: () => `function ${fn.name}() { [native code] }`, configurable: true, writable: true });
    return fn;
  };
  const set = (name, fn) => Object.defineProperty(window, name, { value: native(fn), writable: true, configurable: true, enumerable: true });
  set('alert', function alert(message) { askUltima('alert', message); });
  set('confirm', function confirm(message) { return askUltima('confirm', message) === true; });
  set('prompt', function prompt(message, value) { const r = askUltima('prompt', message, value); return typeof r === 'string' ? r : null; });
}

try {
  // offscreen documents run with isolation off: there this preload already shares the page's world
  if (process.contextIsolated === false) replace(ask);
  else contextBridge.executeInMainWorld({ func: replace, args: [ask] });
} catch { /* the page keeps the system dialogs */ }
