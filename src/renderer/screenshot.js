// Screenshots (Take screenshot: the Control Palette, the address bar menu, a page's right-click menu): drag over part
// of the page, or take what's on screen or the whole page. It's copied and saved in the folder chosen in Settings →
// General → Screenshots (where downloads go, unless you pick another; pagetools.js does the taking).
const SHOT = { el: null, tab: null };

function openScreenshot(tab = activeTab()) {
  closeScreenshot();
  if (!tab || !ready(tab) || isInternal(tab.url)) return toast('Screenshots work on web pages');
  const r = tab.webview.getBoundingClientRect();
  const el = h(`<div class="shot" role="dialog" aria-label="Take screenshot" tabindex="-1">
    <div class="shot-bar"><span>Drag over what you want, or take</span>
      <button class="btn" data-shot="visible">${icon('monitor', 14)} What’s on screen</button>
      <button class="btn" data-shot="full">${icon('file', 14)} Whole page</button>
      <button class="icon-btn" data-shot="cancel" title="Cancel (Esc)">${icon('close', 14)}</button></div>
    <div class="shot-sel" hidden><span class="shot-size"></span></div></div>`);
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(el);
  el.focus();
  Object.assign(SHOT, { el, tab });

  // dragging out the part to take, from where the pointer went down to where it is
  const sel = $('.shot-sel', el);
  let start = null;
  const box = (e) => {
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
    return { x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
  };
  const draw = (b) => {
    sel.hidden = false;
    Object.assign(sel.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px` });
    $('.shot-size', sel).textContent = `${Math.round(b.width)} × ${Math.round(b.height)}`;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.shot-bar')) return;
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    el.setPointerCapture(e.pointerId);
    el.classList.add('picking');
    draw(box(e));
  });
  el.addEventListener('pointermove', (e) => { if (start) draw(box(e)); });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const b = box(e);
    start = null;
    if (b.width < 4 || b.height < 4) { el.classList.remove('picking'); sel.hidden = true; return; } // a click, not a drag
    captureScreenshot({ rect: b });
  });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-shot]')?.dataset.shot;
    if (act === 'cancel') closeScreenshot();
    else if (act) captureScreenshot({ full: act === 'full' });
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeScreenshot(); } });
  return undefined;
}

function closeScreenshot() {
  SHOT.el?.remove();
  SHOT.el = null;
}

// Takes it (`rect`: part of the page, in the page's view; `full`: the whole page; neither: what's on screen)
async function captureScreenshot({ rect, full } = {}, tab = SHOT.tab || activeTab()) {
  const where = SHOT.el?.getBoundingClientRect();
  closeScreenshot();
  SHOT.tab = null;
  if (!tab || !ready(tab) || isInternal(tab.url)) { toast('Screenshots work on web pages'); return null; }
  try {
    const shot = await window.ultima.takeScreenshot({ webContentsId: tab.webview.getWebContentsId(), rect, full });
    // a quick flash where it was taken
    const r = where || tab.webview.getBoundingClientRect();
    const flash = h('<div class="shot-flash"></div>');
    const part = rect ? { x: r.left + rect.x, y: r.top + rect.y, w: rect.width, h: rect.height } : { x: r.left, y: r.top, w: r.width, h: r.height };
    Object.assign(flash.style, { left: `${part.x}px`, top: `${part.y}px`, width: `${part.w}px`, height: `${part.h}px` });
    document.body.append(flash);
    setTimeout(() => flash.remove(), 450);
    toast(`Screenshot copied and saved in ${shot.folder}`, { label: 'Show', run: () => window.ultima.showScreenshot(shot.file) });
    return shot;
  } catch (err) {
    toast(`Couldn’t take the screenshot. ${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    return null;
  }
}
