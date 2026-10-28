// Runs in every web page's isolated world (pages can't see or change it). It tells Ultima whether you are typing,
// so single-key shortcuts never steal letters from text boxes, and whether the pointer is near the top of the page,
// where a split view pane shows its controls. It also passes on the mouse's back and forward buttons.
const { ipcRenderer } = require('electron');

const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'image', 'hidden', 'color']);

function deepActive() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function typing() {
  if (document.designMode === 'on') return true;
  const el = deepActive();
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TEXT.has((el.type || 'text').toLowerCase());
  // focus inside a frame or plugin: we can't see in, so assume typing rather than steal keys
  if (tag === 'IFRAME' || tag === 'FRAME' || tag === 'EMBED' || tag === 'OBJECT') return true;
  return el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'combobox';
}

let last = null;
function report() {
  const now = typing();
  if (now === last) return;
  last = now;
  ipcRenderer.send('ultima:typing', now);
}

window.addEventListener('focusin', report, true);
window.addEventListener('focusout', () => setTimeout(report, 0), true);
window.addEventListener('DOMContentLoaded', report);
document.addEventListener('readystatechange', report);

// near the top edge (or not): sent only when that changes
let nearTop = false;
const setNearTop = (on) => {
  if (on === nearTop) return;
  nearTop = on;
  ipcRenderer.sendToHost('ultima:pane-top', on);
};
window.addEventListener('mousemove', (e) => setNearTop(e.clientY < 64), { capture: true, passive: true });
document.addEventListener('mouseleave', () => setNearTop(false), true);
window.addEventListener('blur', () => setNearTop(false));

// The mouse's back and forward buttons (4 and 5) go back or forward in this page (main.js does it: Electron doesn't)
window.addEventListener('mouseup', (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  ipcRenderer.send('ultima:mouse-nav', e.button === 3 ? 'back' : 'forward');
}, true);
