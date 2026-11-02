// No Windows passkey prompt when a password manager extension handles passkeys. Managers like Bitwarden put their own
// navigator.credentials.create/get on top of the browser's, and hand some requests back to it: the "passkey autofill"
// request most sign-in pages make as they load, and ones the manager won't take. Chrome shows those quietly; in Ultima
// they reach Windows, whose prompt pops up over the page. A session preload (see setupSession in main.js), so this sits
// under any manager in every frame: once a manager has taken over, what it hands back waits quietly (autofill requests)
// or is declined as if you'd closed the prompt. Without a manager, passkeys go to Windows as before.
const { contextBridge } = require('electron');

function guard() {
  const proto = window.CredentialsContainer?.prototype;
  if (!proto?.get || !proto.create) return;
  const decline = (options) => {
    const signal = options?.signal;
    // a page's autofill request just waits, as Chrome's does until you pick a passkey, and ends when the page cancels it
    if (options.mediation === 'conditional') {
      return new Promise((_, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
  };
  for (const name of ['create', 'get']) {
    const real = proto[name];
    const fn = {
      [name](options) {
        if (options?.publicKey && navigator.credentials?.[name] !== fn) return decline(options);
        return real.call(this, options);
      },
    }[name];
    // Chrome's own functions print as native code
    Object.defineProperty(fn, 'toString', { value: () => `function ${name}() { [native code] }`, configurable: true, writable: true });
    Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: true });
  }
}

try {
  // offscreen documents run with isolation off: there this preload already shares the page's world
  if (process.contextIsolated === false) guard();
  else contextBridge.executeInMainWorld({ func: guard });
} catch { /* passkeys go to Windows as before */ }
