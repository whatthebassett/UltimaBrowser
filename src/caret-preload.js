// Caret browsing (Settings → Accessibility, or F7): a text cursor in every page that the arrow keys move, so pages can
// be read and their text selected with the keyboard alone. Electron leaves out Chrome's own caret browsing, so Ultima
// draws the cursor itself and moves the page's selection: arrows move it (Ctrl by word), Home/End to the line's ends
// (Ctrl: the page's), Shift selects, and Enter follows the link it's in. Text boxes keep their own cursor.
// A session preload (see setupSession in main.js), in the preload's own world; it's on only while the setting is.
const { ipcRenderer } = require('electron');

let on = false;
const apply = (v) => { on = Boolean(v); if (on) drawCaret(); else hideCaret(); };
const refresh = () => ipcRenderer.invoke('ultima:caret-config').then(apply).catch(() => {});

// keys inside these are the field's own
function editable(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'IFRAME';
}

// ---------- the drawn cursor ----------
let caretEl = null;
function hideCaret() { caretEl?.remove(); caretEl = null; }
function caretRect() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = document.createRange();
  r.setStart(sel.focusNode, sel.focusOffset);
  r.collapse(true);
  const rect = [...r.getClientRects()][0] || r.getBoundingClientRect();
  if (rect.height) return rect;
  // at an element's edge there's no rect: use the element's own top left
  const el = sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement;
  const er = el?.getBoundingClientRect();
  return er ? { left: er.left, top: er.top, height: Math.min(er.height, 24) || 18 } : null;
}
function drawCaret() {
  if (!on || editable(document.activeElement) || !document.hasFocus()) { hideCaret(); return; }
  const rect = caretRect();
  if (!rect) { hideCaret(); return; }
  if (!caretEl) {
    caretEl = document.createElement('div');
    caretEl.setAttribute('aria-hidden', 'true');
    caretEl.style.cssText = 'position:fixed;width:2px;background:#8b5cf6;pointer-events:none;z-index:2147483647;border-radius:1px;box-shadow:0 0 0 1px rgba(255,255,255,0.7)';
    document.documentElement.append(caretEl);
    caretEl.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.51 }, { opacity: 0 }], { duration: 1060, iterations: Infinity });
  }
  Object.assign(caretEl.style, { left: `${rect.left - 1}px`, top: `${rect.top}px`, height: `${rect.height}px` });
}

// puts the cursor somewhere to start from: the first text on screen
function placeCaret() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (!n.textContent.trim()) return NodeFilter.FILTER_REJECT;
      const r = n.parentElement?.getBoundingClientRect();
      return r && r.bottom > 0 && r.top < innerHeight && r.width ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const node = walker.nextNode();
  if (node) getSelection().collapse(node, node.textContent.search(/\S/));
}

function keepInView() {
  const rect = caretRect();
  if (!rect) return;
  if (rect.top < 40) window.scrollBy(0, rect.top - 80);
  else if (rect.top + rect.height > innerHeight - 40) window.scrollBy(0, rect.top + rect.height - innerHeight + 80);
}

const MOVES = {
  ArrowLeft: ['backward', 'character', 'word'], ArrowRight: ['forward', 'character', 'word'],
  ArrowUp: ['backward', 'line', 'paragraph'], ArrowDown: ['forward', 'line', 'paragraph'],
  Home: ['backward', 'lineboundary', 'documentboundary'], End: ['forward', 'lineboundary', 'documentboundary'],
};

if (/^https?:$/.test(location.protocol)) {
  refresh();
  window.addEventListener('focus', refresh);
  ipcRenderer.on('ultima:caret', (_e, v) => apply(v)); // turned on or off (F7) while the page is open
  window.addEventListener('keydown', (e) => {
    if (!on || e.defaultPrevented || e.altKey || e.metaKey || editable(document.activeElement)) return;
    const sel = getSelection();
    if (e.key === 'Enter' && sel.rangeCount) {
      // Enter on a link follows it
      const node = sel.focusNode;
      const link = (node.nodeType === 1 ? node : node.parentElement)?.closest('a[href]');
      if (link) { e.preventDefault(); link.click(); }
      return;
    }
    const move = MOVES[e.key];
    if (!move) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!sel.rangeCount) placeCaret();
    else sel.modify(e.shiftKey ? 'extend' : 'move', move[0], e.ctrlKey ? move[2] : move[1]);
    keepInView();
    drawCaret();
  }, true);
  // the cursor follows clicks, selections and scrolling
  document.addEventListener('selectionchange', () => { if (on) requestAnimationFrame(drawCaret); });
  window.addEventListener('scroll', () => { if (caretEl) requestAnimationFrame(drawCaret); }, true);
  window.addEventListener('blur', hideCaret);
  window.addEventListener('focusin', () => { if (on) requestAnimationFrame(drawCaret); }, true);
}
