// Shows a page's alert(), confirm() and prompt() in Ultima's own dialog (styled like the rest of the browser) instead
// of a plain system box; extension pages' too. A session preload (see setupSession in main.js), so it runs in every
// frame before the page's own scripts. Like everywhere else, the page waits until you answer: main replies only then.
const { contextBridge, ipcRenderer } = require('electron');

const ask = (type, message, value) => ipcRenderer.sendSync('ultima:page-dialog', type, String(message ?? ''), value === undefined ? '' : String(value));

function replace(askUltima, token) {
  // like Chrome's own functions: no prototype (methods), and they print as built-in (native-preload.js)
  const native = (fn) => { try { Function.prototype.toString.call(fn, token, `function ${fn.name}() { [native code] }`); } catch { /* as it is */ } return fn; };
  const set = (name, fn) => Object.defineProperty(window, name, { value: native(fn), writable: true, configurable: true, enumerable: true });
  const own = {
    alert(message) { askUltima('alert', message); },
    confirm(message) { return askUltima('confirm', message) === true; },
    prompt(message, value) { const r = askUltima('prompt', message, value); return typeof r === 'string' ? r : null; },
  };
  for (const name of ['alert', 'confirm', 'prompt']) set(name, own[name]);
}

try {
  // offscreen documents run with isolation off: there this preload already shares the page's world
  if (process.contextIsolated === false) replace(ask, globalThis.__ultimaNativeToken);
  else contextBridge.executeInMainWorld({ func: replace, args: [ask, globalThis.__ultimaNativeToken] });
} catch { /* the page keeps the system dialogs */ }
