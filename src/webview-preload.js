// Runs in every web page's isolated world (pages can't see or change it). It tells Ultima whether you are typing,
// so single-key shortcuts never steal letters from text boxes, and whether the pointer is near the top of the page,
// where a split view pane shows its controls. It also passes on the mouse's back and forward buttons, and touchpad
// swipes past the edge of the page.
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

// Two-finger touchpad swipes (renderer/swipe.js shows them and acts on them): sideways past the edge of the page goes
// back or forward, and down past its top reloads it. Only once the page itself can't scroll that way any more (a
// carousel or a wide table still scrolls), never for a mouse wheel, and not where the page turns it off
// (overscroll-behavior), as in Chrome.
const SWIPE_GAP = 160; // ms without scrolling that ends a swipe
let swipe = null; // { axis, kind, amount, dx, dy, off, target }
let swipeTimer = null;

// a mouse wheel turns in notches of 120; a touchpad moves by any amount
const notch = (e) => e.deltaMode !== 0 || (Math.abs(e.wheelDeltaY) % 120 === 0 && Math.abs(e.wheelDeltaX) % 120 === 0);

// Whether what's under the pointer, or the page, can still scroll that way (dir -1: left or up, 1: right or down).
function scrollsFurther(start, axis, dir) {
  const stops = (el) => getComputedStyle(el)[axis === 'x' ? 'overscrollBehaviorX' : 'overscrollBehaviorY'] !== 'auto';
  for (let el = start instanceof Element ? start : null; el && el !== document.body && el !== document.documentElement; el = el.parentElement || el.getRootNode().host) {
    const s = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(axis === 'x' ? s.overflowX : s.overflowY)) continue;
    const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    if (max < 2) continue;
    const pos = Math.abs(axis === 'x' ? el.scrollLeft : el.scrollTop);
    if (dir < 0 ? pos > 1 : pos < max - 1) return true;
    if (stops(el)) return true; // its scrolling ends at its edge (overscroll-behavior: contain or none)
  }
  const root = document.scrollingElement || document.documentElement;
  const max = axis === 'x' ? root.scrollWidth - innerWidth : root.scrollHeight - innerHeight;
  const pos = Math.abs(axis === 'x' ? scrollX : scrollY);
  return (dir < 0 ? pos > 1 : max > 1 && pos < max - 1) || stops(document.documentElement) || Boolean(document.body && stops(document.body));
}

const sendSwipe = (done) => ipcRenderer.sendToHost('ultima:swipe', { kind: swipe.kind, amount: swipe.amount, done });

function endSwipe() {
  clearTimeout(swipeTimer);
  if (swipe?.kind && !swipe.off) sendSwipe(true);
  swipe = null;
}

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) return; // pinching to zoom
  if (!swipe) swipe = { axis: null, kind: null, amount: 0, dx: 0, dy: 0, off: notch(e), target: e.composedPath()[0] };
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(endSwipe, SWIPE_GAP);
  if (e.defaultPrevented && !swipe.off) {
    // the page handles this scrolling itself (a map, a slider): no swipe
    if (swipe.kind) { swipe.amount = 0; sendSwipe(true); }
    swipe.off = true;
  }
  if (swipe.off) return;
  if (!swipe.axis) {
    // which way it goes, from its first few movements: sideways, or down (scrolling up) only
    swipe.dx += e.deltaX;
    swipe.dy += e.deltaY;
    if (Math.abs(swipe.dx) + Math.abs(swipe.dy) < 6) return;
    if (Math.abs(swipe.dx) > Math.abs(swipe.dy) * 1.5) swipe.axis = 'x';
    else if (swipe.dy < 0 && -swipe.dy > Math.abs(swipe.dx) * 1.5) swipe.axis = 'y';
    else { swipe.off = true; return; }
    const dir = swipe.axis === 'x' ? Math.sign(swipe.dx) : -1;
    if (scrollsFurther(swipe.target, swipe.axis, dir)) { swipe.off = true; return; }
    swipe.kind = swipe.axis === 'y' ? 'reload' : dir < 0 ? 'back' : 'forward';
    swipe.amount = swipe.axis === 'x' ? Math.abs(swipe.dx) : -swipe.dy;
  } else {
    swipe.amount = Math.max(0, swipe.amount + (swipe.axis === 'y' ? -e.deltaY : swipe.kind === 'back' ? -e.deltaX : e.deltaX));
  }
  sendSwipe(false);
}, { passive: true });
