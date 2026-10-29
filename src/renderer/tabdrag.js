// Dragging tabs like cards: the tab lifts off the sidebar as a card that follows the pointer (tilting with its
// movement), the other tabs slide aside to open a gap where it will land, and on release it settles into the gap.
// It can land among regular or pinned tabs, in Essentials, in a folder (in its gap, or on its header), or on the
// bookmarks bar (which bookmarks it). Esc (rebindable) or dropping anywhere else sends it back.
// A tab dragged out of the window, or onto the middle of the page, is torn off: the window it would become follows the
// pointer (main/tearoff.js), and letting go opens it there. Over another Ultima window's tabs, it shows up there as a
// card with its gap instead, and letting go moves it in (a torn-off tab can also go back from its menu). A pinned tab
// or Essential is in every window's sidebar already: its page moves to that window's own copy, and the one here goes
// back to its pinned link.
// A folder drags the same way by its header: the whole folder is the card, and it lands among the regular or pinned
// tabs (which pins or unpins it).
const TD = { press: null, drag: null, dirty: false };
const CARD_START = 5; // pixels the pointer moves before a press becomes a drag
const LIST_ZONES = { essentials: 'essential', 'pinned-list': 'pinned', tabs: 'normal' };
// Lists run down the sidebar, or across the tab strip with horizontal tabs (tablayout.js): "ahead of the pointer" and
// "within a span" follow that axis, so every rule below works both ways.
const isAhead = (r, d) => (tabsAcross() ? r.left + r.width / 2 > d.x : r.top + r.height / 2 > d.y);
const along = (d) => (tabsAcross() ? d.x : d.y);
const span = (r) => (tabsAcross() ? { start: r.left, end: r.right, size: r.width } : { start: r.top, end: r.bottom, size: r.height });

function initTabCardDrag() {
  const side = $('#sidebar');
  side.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || TD.drag) return;
    const head = e.target.closest('.tfolder-head');
    if (head && e.target.closest('button')) return; // the header's own buttons (new tab in folder)
    if (head) { TD.press = { el: head.parentElement, folderId: head.dataset.folderHead, x: e.clientX, y: e.clientY, pointerId: e.pointerId }; return; }
    const el = e.target.closest('.tab[data-tab], .pin[data-tab]');
    if (!el || e.target.closest('[data-act], .tab-rename, input')) return;
    TD.press = { el, id: Number(el.dataset.tab), x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (TD.drag) { onCardMove(e); return; }
    const p = TD.press;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CARD_START) startCardDrag(e);
  }, true);
  window.addEventListener('pointerup', (e) => {
    TD.press = null;
    if (TD.drag) dropCard(e);
  }, true);
  window.addEventListener('pointercancel', () => { TD.press = null; if (TD.drag) settleCard('back'); }, true);
  window.addEventListener('keydown', (e) => {
    if (TD.drag && matchesKey(e, 'drag.cancel')) { e.preventDefault(); e.stopPropagation(); settleCard('back'); }
  }, true);
  window.addEventListener('blur', () => { if (TD.drag) settleCard('back'); });
}

function startCardDrag(e) {
  const p = TD.press;
  TD.press = null;
  const tab = p.folderId ? null : tabById(p.id);
  if ((!tab && !folderById(p.folderId)) || !document.contains(p.el)) return;
  const r = p.el.getBoundingClientRect();
  const list = $('#tabs').getBoundingClientRect(); // before the drag opens drop spots around it (a torn-off tab lands first in it)
  const isPin = p.el.classList.contains('pin');
  const card = p.el.cloneNode(true);
  card.classList.add('drag-card');
  // the card is a picture of the tab or folder: nothing in it may be mistaken for the real thing
  for (const el of [card, ...card.querySelectorAll('*')]) {
    for (const a of ['data-tab', 'data-folder', 'data-folder-head', 'title', 'data-tip', 'id']) el.removeAttribute(a);
  }
  card.tabIndex = -1;
  Object.assign(card.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(card);
  const slot = h(`<div class="drag-slot ${isPin ? 'pin-slot' : 'tab-slot'}"></div>`);
  p.el.before(slot);
  p.el.classList.add('drag-source');
  TD.drag = {
    id: p.id, folderId: p.folderId, tab, card, slot, source: p.el, home: { parent: slot.parentElement, next: p.el },
    left: r.left, top: r.top, offX: p.x - r.left, offY: p.y - r.top, x: e.clientX, y: e.clientY,
    vx: 0, tilt: 0, t0: performance.now(), target: { kind: 'list' }, list,
  };
  document.body.classList.add('tab-dragging', 'card-dragging');
  $$('webview').forEach((w) => { w.style.pointerEvents = 'none'; }); // the page mustn't swallow the pointer
  try { document.body.setPointerCapture(p.pointerId); } catch { /* released already */ }
  if (tab) beginTear(TD.drag);
  card.focus({ preventScroll: true }); // keys (Esc) come to Ultima, not the page
  // the click that ends this press must not open whatever is under the pointer (removed when the drag ends)
  TD.eatClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', TD.eatClick, true);
  requestAnimationFrame(cardFrame);
}

function onCardMove(e) {
  const d = TD.drag;
  d.vx = d.vx * 0.6 + (e.clientX - d.x) * 0.4;
  d.x = e.clientX;
  d.y = e.clientY;
  d.settle = 0;
  queueAim(d);
}

function queueAim(d) {
  if (d.hitQueued) return;
  d.hitQueued = true;
  requestAnimationFrame(() => { d.hitQueued = false; if (TD.drag === d && !d.settling) aimCard(); });
}

// The card follows the pointer, lifting (a little bigger) as it starts and leaning into its movement.
function cardFrame(now) {
  const d = TD.drag;
  if (!d || d.settling) return;
  const lift = Math.min(1, (now - d.t0) / 140);
  const ease = 1 - (1 - lift) ** 3;
  d.tilt += (Math.max(-7, Math.min(7, d.vx * 0.55)) - d.tilt) * 0.2;
  d.vx *= 0.85;
  d.card.style.transform = `translate(${d.x - d.offX - d.left}px, ${d.y - d.offY - d.top}px) rotate(${(d.tilt * ease).toFixed(2)}deg) scale(${1 + 0.045 * ease})`;
  d.card.style.setProperty('--lift', ease.toFixed(3));
  autoScrollTabs(d);
  requestAnimationFrame(cardFrame);
}

// Near the top or bottom of the tab list (its ends, across the strip), the list scrolls.
function autoScrollTabs(d) {
  if (d.incoming && !d.over) return;
  const list = $('#tabs');
  const r = list.getBoundingClientRect();
  const edge = 36;
  if (tabsAcross()) {
    if (d.y < r.top - 20 || d.y > r.bottom + 20) return;
    const speed = d.x < r.left + edge ? -(r.left + edge - d.x) / 3 : d.x > r.right - edge ? (d.x - (r.right - edge)) / 3 : 0;
    if (speed && d.x > r.left - 40 && d.x < r.right + 40) list.scrollLeft += Math.max(-14, Math.min(14, speed));
    return;
  }
  const side = $('#sidebar').getBoundingClientRect();
  if (d.x < side.left || d.x > side.right) return;
  const speed = d.y < r.top + edge ? -(r.top + edge - d.y) / 3 : d.y > r.bottom - edge ? (d.y - (r.bottom - edge)) / 3 : 0;
  if (speed && d.y > r.top - 40 && d.y < r.bottom + 40) list.scrollTop += Math.max(-14, Math.min(14, speed));
}

// Works out where the card would land and opens the gap (or marks the folder / bookmark spot) there.
function aimCard() {
  const d = TD.drag;
  const at = document.elementFromPoint(d.x, d.y);
  clearCardMarks();
  // dragged in from another window: only this window's tabs take it
  if (d.incoming) {
    const on = Boolean(at && dockArea()?.contains(at));
    dockOver(d, on);
    // one of the pinned tabs or Essentials: this window has it too, and that one lights up to take the page
    if (d.copy) { d.target = { kind: on ? 'copy' : 'none' }; if (on) copyRow(d)?.classList.add('drop-copy'); return; }
    if (!on) { d.target = { kind: 'none' }; moveSlot(null); return; }
  }
  if (d.folderId) { aimFolderCard(d, at); return; }
  const tear = Boolean(d.canTear) && wantsTear(d, at);
  tearAim(d, tear);
  if (tear) return;
  // the bookmarks bar: bookmark the tab at that spot
  if (at?.closest('#bookmark-bar') && !isInternal(d.tab.url)) {
    const t = bmDropTarget({ target: at, clientX: d.x });
    if (t.el) t.el.classList.add(`drop-${t.mode}`);
    d.target = { kind: 'bar', parent: t.parent, index: t.index };
    moveSlot(d.home.parent, d.home.next);
    return;
  }
  // onto the page: split view with the tab that's showing, on that side
  if (at?.closest('#viewport')) {
    const base = activeTab();
    const vp = $('#viewport').getBoundingClientRect();
    const side = d.x < vp.left + vp.width / 2 ? 'left' : 'right';
    const ok = canSplit(base) && canSplit(d.tab) && base !== d.tab && !(base.splitId && base.splitId === d.tab.splitId)
      && !(base.splitId && splitTabs(base.splitId).length >= SPLIT_MAX);
    showSplitDrop(ok ? side : null, ok ? '' : base === d.tab ? '' : 'Split view works with web pages in regular tabs');
    d.target = ok ? { kind: 'split', side } : { kind: 'none' };
    moveSlot(d.home.parent, d.home.next);
    return;
  }
  if (!at?.closest('#sidebar')) { d.target = { kind: 'none' }; moveSlot(d.home.parent, d.home.next); return; }
  const zone = at.closest('#essentials, #pinned-list, #tabs');
  if (!zone) return; // between zones: keep the last gap
  // over the gap itself: it already shows where the tab will land, so nothing moves (moving it would shift what's
  // under the pointer and make the gap chase it)
  const sr = restingRect(d.slot);
  if (d.slot.closest('#essentials, #pinned-list, #tabs') === zone && d.x >= sr.left && d.x <= sr.right && d.y >= sr.top && d.y <= sr.bottom) {
    markFolderTarget(d);
    return;
  }
  d.target = { kind: 'list' };
  d.slot.className = `drag-slot ${zone.id === 'essentials' ? 'pin-slot' : 'tab-slot'}`;
  if (zone.id === 'essentials') {
    // a grid: the first pin that comes after the pointer in reading order
    const pins = $$('.pin[data-tab]:not(.drag-source)', zone);
    const before = pins.find((p) => { const r = restingRect(p); return r.top > d.y || (r.bottom > d.y && r.left + r.width / 2 > d.x); });
    moveSlot(zone, before || null);
    return;
  }
  // over a split row: between its parts, left to right (rearranges the split, or joins it). Once the gap is in a
  // row it stays while the pointer is within the row and a gap's height around it: taking the gap out of the
  // list moves the row by that much, which would otherwise bounce the gap straight back out.
  const inRow = d.slot.parentElement?.classList.contains('tsplit') ? d.slot.parentElement : null;
  const band = (el) => {
    const r = span(restingRect(el));
    const extra = el === inRow ? 38 : 0;
    return along(d) >= r.start - (extra && 6) && along(d) <= r.end + extra;
  };
  const row = canSplit(d.tab) && $$('.tsplit', zone).find(band);
  if (row && (row.dataset.split === d.tab.splitId || splitTabs(row.dataset.split).length < SPLIT_MAX)) {
    const parts = $$('.tab[data-tab]:not(.drag-source)', row);
    const after = parts.find((p) => { const r = restingRect(p); return r.left + r.width / 2 > d.x; });
    moveSlot(row, after || null);
    return;
  }
  if (aimIntoFolder(d, zone)) return;
  // a list: before the first row (or folder header, or split view) whose middle is below the pointer
  const items = [...new Set($$('.tab[data-tab]:not(.drag-source), .tfolder-head', zone).map((el) => el.closest('.tsplit') || el))];
  const next = items.find((el) => isAhead(restingRect(el), d));
  if (!next) moveSlot(zone, null);
  else if (next.classList.contains('tfolder-head')) moveSlot(next.parentElement.parentElement, next.parentElement); // just before the folder
  else if (next.classList.contains('tsplit')) moveSlot(next.parentElement, next); // a split view is one block
  else moveSlot(next.parentElement, next); // a tab inside a folder takes the gap into the folder
}

// ---------- tearing a tab off into a new window ----------
// The window it would become is drawn by main (tearoff.js), on a see-through window over the screen. It gets ready
// as the drag starts: a picture of the page, and this window's colors.
function beginTear(d) {
  d.canTear = true;
  const t = d.tab;
  const shown = t.webview && !t.webview.classList.contains('hidden') ? t.webview : t.id === B.activeId ? $('#viewport') : null;
  const r = shown?.getBoundingClientRect();
  // colors as they are now (resolved: the ghost has none of this window's variables)
  const probe = h('<i style="position:fixed;visibility:hidden"></i>');
  document.body.append(probe);
  const color = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
  const look = { surface: color('--surface'), text: color('--text'), accent: color('--accent'), edge: color('--border'),
    font: getComputedStyle(d.card).fontFamily, still: document.body.classList.contains('reduce-motion') };
  probe.remove();
  // the space's colors, as the sidebar wears them (over the see-through window, which the ghost can't copy)
  const sb = getComputedStyle($('#sidebar'));
  look.chrome = [sb.backgroundImage, `linear-gradient(${sb.backgroundColor}, ${sb.backgroundColor})`].filter((v) => v && v !== 'none').join(', ');
  window.ultima.tearBegin({
    rect: r && { x: r.left, y: r.top, width: r.width, height: r.height }, title: tabLabel(t), favicon: t.favicon, url: t.url, private: Boolean(t.private || B.private),
    key: isKept(t) ? t.key : undefined,
    look, grip: { x: d.offX, y: d.offY }, ratio: innerHeight / innerWidth,
    // where the page sits in the window, so the picture can grow into the same place in the new one
    inset: (({ left, top, right, bottom }) => ({ l: left, t: top, r: innerWidth - right, b: innerHeight - bottom }))($('#viewport').getBoundingClientRect()),
  }).catch(() => {});
}

// Outside the window, over the middle of the page, or anywhere on the page it's showing itself (it can't split with
// itself) or for a tab that can't split at all (a pinned tab, an Essential, one of Ultima's own pages): a new window.
// The sides of the page are still split view.
function wantsTear(d, at) {
  if (d.x < 0 || d.y < 0 || d.x >= innerWidth || d.y >= innerHeight) return true;
  if (!at?.closest('#viewport') || at.closest('.glance-view')) return false;
  const vp = $('#viewport').getBoundingClientRect();
  const across = (d.x - vp.left) / vp.width;
  return (across > 0.35 && across < 0.65) || !canSplit(d.tab) || (activeTab() === d.tab && !d.tab.splitId);
}

// The tab's card gives way to the window's picture (and comes back when the tab does).
function tearAim(d, on) {
  if (on) {
    d.target = { kind: 'window' };
    showSplitDrop(null);
    moveSlot(d.home.parent, d.home.next);
  }
  if (Boolean(d.torn) === on) return;
  d.torn = on;
  d.card.classList.toggle('torn', on);
  window.ultima.tearOut(on).catch(() => {});
}

// Let go: the tab moves to a window of its own, which opens under the pointer with the tab where you hold it, and
// leaves this one (which closes if that was all it had open).
async function tearOffCard() {
  const d = TD.drag;
  d.settling = true;
  const tab = d.tab;
  const { list } = d;
  // where the tab will be in the new window: first in its list (the sidebar and the strip look the same there); a
  // pinned tab or Essential where it is here (it's in that window's sidebar already)
  const hold = isKept(tab) ? { x: d.left + d.offX, y: d.top + d.offY }
    : tabsAcross() ? { x: list.left + d.offX, y: d.top + d.offY } : { x: d.left + d.offX, y: list.top + d.offY };
  // and where it was here (the tab after it, and its folder), so it can be sent back there
  const after = B.tabs.slice(B.tabs.indexOf(tab) + 1).find((t) => t.zone === 'normal' && t.spaceId === tab.spaceId);
  const moved = await window.ultima.tearDrop({ ...movingTab(tab), hold, home: { before: after?.id, folderId: tab.folderId } }).catch(() => false);
  d.tornOff = true;
  finishCardDrag('torn');
  if (moved && B.tabs.includes(tab)) detachTab(tab);
}

// What goes with a tab to another window (main/tearoff.js takes its page's history from `webContentsId`).
function movingTab(tab) {
  let webContentsId = null;
  try { if (ready(tab)) webContentsId = tab.webview.getWebContentsId(); } catch { /* not attached yet */ }
  return {
    url: tab.url, title: tab.title, favicon: tab.favicon, name: tab.name, spaceId: tab.spaceId, zoom: tab.zoom, muted: tab.muted,
    private: Boolean(tab.private || B.private), key: isKept(tab) ? tab.key : undefined, webContentsId,
  };
}

// A torn-off tab back to the window it came from (its menu), where it was there.
async function sendTabBack(tab) {
  const moved = await window.ultima.tearBack({ ...movingTab(tab), home: tab.cameFrom }).catch(() => false);
  if (moved && B.tabs.includes(tab)) detachTab(tab);
}

// ---------- a tab dragged in from another window ----------
// The window it's dragged from keeps the pointer, so main says where it is over this one (tearoff.js). Over this
// window's tabs it shows up as a card with its gap, as if it were dragged here; letting go moves it in at that spot.
const dockArea = () => $(tabsAcross() ? '#hstrip' : '#sidebar');

function initTabDock() {
  window.ultima.on('dock', (m) => {
    if (m.type === 'enter') dockEnter(m.tab || {});
    else if (m.type === 'drop') dockDrop(m.tab || {});
    else if (m.type === 'arrive') arriveTab(m.tab || {}, m.home || {});
    else if (TD.drag?.incoming && m.type === 'move') dockMove(Number(m.x), Number(m.y));
    else if (TD.drag?.incoming && m.type === 'leave') dockLeave();
  });
}

function dockEnter(info) {
  const old = TD.drag;
  if (old && !old.gone) return; // a drag of this window's own, or one landing here
  if (old) finishCardDrag('gone');
  const copy = keptCopy(info.key);
  const tab = { id: -1, url: String(info.url || NEWTAB), title: String(info.title || ''), favicon: String(info.favicon || ''), zone: 'normal', private: info.private || undefined };
  document.body.classList.add('tab-dragging', 'card-dragging');
  // the card is the size of the gap it will open (measured with the drop spots the drag opens), or a picture of this
  // window's copy of it
  const row = copy && $(`#sidebar [data-tab="${copy.id}"]`);
  const slot = h('<div class="drag-slot tab-slot"></div>');
  if (!row) $('#tabs').append(slot);
  const size = (row || slot).getBoundingClientRect();
  slot.remove();
  const card = row ? row.cloneNode(true) : h(tabRow(tab));
  for (const el of [card, ...card.querySelectorAll('*')]) for (const a of ['data-tab', 'title', 'data-tip', 'id']) el.removeAttribute(a);
  card.classList.remove('unloaded', 'active'); // (its page is open, in the other window)
  card.classList.add('drag-card', 'away'); // until it's over the tabs
  card.tabIndex = -1;
  Object.assign(card.style, { left: '0px', top: '0px', width: `${size.width}px`, height: `${size.height}px` });
  document.body.append(card);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  TD.drag = {
    incoming: true, id: null, tab, card, slot, source: document.createElement('i'), home: { parent: null, next: null },
    left: 0, top: 0, offX: clamp(Number(info.grip?.x) || 0, 14, size.width - 14), offY: clamp(Number(info.grip?.y) || 0, 6, size.height - 6),
    x: null, y: null, vx: 0, tilt: 0, t0: performance.now(), target: { kind: 'none' }, over: false, copy,
  };
  requestAnimationFrame(cardFrame);
}

function dockMove(x, y) {
  const d = TD.drag;
  if (d.settling || !Number.isFinite(x) || !Number.isFinite(y)) return;
  d.vx = d.x === null ? 0 : d.vx * 0.6 + (x - d.x) * 0.4;
  d.x = x;
  d.y = y;
  d.settle = 0;
  // a hidden sidebar comes out at the window's left edge, as it does for the pointer
  if (sidebarHidden() && !sidebarPeeking() && x <= 12) sidebarPeek(true);
  queueAim(d);
}

// Over this window's tabs or not: the card comes in (lifting) or tucks away, and the window it's dragged from shows
// or hides its own picture of it.
function dockOver(d, on) {
  if (d.over === on) return;
  d.over = on;
  if (on) d.t0 = performance.now();
  d.card.classList.toggle('away', !on);
  window.ultima.dockOver(on).catch(() => {});
}

// The pointer went on elsewhere, or the drag ended there: the card tucks away and its gap closes.
function dockLeave() {
  const d = TD.drag;
  if (d.settling) return;
  d.settling = true;
  d.gone = true;
  d.card.classList.add('away');
  moveSlot(null);
  clearCardMarks();
  setTimeout(() => { if (TD.drag === d) finishCardDrag('gone'); }, 180);
}

// Let go over this window: the tab moves in at its gap (or at the end of the list, if it had none yet), and opens.
function dockDrop(info) {
  const d = TD.drag;
  if (!d?.incoming || d.settling) { arriveTab(info, {}); return; } // nothing showing here any more: it comes in all the same
  if (d.copy) { takeInto(d.copy, info); settleCard('copy'); return; }
  if (d.target.kind !== 'folder' && !d.slot.closest('#essentials, #pinned-list, #tabs')) {
    d.target = { kind: 'list' };
    dockOver(d, true);
    moveSlot($('#tabs'), null);
  }
  const tab = createTab({ url: info.url || NEWTAB, title: info.title, name: info.name, favicon: info.favicon, private: info.private, restore: info.restore });
  Object.assign(tab, { zoom: Number(info.zoom) || 0, muted: Boolean(info.muted) });
  d.id = tab.id;
  d.tab = tab;
  settleCard(d.target.kind === 'folder' ? 'folder' : 'slot');
}

// A tab sent back here from the window it was torn off into: where it was (before the tab that came after it, in its
// folder and space), when that's still here; it opens.
function arriveTab(info, home) {
  const copy = keptCopy(info.key);
  if (copy) { takeInto(copy, info); return; }
  const space = spaceById(home.spaceId) ? home.spaceId : B.activeSpaceId;
  const tab = createTab({
    url: info.url || NEWTAB, title: info.title, name: info.name, favicon: info.favicon, private: info.private, restore: info.restore, spaceId: space, activate: false,
  });
  Object.assign(tab, { zoom: Number(info.zoom) || 0, muted: Boolean(info.muted) });
  tab.folderId = folderById(home.folderId)?.zone === 'normal' ? home.folderId : undefined;
  const next = tabById(Number(home.before));
  if (next && next.zone === 'normal' && next.spaceId === space && next !== tab) moveTab(tab.id, B.tabs.indexOf(next), 'normal');
  if (space !== B.activeSpaceId) switchSpace(space, tab);
  else activateTab(tab.id);
}

// Pinned tabs and Essentials are in every window, by key: this window's copy of one.
const keptCopy = (key) => (key ? B.tabs.find((t) => isKept(t) && t.key === key) || null : null);
const copyRow = (d) => $(`#sidebar [data-tab="${d.copy.id}"]`);

// A pinned tab or Essential moved here from another window: this window's copy of it takes the page, with its
// history, and opens.
function takeInto(tab, info) {
  dropWebview(tab);
  Object.assign(tab, {
    url: info.url || tab.url, title: info.title || tab.title, favicon: info.favicon || tab.favicon, restore: info.restore,
    zoom: Number(info.zoom) || 0, muted: Boolean(info.muted),
  });
  activateTab(tab.id);
}

// Takes a tab out of this window without closing it (it lives on in another). When it was all this window had of
// its own (no other page open, no pinned tab or Essential loaded), the window goes too: it moved, in effect.
function detachTab(tab) {
  const blank = (t) => t.zone === 'normal' && t.url === NEWTAB;
  if (B.tabs.every((t) => t === tab || blank(t) || (isKept(t) && !t.webview))) { window.ultima.closeWindow(); return; }
  // a pinned tab or Essential stays (it's in every window's sidebar), back on its pinned link and unloaded
  if (isKept(tab)) { unloadTab(tab); return; }
  if (B.activeId === tab.id) {
    const next = pickNextTab(tab);
    if (next) activateTab(next.id);
    else { B.activeId = null; createTab(); }
  }
  dropWebview(tab);
  B.tabs = B.tabs.filter((t) => t !== tab);
  renderTabs();
  saveSession();
}

// Where an element sits in the layout, leaving out the slide it may be in the middle of (or the gap would flicker).
function restingRect(el) {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return { left: r.left - m.m41, right: r.right - m.m41, top: r.top - m.m42, bottom: r.bottom - m.m42, width: r.width, height: r.height };
}

// A folder lands among the regular or pinned tabs, between rows and other folders (never inside one): before the
// first row, or folder header, whose middle is below the pointer.
function aimFolderCard(d, at) {
  const zone = at?.closest('#pinned-list, #tabs');
  // anywhere else (Essentials, the page…): it would go back where it was
  if (!zone) { d.target = { kind: 'none' }; moveSlot(d.home.parent, d.home.next); return; }
  d.target = { kind: 'list' };
  const items = [...zone.children].filter((el) => !el.classList.contains('drag-source') && !el.classList.contains('drag-slot'));
  const next = items.find((el) => isAhead(restingRect(el.classList.contains('tfolder') ? el.querySelector('.tfolder-head') : el), d));
  moveSlot(zone, next || null);
}

// The half of the page a dropped tab would take in split view (or why it can't).
function showSplitDrop(side, why) {
  let el = $('#viewport .split-drop');
  if (!side && !why) { el?.remove(); return; }
  if (!el) { el = h('<div class="split-drop"><span></span></div>'); $('#viewport').append(el); }
  el.className = `split-drop ${side || 'no'}`;
  $('span', el).innerHTML = side ? `${icon('split', 18)} Split view` : esc(why);
}

// A folder is one big target: anywhere from its header down to a little past its last tab puts the tab in it, at
// that spot (the folder lights up in its color). Only the top of the header means "just above the folder".
// A collapsed folder takes the tab at its end.
const FOLDER_LIP = 14; // px below a folder's last tab that still count as "in the folder"
function aimIntoFolder(d, zone) {
  for (const fEl of $$('.tfolder', zone)) {
    if (fEl.classList.contains('drag-source')) continue;
    const r = span(restingRect(fEl));
    if (along(d) < r.start || along(d) > r.end + FOLDER_LIP) continue;
    const head = $('.tfolder-head', fEl);
    const hr = span(restingRect(head));
    if (along(d) < hr.start + hr.size * 0.3) { moveSlot(fEl.parentElement, fEl); return true; } // just above (before) it
    fEl.classList.add('drop-folder');
    if (fEl.classList.contains('collapsed')) {
      // no gap inside a closed folder: the header lights up, and nothing in the sidebar moves under the pointer
      head.classList.add('drop-into');
      d.target = { kind: 'folder', id: fEl.dataset.folder };
      return true;
    }
    const box = $('.tfolder-tabs', fEl);
    if (along(d) <= hr.end) { moveSlot(box, box.firstElementChild); return true; } // on the header: first in the folder
    // among its tabs (a split view inside is one block); below the last one: at the end
    const kids = [...new Set($$('.tab[data-tab]:not(.drag-source)', box).map((el) => el.closest('.tsplit') || el))];
    const next = kids.find((el) => isAhead(restingRect(el), d));
    moveSlot(box, next || null);
    return true;
  }
  return false;
}

// Lights up the folder the tab is headed for (after the marks were cleared for a new aim that keeps the gap).
function markFolderTarget(d) {
  if (d.target.kind === 'folder') {
    const head = $(`[data-folder-head="${d.target.id}"]`);
    head?.classList.add('drop-into');
    head?.parentElement.classList.add('drop-folder');
  } else d.slot.closest('.tfolder')?.classList.add('drop-folder');
}

function clearCardMarks() {
  if (TD.drag?.target?.kind !== 'split') showSplitDrop(null);
  $$('.drop-before, .drop-after, .drop-into, .drop-target, .drop-folder, .drop-copy').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-target', 'drop-folder', 'drop-copy'));
}

// Moves the gap, sliding everything that shifts (FLIP: measure, move, then animate from the old spot).
function moveSlot(parent, next) {
  const d = TD.drag;
  const slot = d.slot;
  if (slot.parentElement === parent && slot.nextElementSibling === (next || null)) return;
  // moving the gap moves what's around it, so what's under a still pointer may now be something else: look again
  // (a few times at most), rather than wait for the pointer to move
  if ((d.settle || 0) < 3) { d.settle = (d.settle || 0) + 1; queueAim(d); }
  const els = $$('#sidebar .tab[data-tab]:not(.drag-source), #sidebar .pin[data-tab]:not(.drag-source), #sidebar .tfolder-head, #sidebar .drag-slot');
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  if (!parent) slot.remove(); // (no gap: a tab dragged in from another window, away from the tabs)
  else if (next) parent.insertBefore(slot, next); else parent.append(slot);
  layoutEssentials(); // the gap counts as a tile there
  for (const el of els) {
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
}

function dropCard() {
  const d = TD.drag;
  if (d.target.kind === 'window' && d.torn) { tearOffCard(); return; }
  if (d.target.kind === 'list' && d.slot.closest('#essentials, #pinned-list, #tabs')) settleCard('slot');
  else if (d.target.kind === 'folder' || d.target.kind === 'bar' || d.target.kind === 'split') settleCard(d.target.kind);
  else settleCard('back');
}

// Ends the drag: the card glides into its gap (or back home, or into the folder/bar and fades), then the move happens.
function settleCard(how) {
  const d = TD.drag;
  if (!d || d.settling) return;
  d.settling = true;
  // not torn off after all: the window's picture tucks away, and the tab's card comes back from wherever it is
  if (d.canTear) { window.ultima.tearCancel().catch(() => {}); d.card.classList.remove('torn'); }
  if (how === 'back') moveSlot(d.home.parent, d.home.next);
  const where = how === 'folder' ? $(`[data-folder-head="${d.target.id}"]`) : how === 'bar' ? $('#bookmark-bar') : how === 'split' ? $('#viewport .split-drop')
    : how === 'copy' ? copyRow(d) || $('#sidebar') : d.slot;
  clearCardMarks();
  const r = where.getBoundingClientRect();
  const fits = how === 'slot' || how === 'back' ? Math.abs(r.width - d.card.offsetWidth) < 4 : false;
  const dx = (fits ? r.left : r.left + r.width / 2 - d.card.offsetWidth / 2) - d.left;
  const dy = (fits ? r.top : r.top + r.height / 2 - d.card.offsetHeight / 2) - d.top;
  d.card.classList.add('settling');
  d.card.style.transform = `translate(${dx}px, ${dy}px) rotate(0deg) scale(${fits ? 1 : 0.6})`;
  if (!fits) d.card.style.opacity = '0';
  setTimeout(() => finishCardDrag(how), 190);
}

function finishCardDrag(how) {
  const d = TD.drag;
  const zoneEl = d.slot.closest('#essentials, #pinned-list, #tabs');
  let move = null;
  let folderMove = null;
  let arrange = null;
  const splitRow = how === 'slot' && d.tab && d.slot.closest('.tsplit');
  if (splitRow) {
    // dropped among a split's parts: that order, left to right
    const order = $$('[data-tab], .drag-slot', splitRow).filter((el) => !el.classList.contains('drag-source'))
      .map((el) => (el === d.slot ? d.tab : tabById(Number(el.dataset.tab)))).filter(Boolean);
    arrange = { id: splitRow.dataset.split, order };
  } else if (how === 'slot' && d.folderId) {
    // the row or folder that will follow it
    let n = d.slot.nextElementSibling;
    while (n && n.classList.contains('drag-source')) n = n.nextElementSibling;
    folderMove = { zone: LIST_ZONES[zoneEl.id], before: n?.dataset.tab ? tabById(Number(n.dataset.tab)) : n?.classList.contains('tfolder') ? folderTabs(n.dataset.folder)[0] : null };
  } else if (how === 'slot' && zoneEl) {
    // the tab that will follow it decides the index; the folder it sits in decides the folder
    const order = $$('[data-tab], .drag-slot', zoneEl);
    const after = order.slice(order.indexOf(d.slot) + 1).find((el) => el.dataset.tab && !el.classList.contains('drag-source'));
    move = { zone: LIST_ZONES[zoneEl.id], index: after ? B.tabs.indexOf(tabById(Number(after.dataset.tab))) : B.tabs.length, folder: d.slot.closest('.tfolder')?.dataset.folder,
      // dropped back into its own split row it stays in the split; anywhere else it leaves it
      split: d.tab?.splitId && d.slot.closest(`.tsplit[data-split="${d.tab.splitId}"]`) ? d.tab.splitId : undefined };
  }
  setTimeout(() => window.removeEventListener('click', TD.eatClick, true));
  d.card.remove();
  d.slot.remove();
  showSplitDrop(null);
  d.source.classList.remove('drag-source');
  layoutEssentials();
  document.body.classList.remove('tab-dragging', 'card-dragging');
  if (d.incoming) sidebarLeave(500);
  $$('webview').forEach((w) => { w.style.pointerEvents = ''; });
  $$('#sidebar [style*="transform"]').forEach((el) => { el.style.transform = ''; el.style.transition = ''; });
  TD.drag = null;
  if (folderMove) moveFolder(d.folderId, folderMove.zone, folderMove.before);
  if (arrange) arrangeSplit(arrange.id, arrange.order);
  const tab = d.folderId ? null : tabById(d.id);
  if (tab && move) {
    tab.folderId = move.zone !== 'essential' ? move.folder : undefined;
    tab.splitId = move.split;
    moveTab(tab.id, move.index, move.zone);
  } else if (tab && how === 'folder') addTabToFolder(tab, d.target.id);
  else if (tab && how === 'split') splitWith(activeTab(), tab, d.target.side);
  else if (tab && how === 'bar') window.ultima.addBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon, parent: d.target.parent, index: d.target.index });
  if (TD.dirty || (!move && !folderMove && !arrange)) { TD.dirty = false; renderTabs(); }
}
