// Glance: a link opened in a preview over the page you're on (Alt+click, Shift+click, or press and hold a link; see
// glance-preload.js). The preview grows out of the link and is a real page you can use. From it you can open it as a
// tab (the same page, nothing reloads), put it in split view next to the page, or close it (Esc, the ×, or a click
// beside it). Switching tabs closes it.
// Its <webview> sits in #viewport like a tab's, so opening it as a tab only hands that webview to a new tab.
const GL = { open: null }; // { source, wv, frame, backdrop, bar, origin, url, title, favicon }
const GLANCE_EASE = 'cubic-bezier(0.2, 0.85, 0.25, 1)';

// where the preview sits in the page area: most of it, with room on the right for its buttons
function glanceBox() {
  const vp = $('#viewport').getBoundingClientRect();
  const side = Math.max(56, Math.round(vp.width * 0.06));
  const top = Math.max(16, Math.round(vp.height * 0.035));
  const width = Math.min(vp.width - side * 2, 1500);
  return { left: Math.round((vp.width - width) / 2), top, width, height: vp.height - top * 2 };
}
const px = (b) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
// the transform that shrinks an element laid out at `box` onto `origin` (the link), keeping its shape
function shrunkTo(origin, box) {
  const k = Math.max(0.12, Math.min(0.5, origin.width / box.width));
  const dx = origin.left + origin.width / 2 - (box.left + box.width / 2);
  const dy = origin.top + origin.height / 2 - (box.top + box.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${k})`;
}
// a clip showing only `inner` (viewport coordinates) of an element laid out at `box`
const clipTo = (inner, box, radius) => `inset(${inner.top - box.top}px ${box.left + box.width - inner.left - inner.width}px ${box.top + box.height - inner.top - inner.height}px ${inner.left - box.left}px round ${radius}px)`;

function layoutGlance() {
  const g = GL.open;
  if (!g) return;
  const box = glanceBox();
  Object.assign(g.frame.style, px(box));
  Object.assign(g.wv.style, px(box));
  Object.assign(g.bar.style, { left: `${box.left + box.width + 10}px`, top: `${box.top}px` });
  g.box = box;
}

function glanceBarHtml(source) {
  return `<button class="glance-btn" data-glance="close" title="Close (Esc)">${icon('close', 16)}</button>
    <button class="glance-btn" data-glance="tab" title="Open as a tab">${icon('external', 16)}</button>
    <button class="glance-btn" data-glance="split" title="Open in split view" ${canSplit(source) ? '' : 'disabled'}>${icon('split', 16)}</button>`;
}

function openGlance({ url, rect, webContentsId }) {
  // a link glanced inside a glance opens in the same one
  if (GL.open) {
    let inGlance = false;
    try { inGlance = GL.open.wv.getWebContentsId() === webContentsId; } catch { /* not attached yet */ }
    if (inGlance) { GL.open.wv.loadURL(url); return; }
    closeGlance({ instant: true });
  }
  const source = B.tabs.find((t) => ready(t) && t.webview.getWebContentsId() === webContentsId);
  if (!source || source.webview.classList.contains('hidden')) return;
  const vp = $('#viewport');
  const vpRect = vp.getBoundingClientRect();
  // where it grows from: the link, or the middle of the page for links in frames
  const wvRect = source.webview.getBoundingClientRect();
  const origin = rect
    ? { left: wvRect.left - vpRect.left + rect.x, top: wvRect.top - vpRect.top + rect.y, width: Math.max(rect.width, 8), height: Math.max(rect.height, 8) }
    : { left: vpRect.width / 2 - 40, top: vpRect.height / 2 - 30, width: 80, height: 60 };

  const backdrop = h('<div class="glance-backdrop"></div>');
  const frame = h('<div class="glance-frame"></div>');
  const bar = h(`<div class="glance-bar">${glanceBarHtml(source)}</div>`);
  const wv = document.createElement('webview');
  wv.className = 'glance-view';
  wv.setAttribute('partition', tabPartition(source));
  wv.setAttribute('allowpopups', '');
  wv.src = url;
  GL.open = { source, wv, frame, backdrop, bar, origin, url, title: '', favicon: '' };
  vp.append(backdrop, frame, wv, bar);
  layoutGlance();
  $('#status').hidden = true; // the link the page underneath was pointing at

  // keep track of where it goes, for opening it as a tab
  const mine = () => GL.open?.wv === wv;
  wv.addEventListener('dom-ready', () => { pageReady(wv); if (mine()) window.ultima.watchGlance(wv.getWebContentsId(), true); });
  wv.addEventListener('did-navigate', (e) => { if (mine()) { GL.open.url = e.url; GL.open.favicon = ''; } });
  wv.addEventListener('did-navigate-in-page', (e) => { if (mine() && e.isMainFrame) GL.open.url = e.url; });
  wv.addEventListener('page-title-updated', (e) => { if (mine()) GL.open.title = e.title; });
  wv.addEventListener('page-favicon-updated', (e) => { if (mine()) GL.open.favicon = e.favicons?.[0] || ''; });
  wv.addEventListener('focus', () => { if (mine()) { closeMenu(null); closeUrlMenu(); closeExtensionPopup({ fromPage: true }); } });

  // the reveal: the preview grows out of the link, the page behind dims
  const from = shrunkTo(origin, GL.open.box);
  const opts = { duration: 380, easing: GLANCE_EASE };
  const grow = [{ transform: from, opacity: 0 }, { opacity: 1, offset: 0.45 }, { transform: 'none', opacity: 1 }]; // faded in by halfway
  wv.animate(grow, opts);
  frame.animate(grow, opts);
  backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
  bar.animate([{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 140, easing: 'ease-out', fill: 'backwards' });
  wv.focus();
}

// Closes the preview, back into the link it came from
function closeGlance({ instant = false } = {}) {
  const g = GL.open;
  if (!g) return;
  GL.open = null;
  try { window.ultima.watchGlance(g.wv.getWebContentsId(), false); } catch { /* never attached */ }
  // the page underneath gets the keyboard back once the preview (which had it) is gone
  const remove = () => {
    g.wv.remove(); g.frame.remove(); g.backdrop.remove(); g.bar.remove();
    if (activeTab() === g.source && !GL.open) g.source.webview?.focus();
  };
  if (instant) remove();
  else {
    const to = shrunkTo(g.origin, g.box);
    const opts = { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' };
    g.wv.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], opts);
    g.frame.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], opts);
    g.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], opts);
    g.bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    g.wv.style.pointerEvents = 'none';
    setTimeout(remove, 250);
  }
}

// Makes the preview a tab next to the page it came from. Its page carries over as it is (same sign-ins: nothing
// reloads); with other sign-ins (a separate space's Essential) it loads again in the new tab.
function glanceToTab() {
  const g = GL.open;
  if (!g) return null;
  GL.open = null;
  try { window.ultima.watchGlance(g.wv.getWebContentsId(), false); } catch { /* never attached */ }
  const url = (() => { try { return g.wv.getURL() || g.url; } catch { return g.url; } })();
  const tab = createTab({ url, title: g.title || url, favicon: g.favicon, opener: g.source.zone === 'normal' ? g.source : undefined, spaceId: g.source.zone === 'essential' ? B.activeSpaceId : g.source.spaceId, activate: false, lazy: true });
  const box = g.box;
  g.frame.remove();
  g.backdrop.remove();
  g.bar.remove();
  if (tabPartition(tab) === g.wv.getAttribute('partition')) {
    g.wv.className = 'hidden';
    Object.assign(g.wv.style, { left: '', top: '', width: '', height: '', clipPath: '', opacity: '', pointerEvents: '' });
    ensureWebview(tab, g.wv);
  } else g.wv.remove();
  return { tab, box };
}

function expandGlance() {
  const done = glanceToTab();
  if (!done) return;
  activateTab(done.tab.id);
  // it grows from the preview's frame to the whole page area
  const vp = $('#viewport').getBoundingClientRect();
  const full = { left: 0, top: 0, width: vp.width, height: vp.height };
  done.tab.webview?.animate([{ clipPath: clipTo(done.box, full, 14) }, { clipPath: 'inset(0px round 0px)' }], { duration: 300, easing: GLANCE_EASE });
}

function splitGlance() {
  const source = GL.open?.source;
  if (!source || !canSplit(source)) return;
  const done = glanceToTab();
  if (done) splitWith(source, done.tab);
}

function initGlance() {
  window.ultima.on('glance', openGlance);
  window.ultima.on('glance-escape', (id) => { if (GL.open) closeGlance(); }); // Esc inside the preview
  $('#viewport').addEventListener('click', (e) => {
    if (!GL.open) return;
    const btn = e.target.closest('[data-glance]');
    if (btn) {
      if (btn.dataset.glance === 'close') closeGlance();
      else if (btn.dataset.glance === 'tab') expandGlance();
      else if (btn.dataset.glance === 'split') splitGlance();
    } else if (e.target === GL.open.backdrop) closeGlance();
  });
  window.addEventListener('resize', layoutGlance);
  // Esc with the UI focused (inside the preview, main sends glance-escape)
  window.addEventListener('keydown', (e) => {
    if (GL.open && e.key === 'Escape' && $('#palette-backdrop').hidden && !document.querySelector('.ctx-layer, .dd-layer, .dlg-backdrop')) { e.preventDefault(); e.stopPropagation(); closeGlance(); }
  }, true);
}
