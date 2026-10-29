// Arranging the sidebar's buttons. A sheet slides up from the bottom of the window with every button not in use, and
// a divider and a blank space; they're dragged straight onto the sidebar, into the grid at its top (beside the logo) or its bottom, and
// the buttons there slide aside to open a gap where one will land. Buttons already in the sidebar drag to a new place,
// or back onto the sheet to take them off. With horizontal tabs, the same goes for the toolbar.
const SBX = { sheet: null, press: null, drag: null };
const sidebarEditing = () => Boolean(SBX.sheet);
const DIVIDER_ICON = '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v16"/><path d="M7 8v8M17 8v8" opacity=".35"/></svg>';
const SPACE_ICON = '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 3"><rect x="4" y="4" width="16" height="16" rx="4"/></svg>';
const sbxIcon = (key, size = 16) => (key === SIDEBAR_DIVIDER ? DIVIDER_ICON.replace(/22/g, String(size))
  : key === SIDEBAR_SPACE ? SPACE_ICON.replace(/22/g, String(size)) : icon(SIDEBAR_BUTTONS[key].icon, size));
const sbxLabel = (key) => (key === SIDEBAR_DIVIDER ? 'Divider' : key === SIDEBAR_SPACE ? 'Blank space' : SIDEBAR_BUTTONS[key].label);

function openSidebarEditor() {
  if (SBX.sheet) return;
  closeWidget();
  const across = tabsAcross();
  const sheet = h(`<div class="sbx-sheet" role="dialog" aria-label="Edit ${across ? 'toolbar' : 'sidebar'}">
    <div class="sbx-grip" aria-hidden="true"></div>
    <div class="sbx-head">
      <div><div class="sbx-title">Edit ${across ? 'toolbar' : 'sidebar'}</div>
        <div class="sbx-sub">${across ? 'Drag buttons onto the toolbar.' : 'Drag buttons onto the top or bottom of the sidebar.'} Drag them back here to remove them.</div></div>
      <div class="sbx-actions"><button class="btn" data-sbx-reset>${icon('reload', 14)} Reset</button><button class="btn primary" data-sbx-done>Done</button></div>
    </div>
    <div class="sbx-library"></div>
  </div>`);
  document.body.append(sheet);
  SBX.sheet = sheet;
  document.body.classList.add('sb-editing');
  if (sidebarHidden()) sidebarPeek(true); // (it stays out while the sheet is open: sidebarBusy)
  placeSidebarSheet();
  renderSidebarSheet();
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-sbx-done]')) closeSidebarEditor();
    else if (e.target.closest('[data-sbx-reset]')) setSidebarLayout(SIDEBAR_DEFAULT);
  });
  document.addEventListener('pointerdown', sbxPointerDown, true);
  window.addEventListener('pointermove', sbxPointerMove, true);
  window.addEventListener('pointerup', sbxPointerUp, true);
  window.addEventListener('pointercancel', sbxCancel, true);
  document.addEventListener('click', sbxEatClick, true);
  window.addEventListener('keydown', sbxKey, true);
  window.addEventListener('resize', placeSidebarSheet);
  $('[data-sbx-done]', sheet).focus({ preventScroll: true });
}

function closeSidebarEditor() {
  const sheet = SBX.sheet;
  if (!sheet) return;
  if (SBX.drag) sbxFinish();
  SBX.sheet = null;
  SBX.press = null;
  document.body.classList.remove('sb-editing');
  document.removeEventListener('pointerdown', sbxPointerDown, true);
  window.removeEventListener('pointermove', sbxPointerMove, true);
  window.removeEventListener('pointerup', sbxPointerUp, true);
  window.removeEventListener('pointercancel', sbxCancel, true);
  document.removeEventListener('click', sbxEatClick, true);
  window.removeEventListener('keydown', sbxKey, true);
  window.removeEventListener('resize', placeSidebarSheet);
  sheet.classList.add('out');
  setTimeout(() => sheet.remove(), 240);
  if (sidebarHidden()) sidebarLeave(400);
}

// Along the bottom of the page, beside the sidebar (so the sidebar stays in view to drop onto).
function placeSidebarSheet() {
  if (!SBX.sheet) return;
  const r = $('#content').getBoundingClientRect();
  SBX.sheet.style.left = `${Math.round(r.left + 12)}px`;
  SBX.sheet.style.right = `${Math.round(innerWidth - r.right + 12)}px`;
}

// The divider and the blank space (always), then every button that isn't in the sidebar. A click adds one to the bottom.
function renderSidebarSheet() {
  const lib = SBX.sheet && $('.sbx-library', SBX.sheet);
  if (!lib) return;
  const layout = sidebarLayout();
  const used = new Set([...layout.head, ...layout.foot]);
  const free = [SIDEBAR_DIVIDER, SIDEBAR_SPACE, ...Object.keys(SIDEBAR_BUTTONS).filter((k) => !used.has(k))];
  lib.innerHTML = free.map((k) => `<button class="sbx-tile" data-sbx-add="${k}" title="Drag onto the ${tabsAcross() ? 'toolbar' : 'sidebar'}, or click to add it">
    ${sbxIcon(k, 22)}<span>${esc(sbxLabel(k))}</span></button>`).join('')
    + (free.length === 2 ? '<div class="sbx-empty">Every button is in use.</div>' : '');
}

// ---------- dragging ----------
// A press on a button in the sheet or the sidebar becomes a drag once it moves a few pixels; a click on one in the
// sheet adds it to the bottom.
function sbxPointerDown(e) {
  if (e.button !== 0 || SBX.drag) return;
  const tile = e.target.closest('.sbx-tile[data-sbx-add]');
  const item = !tile && e.target.closest('#sidebar [data-zone] > [data-sbb]');
  if (!tile && !item) return;
  e.preventDefault(); // no focus ring or text selection on the way
  SBX.press = { key: tile ? tile.dataset.sbxAdd : item.dataset.sbb, from: item || null, tile, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
}

function sbxPointerMove(e) {
  const d = SBX.drag;
  if (d) {
    d.x = e.clientX;
    d.y = e.clientY;
    d.settle = 0;
    if (!d.aimQueued) { d.aimQueued = true; requestAnimationFrame(() => { d.aimQueued = false; if (SBX.drag === d && !d.settling) sbxAim(); }); }
    return;
  }
  const p = SBX.press;
  if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) sbxStart(e);
}

function sbxPointerUp() {
  const p = SBX.press;
  SBX.press = null;
  if (SBX.drag) { sbxDrop(); return; }
  if (p?.tile) placeSidebarButton(p.key, 'foot'); // a click on a tile
}

function sbxCancel() {
  SBX.press = null;
  if (SBX.drag) sbxSettle(null);
}

// clicks in the sidebar's grids arrange them now, rather than press the buttons
function sbxEatClick(e) {
  if (e.target.closest('#sidebar [data-zone]')) { e.preventDefault(); e.stopPropagation(); }
}

function sbxKey(e) {
  if (!matchesKey(e, 'dialog.cancel')) return;
  e.preventDefault();
  e.stopPropagation();
  if (SBX.drag) sbxSettle(null); else closeSidebarEditor();
}

function sbxStart(e) {
  const p = SBX.press;
  SBX.press = null;
  const src = p.from || p.tile;
  const r = (p.from || $('.ic', p.tile) || p.tile).getBoundingClientRect();
  const ghost = h(`<div class="sbx-ghost ${p.key === SIDEBAR_DIVIDER ? 'is-div' : ''}">${sbxIcon(p.key)}</div>`);
  document.body.append(ghost);
  const slot = h(`<span class="sbx-slot ${p.key === SIDEBAR_DIVIDER ? 'is-div' : ''}"></span>`);
  // a button lifted off the sidebar leaves its gap where it was, until it goes somewhere else
  if (p.from) { p.from.before(slot); p.from.classList.add('sbx-src'); }
  else p.tile.classList.add('sbx-lifted');
  SBX.drag = { key: p.key, from: p.from, tile: p.tile, src, ghost, slot, x: e.clientX, y: e.clientY, home: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, t0: performance.now(), vx: 0, lastX: e.clientX, tilt: 0 };
  document.body.classList.add('sbx-dragging');
  $$('webview').forEach((w) => { w.style.pointerEvents = 'none'; }); // the page mustn't swallow the pointer
  try { document.body.setPointerCapture(p.pointerId); } catch { /* released already */ }
  requestAnimationFrame(sbxFrame);
  sbxAim();
}

// The lifted button follows the pointer, a little bigger, leaning into its movement.
function sbxFrame(now) {
  const d = SBX.drag;
  if (!d || d.settling) return;
  const lift = Math.min(1, (now - d.t0) / 140);
  d.vx = d.vx * 0.7 + (d.x - d.lastX) * 0.3;
  d.lastX = d.x;
  d.tilt += (Math.max(-10, Math.min(10, d.vx * 0.8)) - d.tilt) * 0.25;
  d.ghost.style.transform = `translate(${d.x - 18}px, ${d.y - 18}px) rotate(${d.tilt.toFixed(2)}deg) scale(${1 + 0.15 * lift})`;
  requestAnimationFrame(sbxFrame);
}

// Where it would land: in the grid under the pointer (or near it), before the first button that comes after the
// pointer reading row by row; over the sheet, off the sidebar.
function sbxAim() {
  const d = SBX.drag;
  const at = document.elementFromPoint(d.x, d.y);
  const overSheet = Boolean(at?.closest('.sbx-sheet'));
  d.remove = overSheet && Boolean(d.from);
  SBX.sheet.classList.toggle('drop-remove', d.remove);
  d.ghost.classList.toggle('removing', d.remove);
  let zone = !overSheet && at?.closest('#sidebar [data-zone]');
  if (!zone && !overSheet) {
    // close to a grid counts too (its edges are easy to miss)
    zone = Object.values(sidebarZones()).find((z) => {
      if (!z.getClientRects().length) return false;
      const r = z.getBoundingClientRect();
      return d.x > r.left - 16 && d.x < r.right + 16 && d.y > r.top - 12 && d.y < r.bottom + 12;
    });
  }
  if (!zone) { sbxMoveSlot(null); return; }
  const items = [...zone.children].filter((el) => el !== d.slot && !el.classList.contains('sbx-src') && el.dataset.sbb);
  const next = items.find((el) => {
    const r = sbxRestingRect(el);
    return d.y < r.top || (d.y <= r.bottom && d.x < r.left + r.width / 2);
  });
  sbxMoveSlot(zone, next || null);
}

// where an element sits, leaving out the slide it may be in the middle of (or the gap would flicker)
function sbxRestingRect(el) {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return { left: r.left - m.m41, right: r.right - m.m41, top: r.top - m.m42, bottom: r.bottom - m.m42, width: r.width, height: r.height };
}

// Moves the gap, sliding the buttons that shift (measure, move, then animate from where they were).
function sbxMoveSlot(parent, next) {
  const d = SBX.drag;
  const slot = d.slot;
  if (slot.parentElement === parent && slot.nextElementSibling === next) return;
  if (!parent && !slot.isConnected) return;
  const els = $$('#sidebar [data-zone] > *');
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  if (!parent) slot.remove();
  else parent.insertBefore(slot, next);
  for (const el of els) {
    if (el === slot || !el.isConnected) continue;
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    void el.offsetWidth;
    el.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
    el.style.transform = '';
  }
  // moving the gap moves what's under a still pointer: look again (a few times at most, or it could chase itself)
  if ((d.settle || 0) < 3) { d.settle = (d.settle || 0) + 1; requestAnimationFrame(() => { if (SBX.drag === d && !d.settling) sbxAim(); }); }
}

// Let go: into its gap, off the sidebar (over the sheet), or back where it came from.
function sbxDrop() {
  const d = SBX.drag;
  if (d.slot.isConnected) {
    // the new order, read off the grids as they show now
    const read = (z) => [...z.children].filter((el) => el === d.slot || (el.dataset.sbb && !el.classList.contains('sbx-src'))).map((el) => (el === d.slot ? d.key : el.dataset.sbb));
    const zones = sidebarZones();
    const layout = { head: read(zones.head), foot: read(zones.foot) };
    sbxSettle(d.slot, () => setSidebarLayout(layout));
  } else if (d.remove) {
    const read = (z) => [...z.children].filter((el) => el.dataset.sbb && !el.classList.contains('sbx-src')).map((el) => el.dataset.sbb);
    const zones = sidebarZones();
    const layout = { head: read(zones.head), foot: read(zones.foot) };
    sbxSettle('sheet', () => setSidebarLayout(layout));
  } else sbxSettle(null);
}

// The lifted button glides into its gap (or fades into the sheet, or flies home), then the change is made.
function sbxSettle(where, then) {
  const d = SBX.drag;
  if (!d || d.settling) return;
  d.settling = true;
  SBX.sheet?.classList.remove('drop-remove');
  let x = d.home.x;
  let y = d.home.y;
  if (where && where !== 'sheet') { const r = where.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  if (where === 'sheet') { x = d.x; y = d.y + 24; }
  if (!where && d.from) sbxMoveSlot(d.from.parentElement, d.from); // (the gap goes back home)
  d.ghost.classList.add('settling');
  d.ghost.style.transform = `translate(${x - 18}px, ${y - 18}px) rotate(0deg) scale(${where === 'sheet' ? 0.5 : 1})`;
  if (where === 'sheet' || (!where && !d.from)) d.ghost.style.opacity = '0';
  setTimeout(() => { sbxFinish(); then?.(); }, 170);
}

function sbxFinish() {
  const d = SBX.drag;
  if (!d) return;
  SBX.drag = null;
  d.ghost.remove();
  d.slot.remove();
  d.from?.classList.remove('sbx-src');
  d.tile?.classList.remove('sbx-lifted');
  document.body.classList.remove('sbx-dragging');
  $$('webview').forEach((w) => { w.style.pointerEvents = ''; });
  $$('#sidebar [data-zone] > *').forEach((el) => { el.style.transform = ''; el.style.transition = ''; });
}
