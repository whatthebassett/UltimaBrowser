// Glance: opening a link in a preview over the page instead of navigating to it. This notices the gestures in every web
// page and frame (Alt+click, Shift+click, or pressing and holding on a link; each can be turned off in Settings) and
// tells main.js, which has the window's UI show the preview (glance.js). The page never sees those clicks.
// A session preload (see setupSession in main.js), in the preload's own world.
const { ipcRenderer, webFrame } = require('electron');

const HOLD_MS = 450; // pressing this long on a link, without moving, glances it
const SLOP = 6; // px the pointer may wander while holding

let config = null; // { alt, shift, hold } from Settings, asked again on each press so changes apply at once
const refresh = () => ipcRenderer.invoke('ultima:glance-config').then((c) => { config = c; }).catch(() => {});

// the link under an event, if it's one a glance can open
function linkOf(e) {
  for (const el of e.composedPath()) {
    if (!(el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) || !el.href) continue;
    if (el.hasAttribute('download') || !/^https?:/i.test(el.href)) return null;
    return el;
  }
  return null;
}

function glance(link) {
  // where the link is, for the reveal to grow from (only known in the top frame; frames grow from the middle)
  let rect = null;
  if (window === window.top) {
    const r = link.getBoundingClientRect();
    const z = webFrame.getZoomFactor();
    rect = { x: r.left * z, y: r.top * z, width: r.width * z, height: r.height * z };
  }
  ipcRenderer.send('ultima:glance', { url: link.href, rect });
}

const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };

if (/^https?:$/.test(location.protocol)) {
  refresh();
  let hold = null; // { link, x, y, timer, fired }
  const cancelHold = () => { if (hold && !hold.fired) clearTimeout(hold.timer); if (!hold?.fired) hold = null; };

  window.addEventListener('pointerdown', (e) => {
    refresh();
    cancelHold();
    hold = null;
    if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch' || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const link = linkOf(e);
    if (!link || !config?.hold) return;
    hold = { link, x: e.clientX, y: e.clientY, fired: false };
    hold.timer = setTimeout(() => { hold.fired = true; glance(link); }, HOLD_MS);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (hold && !hold.fired && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) cancelHold();
  }, true);
  for (const type of ['pointercancel', 'wheel']) window.addEventListener(type, cancelHold, true);
  window.addEventListener('pointerup', () => { if (hold && !hold.fired) cancelHold(); }, true);
  // after a hold glanced: no drag of the link, no click on it
  window.addEventListener('dragstart', (e) => { if (hold?.fired) swallow(e); }, true);

  window.addEventListener('click', (e) => {
    if (hold?.fired) { hold = null; swallow(e); return; }
    if (e.button !== 0 || !config || e.ctrlKey || e.metaKey) return;
    const wanted = (e.altKey && !e.shiftKey && config.alt) || (e.shiftKey && !e.altKey && config.shift);
    if (!wanted) return;
    const link = linkOf(e);
    if (!link) return;
    swallow(e);
    glance(link);
  }, true);
  // a held link's context menu stays shut while it glances
  window.addEventListener('contextmenu', (e) => { if (hold?.fired) swallow(e); else cancelHold(); }, true);
}
