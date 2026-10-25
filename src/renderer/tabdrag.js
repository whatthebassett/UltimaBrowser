// Dragging tabs like cards: the tab lifts off the sidebar as a card that follows the pointer (tilting with its
// movement), the other tabs slide aside to open a gap where it will land, and on release it settles into the gap.
// It can land among regular or pinned tabs, in Essentials, in a folder (in its gap, or on its header), or on the
// bookmarks bar (which bookmarks it). Esc (rebindable) or dropping anywhere else sends it back.
// A folder drags the same way by its header: the whole folder is the card, and it lands among the regular tabs.
const TD = { press: null, drag: null, dirty: false };
const CARD_START = 5; // pixels the pointer moves before a press becomes a drag
const LIST_ZONES = { essentials: 'essential', 'pinned-list': 'pinned', tabs: 'normal' };

function initTabCardDrag() {
  const side = $('#sidebar');
  side.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || TD.drag) return;
    const head = e.target.closest('.tfolder-head');
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
    vx: 0, tilt: 0, t0: performance.now(), target: { kind: 'list' },
  };
  document.body.classList.add('tab-dragging', 'card-dragging');
  $$('webview').forEach((w) => { w.style.pointerEvents = 'none'; }); // the page mustn't swallow the pointer
  try { document.body.setPointerCapture(p.pointerId); } catch { /* released already */ }
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
  if (!d.hitQueued) {
    d.hitQueued = true;
    requestAnimationFrame(() => { d.hitQueued = false; if (TD.drag === d) aimCard(); });
  }
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

// Near the top or bottom of the tab list, the list scrolls.
function autoScrollTabs(d) {
  const list = $('#tabs');
  const r = list.getBoundingClientRect();
  const side = $('#sidebar').getBoundingClientRect();
  if (d.x < side.left || d.x > side.right) return;
  const edge = 36;
  const speed = d.y < r.top + edge ? -(r.top + edge - d.y) / 3 : d.y > r.bottom - edge ? (d.y - (r.bottom - edge)) / 3 : 0;
  if (speed && d.y > r.top - 40 && d.y < r.bottom + 40) list.scrollTop += Math.max(-14, Math.min(14, speed));
}

// Works out where the card would land and opens the gap (or marks the folder / bookmark spot) there.
function aimCard() {
  const d = TD.drag;
  const at = document.elementFromPoint(d.x, d.y);
  clearCardMarks();
  if (d.folderId) { aimFolderCard(d, at); return; }
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
  // onto the middle of a folder's header: into the folder
  const head = at.closest('[data-folder-head]');
  if (head && d.tab.zone !== 'essential') {
    const r = head.getBoundingClientRect();
    if (d.y > r.top + r.height * 0.25 && d.y < r.bottom - r.height * 0.25) {
      head.classList.add('drop-into');
      d.target = { kind: 'folder', id: head.dataset.folderHead };
      moveSlot(d.home.parent, d.home.next);
      return;
    }
  }
  const zone = at.closest('#essentials, #pinned-list, #tabs');
  if (!zone) return; // between zones: keep the last gap
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
  // A row just below the gap is judged where it was before the gap pushed it down, so the gap can't sit in its way.
  const inRow = d.slot.parentElement.classList.contains('tsplit') ? d.slot.parentElement : null;
  const gapH = inRow ? 0 : d.slot.offsetHeight + 2;
  const band = (el) => {
    const r = restingRect(el);
    const pushed = gapH && (d.slot.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ? gapH : 0;
    const extra = el === inRow ? 38 : 0;
    return d.y >= r.top - pushed - (extra && 6) && d.y <= r.bottom - pushed + extra;
  };
  const row = canSplit(d.tab) && $$('.tsplit', zone).find(band);
  if (row && (row.dataset.split === d.tab.splitId || splitTabs(row.dataset.split).length < SPLIT_MAX)) {
    const parts = $$('.tab[data-tab]:not(.drag-source)', row);
    const after = parts.find((p) => { const r = restingRect(p); return r.left + r.width / 2 > d.x; });
    moveSlot(row, after || null);
    return;
  }
  // a list: before the first row (or folder header, or split view) whose middle is below the pointer
  const items = [...new Set($$('.tab[data-tab]:not(.drag-source), .tfolder-head', zone).map((el) => el.closest('.tsplit') || el))];
  const next = items.find((el) => { const r = restingRect(el); return r.top + r.height / 2 > d.y; });
  if (!next) moveSlot(zone, null);
  else if (next.classList.contains('tfolder-head')) moveSlot(next.parentElement.parentElement, next.parentElement); // just before the folder
  else if (next.classList.contains('tsplit')) moveSlot(next.parentElement, next); // a split view is one block
  else moveSlot(next.parentElement, next); // a tab inside a folder takes the gap into the folder
}

// Where an element sits in the layout, leaving out the slide it may be in the middle of (or the gap would flicker).
function restingRect(el) {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return { left: r.left - m.m41, right: r.right - m.m41, top: r.top - m.m42, bottom: r.bottom - m.m42, width: r.width, height: r.height };
}

// A folder lands among the regular tabs, between rows and other folders (never inside one): before the first row,
// or folder header, whose middle is below the pointer.
function aimFolderCard(d, at) {
  const zone = at?.closest('#tabs');
  // anywhere but the regular tabs (Essentials, pinned, the page…): it would go back where it was
  if (!zone) { d.target = { kind: 'none' }; moveSlot(d.home.parent, d.home.next); return; }
  d.target = { kind: 'list' };
  const items = [...zone.children].filter((el) => !el.classList.contains('drag-source') && !el.classList.contains('drag-slot'));
  const next = items.find((el) => { const r = restingRect(el.classList.contains('tfolder') ? el.querySelector('.tfolder-head') : el); return r.top + r.height / 2 > d.y; });
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

function clearCardMarks() {
  if (TD.drag?.target?.kind !== 'split') showSplitDrop(null);
  $$('.drop-before, .drop-after, .drop-into, .drop-target').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-target'));
}

// Moves the gap, sliding everything that shifts (FLIP: measure, move, then animate from the old spot).
function moveSlot(parent, next) {
  const slot = TD.drag.slot;
  if (slot.parentElement === parent && slot.nextElementSibling === (next || null)) return;
  const els = $$('#sidebar .tab[data-tab]:not(.drag-source), #sidebar .pin[data-tab]:not(.drag-source), #sidebar .tfolder-head, #sidebar .drag-slot');
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  if (next) parent.insertBefore(slot, next); else parent.append(slot);
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
  if (d.target.kind === 'list' && d.slot.closest('#essentials, #pinned-list, #tabs')) settleCard('slot');
  else if (d.target.kind === 'folder' || d.target.kind === 'bar' || d.target.kind === 'split') settleCard(d.target.kind);
  else settleCard('back');
}

// Ends the drag: the card glides into its gap (or back home, or into the folder/bar and fades), then the move happens.
function settleCard(how) {
  const d = TD.drag;
  if (!d || d.settling) return;
  d.settling = true;
  if (how === 'back') moveSlot(d.home.parent, d.home.next);
  const where = how === 'folder' ? $(`[data-folder-head="${d.target.id}"]`) : how === 'bar' ? $('#bookmark-bar') : how === 'split' ? $('#viewport .split-drop') : d.slot;
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
    folderMove = { before: n?.dataset.tab ? tabById(Number(n.dataset.tab)) : n?.classList.contains('tfolder') ? folderTabs(n.dataset.folder)[0] : null };
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
  $$('webview').forEach((w) => { w.style.pointerEvents = ''; });
  $$('#sidebar [style*="transform"]').forEach((el) => { el.style.transform = ''; el.style.transition = ''; });
  TD.drag = null;
  if (folderMove) placeFolderBefore(d.folderId, folderMove.before);
  if (arrange) arrangeSplit(arrange.id, arrange.order);
  const tab = d.folderId ? null : tabById(d.id);
  if (tab && move) {
    tab.folderId = move.zone === 'normal' ? move.folder : undefined;
    tab.splitId = move.split;
    moveTab(tab.id, move.index, move.zone);
  } else if (tab && how === 'folder') addTabToFolder(tab, d.target.id);
  else if (tab && how === 'split') splitWith(activeTab(), tab, d.target.side);
  else if (tab && how === 'bar') window.ultima.addBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon, parent: d.target.parent, index: d.target.index });
  if (TD.dirty || (!move && !folderMove && !arrange)) { TD.dirty = false; renderTabs(); }
}
