// Ultima puts its own versions of a few browser functions into pages: alert/confirm/prompt (dialog-preload.js),
// permission states (permission-preload.js), media (media-preload.js), passkeys (passkey-preload.js) and window.chrome
// (page-compat.js). In Chrome those are built in, and a page can tell the difference: Function.prototype.toString shows
// a script instead of "[native code]". That's one of the things Google's checks for bots look at, and a browser that
// fails them keeps being asked whether you're human. So here every page gets a Function.prototype.toString that
// prints Ultima's versions as built-in, and is itself indistinguishable from the real one.
// A session preload registered before the others (see setupSession in main.js), so it runs first in every frame;
// they register their functions with the token below, which lives in the preloads' world and never reaches the page.
const { contextBridge } = require('electron');

if (!globalThis.__ultimaNativeToken) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  globalThis.__ultimaNativeToken = `n${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// In the page: Function.prototype.toString.call(fn, token, text) registers `fn` to print as `text`
function maskNatives(token) {
  try {
    const real = Function.prototype.toString;
    const shown = new WeakMap(); // function → what it prints as
    const masked = new Proxy(real, {
      apply(target, self, args) {
        if (args[0] === token && typeof self === 'function' && typeof args[1] === 'string') { shown.set(self, args[1]); return ''; }
        const text = shown.get(self);
        if (text !== undefined) return text;
        try {
          return Reflect.apply(target, self, args);
        } catch (err) {
          // the page sees the built-in's error, without this function's own lines in its stack
          if (err && typeof err.stack === 'string') err.stack = err.stack.replace(/\n\s+at (Reflect\.apply|Object\.apply) [^\n]*/g, '');
          throw err;
        }
      },
    });
    shown.set(masked, real.call(real));
    Object.defineProperty(Function.prototype, 'toString', { value: masked, writable: true, configurable: true, enumerable: false });
  } catch { /* pages see Ultima's functions as they are */ }
}

try {
  // offscreen documents run with isolation off: there this preload already shares the page's world
  if (process.contextIsolated === false) maskNatives(globalThis.__ultimaNativeToken);
  else contextBridge.executeInMainWorld({ func: maskNatives, args: [globalThis.__ultimaNativeToken] });
} catch { /* pages see Ultima's functions as they are */ }
