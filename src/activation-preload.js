// A click or key press in any frame of a page lets the page open a pop-up (guardWindowOpen in main.js). Electron only
// reports input to a page's top frame, and sign-in and payment buttons ("Sign in with Google", PayPal) are often
// frames of their own. A session preload (see setupSession in main.js), so it runs in every frame; only real input
// counts (a page's own scripts can't fake isTrusted).
const { ipcRenderer } = require('electron');

let last = 0;
function pressed(e) {
  if (!e.isTrusted) return;
  const now = Date.now();
  if (now - last < 200) return;
  last = now;
  ipcRenderer.send('ultima:user-activation');
}
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, pressed, { capture: true, passive: true });
