// Split view: 2–4 regular tabs side by side in the page area, as rounded panes with draggable dividers. The pane
// you're working in is the active tab (the address bar, back/forward and every command act on it); clicking another
// pane makes it the active one. In the sidebar a split shows as one row with a part per pane.
// Splitting animates: the page eases into its share while the new pane sweeps in, and the new divider flashes; in
// the sidebar the tabs glide together into the split row. Separating plays it the other way.
B.splits = []; // { id, sizes: [fractions, one per pane, in order] }
const SPLIT_MAX = 4;
const SPLIT_GAP = 6; // px between panes
const SPLIT_MIN = 0.15; // the smallest share a pane can be dragged down to
const splitById = (id) => B.splits.find((s) => s.id === id) || null;
const splitTabs = (id) => B.tabs.filter((t) => t.splitId === id);
const canSplit = (t) => t && t.zone === 'normal' && !isInternal(t.url);

function initSplits(saved) {
  B.splits = (Array.isArray(saved) ? saved : []).filter((s) => s && typeof s.id === 'string')
    .map((s) => ({ id: s.id, sizes: Array.isArray(s.sizes) ? s.sizes.map(Number) : [] }));
}

// Keeps splits sound: only regular tabs of one space showing a web page, side by side in the sidebar (where the
// first one is), in the same folder, 2 to 4 of them, with sizes that add up.
function normalizeSplits() {
  for (const t of B.tabs) {
    if (t.splitId && (!splitById(t.splitId) || !canSplit(t))) t.splitId = undefined;
  }
  for (const s of B.splits) {
    const tabs = splitTabs(s.id);
    for (const t of tabs.slice(SPLIT_MAX)) t.splitId = undefined;
    for (const t of tabs) if (t.spaceId !== tabs[0].spaceId) t.splitId = undefined;
  }
  const placed = new Set();
  const out = [];
  for (const t of B.tabs) {
    if (!t.splitId) out.push(t);
    else if (!placed.has(t.splitId)) { placed.add(t.splitId); out.push(...splitTabs(t.splitId)); }
  }
  B.tabs = out;
  for (const s of B.splits) {
    const tabs = splitTabs(s.id);
    if (tabs.length < 2) { for (const t of tabs) t.splitId = undefined; continue; }
    for (const t of tabs) t.folderId = tabs[0].folderId;
    if (s.sizes.length !== tabs.length || s.sizes.some((x) => !(x > 0))) s.sizes = tabs.map(() => 1 / tabs.length);
    const sum = s.sizes.reduce((a, b) => a + b, 0);
    s.sizes = s.sizes.map((x) => x / sum);
  }
  B.splits = B.splits.filter((s) => splitTabs(s.id).length >= 2);
}

// ---------- sidebar ----------
// Rows for a run of regular tabs, with each split drawn as one row of parts.
function tabRowsHtml(tabs) {
  const done = new Set();
  let html = '';
  for (const t of tabs) {
    if (!t.splitId) { html += tabRow(t); continue; }
    if (done.has(t.splitId)) continue;
    done.add(t.splitId);
    const parts = tabs.filter((x) => x.splitId === t.splitId);
    const on = parts.some((x) => x.id === B.activeId);
    html += `<div class="tsplit ${on ? 'active' : ''}" data-split="${t.splitId}" data-n="${parts.length}" title="Split view — right-click for options">
      ${parts.map((x) => tabRow(x).replace('class="tab ', 'class="tab split-part ')).join('<span class="tsplit-div"></span>')}</div>`;
  }
  return html;
}

// ---------- the page area ----------
// Where pane i of n sits, as CSS (it follows the window's size by itself).
function paneBox(sizes, i) {
  const n = sizes.length;
  const before = sizes.slice(0, i).reduce((a, b) => a + b, 0);
  return {
    left: `calc((100% - ${(n - 1) * SPLIT_GAP}px) * ${before.toFixed(5)} + ${i * SPLIT_GAP}px)`,
    width: `calc((100% - ${(n - 1) * SPLIT_GAP}px) * ${sizes[i].toFixed(5)})`,
  };
}

// Lays out what `tab` shows: its split's panes, or just itself. Panes go straight to their final size, so each page
// lays itself out once; the motion is drawn on top with transforms and clips (cheap for the GPU, nothing for the
// pages to redo). `anim.from` = Map(tab id -> where it was: { x, w } in px, or { enter: 'left' | 'right' }).
const SPLIT_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SPLIT_MS = 210;

function layoutPanes(tab, anim) {
  const vp = $('#viewport');
  const split = tab?.splitId && splitById(tab.splitId);
  const n = split ? splitTabs(split.id).length : 0;
  // while a divider is being dragged only positions change: keep its elements (the one held keeps the pointer)
  const frames = $$('.split-frame', vp);
  const handles = $$('.split-handle', vp);
  if (split && !anim && frames.length === n && handles.length === n - 1 && frames.every((f, i) => Number(f.dataset.pane) === splitTabs(split.id)[i].id)) {
    B.paneKey = paneKey(tab);
    splitTabs(split.id).forEach((t, i) => {
      const box = paneBox(split.sizes, i);
      Object.assign(t.webview.style, box);
      Object.assign(frames[i].style, box);
      frames[i].classList.toggle('on', t.id === B.activeId);
      if (i > 0) handles[i - 1].style.left = `calc(${box.left} - ${SPLIT_GAP}px)`;
    });
    return;
  }
  frames.forEach((x) => x.remove());
  handles.forEach((x) => x.remove());
  vp.classList.toggle('is-split', Boolean(split));
  B.paneKey = paneKey(tab);
  if (!split) {
    for (const t of B.tabs) if (t.webview) Object.assign(t.webview.style, { left: '', width: '', clipPath: '', transform: '', opacity: '', transition: '' });
    if (tab?.webview && anim?.from) animatePanes([tab], anim.from, vp, []);
    return;
  }
  const panes = splitTabs(split.id);
  panes.forEach((t, i) => {
    ensureWebview(t);
    const box = paneBox(split.sizes, i);
    Object.assign(t.webview.style, box, { clipPath: 'inset(0 round 10px)', transform: '', opacity: '' });
    t.webview.classList.remove('hidden');
    // a frame shows which pane is the one you're working in
    vp.append(h(`<div class="split-frame ${t.id === B.activeId ? 'on' : ''}" data-pane="${t.id}" style="left:${box.left};width:${box.width}">${paneControlsHtml(t, i, panes.length)}</div>`));
    if (i > 0) vp.append(h(`<div class="split-handle ${anim?.flash === i ? 'flash' : ''}" data-split-handle="${i}" style="left:calc(${box.left} - ${SPLIT_GAP}px)" title="Drag to resize"></div>`));
  });
  if (anim?.from) animatePanes(panes, anim.from, vp, $$('.split-frame', vp));
}

// Plays the move from where the panes were to where they are now. A new pane slides and fades in from its side,
// a pane that moved glides over, and a pane that grew is uncovered from the part it used to show.
function animatePanes(panes, from, vp, frames) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const area = vp.getBoundingClientRect();
  const finalClip = panes.length > 1 ? 'inset(0 round 10px)' : 'inset(0 round 0px)';
  const plans = panes.map((t, i) => {
    const f = from.get(t.id);
    if (!f) return null;
    const r = t.webview.getBoundingClientRect();
    const x = r.left - area.left;
    if (f.enter) {
      const dx = Math.min(140, r.width * 0.35) * (f.enter === 'left' ? -1 : 1);
      return { t, frame: frames[i], start: { transform: `translateX(${dx}px)`, opacity: '0' }, end: { transform: '', opacity: '' } };
    }
    if (f.w < r.width - 2) {
      // grew: show only what it showed before, then open up to the rest
      const left = Math.max(0, f.x - x);
      const right = Math.max(0, x + r.width - (f.x + f.w));
      return { t, frame: frames[i], start: { clipPath: `inset(0 ${right}px 0 ${left}px round 10px)` }, end: { clipPath: finalClip } };
    }
    const dx = f.x - x;
    return Math.abs(dx) > 1 ? { t, frame: frames[i], start: { transform: `translateX(${dx}px)` }, end: { transform: '' } } : null;
  }).filter(Boolean);
  if (!plans.length) return;
  for (const p of plans) {
    for (const el of [p.t.webview, p.frame].filter(Boolean)) {
      el.style.transition = 'none';
      Object.assign(el.style, el === p.frame ? { transform: p.start.transform || '', opacity: p.start.opacity || '' } : p.start);
    }
  }
  void vp.offsetWidth; // one style pass for every pane
  const transition = `transform ${SPLIT_MS}ms ${SPLIT_EASE}, opacity ${SPLIT_MS - 40}ms ease, clip-path ${SPLIT_MS}ms ${SPLIT_EASE}`;
  for (const p of plans) {
    for (const el of [p.t.webview, p.frame].filter(Boolean)) {
      el.style.transition = transition;
      Object.assign(el.style, el === p.frame ? { transform: '', opacity: '' } : p.end);
    }
  }
  clearTimeout(animatePanes.timer);
  animatePanes.timer = setTimeout(() => { for (const p of plans) for (const el of [p.t.webview, p.frame].filter(Boolean)) el.style.transition = ''; }, SPLIT_MS + 60);
}

// ---------- each pane's control box ----------
// A small pill at the top of the pane (shown while the pointer is near the top of that page, or over the pill):
// a grip to drag the pane to another place, nudges left/right, take it out of the split, close it.
const PANE = { hover: null, hideTimer: null, drag: null };

function paneControlsHtml(t, i, n) {
  const on = PANE.hover === t.id || PANE.drag === t.id;
  return `<div class="split-ctl ${on ? 'show' : ''} ${PANE.drag === t.id ? 'dragging' : ''}" data-ctl="${t.id}">
    <button class="split-ctl-btn grip" data-pane-act="grip" title="Drag to move this pane">${icon('grip', 14)}</button>
    <button class="split-ctl-btn" data-pane-act="left" title="${esc(withKey('Move left', 'split-move-left'))}" ${i === 0 ? 'disabled' : ''}>${icon('back', 14)}</button>
    <button class="split-ctl-btn" data-pane-act="right" title="${esc(withKey('Move right', 'split-move-right'))}" ${i === n - 1 ? 'disabled' : ''}>${icon('forward', 14)}</button>
    <span class="split-ctl-sep"></span>
    <button class="split-ctl-btn" data-pane-act="out" title="Take out of split view">${icon('unsplit', 14)}</button>
    <button class="split-ctl-btn" data-pane-act="close" title="${esc(withKey('Close tab', 'close-tab'))}">${icon('close', 14)}</button>
  </div>`;
}

// From the page: the pointer came near its top edge, or left it. Hiding waits a moment, so the pill can be reached.
function setPaneHover(tab, on) {
  if (on) {
    clearTimeout(PANE.hideTimer);
    PANE.hover = tab.id;
    $$('.split-ctl').forEach((c) => c.classList.toggle('show', Number(c.dataset.ctl) === tab.id || Number(c.dataset.ctl) === PANE.drag));
  } else if (PANE.hover === tab.id) {
    clearTimeout(PANE.hideTimer);
    PANE.hideTimer = setTimeout(() => {
      if ($(`.split-ctl[data-ctl="${tab.id}"]:hover`)) return; // the pointer moved onto the pill itself
      PANE.hover = null;
      $$('.split-ctl').forEach((c) => c.classList.toggle('show', Number(c.dataset.ctl) === PANE.drag));
    }, 700);
  }
}

// Puts a split's tabs in `ordered` order (a tab not in it yet joins it), animating the panes into their new places.
function arrangeSplit(splitId, ordered) {
  const split = splitById(splitId);
  const old = splitTabs(splitId);
  if (!split || ordered.length < 2 || ordered.length > SPLIT_MAX) return;
  const showing = old.some((t) => t.id === B.activeId);
  const from = showing ? paneRects(old) : new Map();
  const before = sidebarRects([...old, ...ordered]);
  const widths = new Map(old.map((t, i) => [t.id, split.sizes[i]]));
  // where the split sits in the sidebar: after the last tab before it that isn't moving
  let prev = B.tabs.indexOf(old[0]) - 1;
  while (prev >= 0 && ordered.includes(B.tabs[prev])) prev -= 1;
  const anchor = prev >= 0 ? B.tabs[prev] : null;
  for (const t of ordered) {
    if (t.splitId === splitId) continue;
    if (t.spaceId !== old[0].spaceId) moveTabToSpace(t, old[0].spaceId);
    applyZone(t, 'normal');
    t.splitId = splitId;
    if (showing) from.set(t.id, { enter: ordered.indexOf(t) === 0 ? 'left' : 'right' });
  }
  B.tabs = B.tabs.filter((t) => !ordered.includes(t));
  B.tabs.splice(anchor ? B.tabs.indexOf(anchor) + 1 : 0, 0, ...ordered);
  const joined = ordered.find((t) => !old.includes(t));
  // a rearranged pane keeps its width; when a tab joins, every pane gets the same share (as when splitting)
  split.sizes = joined ? ordered.map(() => 1 / ordered.length) : ordered.map((t) => widths.get(t.id));
  if (showing && joined) B.activeId = joined.id;
  renderTabs();
  glideSidebar(before);
  if (showing) showSplit(activeTab(), { from, flash: joined ? ordered.indexOf(joined) || 1 : undefined });
  saveSession();
}

// One place left (-1) or right (+1).
function movePane(tab, dir) {
  if (!tab?.splitId) return;
  const order = splitTabs(tab.splitId);
  const i = order.indexOf(tab);
  const j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  arrangeSplit(tab.splitId, order);
}

// Dragging a pane by its grip: as the pointer passes the middle of a neighbor, they trade places (animated).
function startPaneDrag(tab, e) {
  const vp = $('#viewport');
  PANE.drag = tab.id;
  $$('webview').forEach((w) => { w.style.pointerEvents = 'none'; });
  document.body.classList.add('pane-dragging');
  $(`.split-ctl[data-ctl="${tab.id}"]`)?.classList.add('dragging', 'show');
  $(`.split-frame[data-pane="${tab.id}"]`)?.classList.add('lifted');
  const move = (ev) => {
    const order = splitTabs(tab.splitId);
    if (!order.includes(tab)) return;
    const area = vp.getBoundingClientRect();
    const sizes = splitById(tab.splitId).sizes;
    const usable = area.width - (order.length - 1) * SPLIT_GAP;
    // how many of the other panes have their middle left of the pointer
    let edge = area.left;
    let place = 0;
    order.forEach((t, i) => {
      const w = usable * sizes[i];
      if (t !== tab && edge + w / 2 < ev.clientX) place += 1;
      edge += w + SPLIT_GAP;
    });
    if (place !== order.indexOf(tab)) {
      const next = order.filter((t) => t !== tab);
      next.splice(place, 0, tab);
      arrangeSplit(tab.splitId, next);
      $(`.split-frame[data-pane="${tab.id}"]`)?.classList.add('lifted');
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    PANE.drag = null;
    $$('webview').forEach((w) => { w.style.pointerEvents = ''; });
    document.body.classList.remove('pane-dragging');
    $$('.split-ctl.dragging').forEach((c) => c.classList.remove('dragging'));
    $$('.split-frame.lifted').forEach((f) => f.classList.remove('lifted'));
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
}

// Where the visible panes are right now, in px from the page area's left edge.
function paneRects(tabs) {
  const area = $('#viewport').getBoundingClientRect();
  const out = new Map();
  for (const t of tabs) {
    if (!t.webview || t.webview.classList.contains('hidden')) continue;
    const r = t.webview.getBoundingClientRect();
    if (r.width) out.set(t.id, { x: r.left - area.left, w: r.width });
  }
  return out;
}

// What the page area should be showing for `tab`: its panes and their sizes.
function paneKey(tab) {
  if (!tab || isInternal(tab.url)) return '';
  const split = tab.splitId && splitById(tab.splitId);
  return split ? `${splitTabs(split.id).map((t) => t.id).join(',')}|${split.sizes.map((x) => x.toFixed(4)).join(',')}` : String(tab.id);
}

// After the tabs change (a pane closed, a tab left its split…), the page area catches up.
function syncPanes() {
  const tab = activeTab();
  if (!tab || isInternal(tab.url) || paneKey(tab) === B.paneKey) return;
  const shown = tab.splitId ? splitTabs(tab.splitId) : [tab];
  for (const t of B.tabs) t.webview?.classList.toggle('hidden', !shown.includes(t));
  layoutPanes(tab);
}

// Clicking into another pane makes it the active tab, without redrawing the panes.
function focusPane(tab) {
  if (!tab?.splitId || B.activeId === tab.id || splitTabs(tab.splitId).every((t) => t.id !== B.activeId)) return;
  B.activeId = tab.id;
  tab.lastActive = Date.now();
  notifyActiveTab(tab);
  $$('.split-frame').forEach((f) => f.classList.toggle('on', Number(f.dataset.pane) === tab.id));
  renderTabs();
  updateChrome();
  saveSession();
}

// ---------- splitting and separating ----------
// Puts `tab` in a split with `base` (the one showing), on `side` ('left' | 'right'), or adds it to base's split.
function splitWith(base, tab, side = 'right') {
  if (!canSplit(base) || !canSplit(tab) || base === tab) return toast('Split view works with web pages in regular tabs');
  const existing = base.splitId && splitById(base.splitId);
  if (existing && splitTabs(existing.id).length >= SPLIT_MAX) return toast(`Split view holds up to ${SPLIT_MAX} tabs`);
  const before = sidebarRects([base, tab, ...(existing ? splitTabs(existing.id) : [])]);
  // where the panes were: the split as it was, or the page filling the whole area; the new one comes in from its side
  const from = paneRects(existing ? splitTabs(existing.id) : [base]);
  let split = existing;
  if (!split) {
    split = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sizes: [] };
    B.splits.push(split);
  }
  from.set(tab.id, { enter: side });
  // the new pane goes at that end; its tab moves next to the split in the sidebar
  if (tab.splitId && tab.splitId !== split.id) tab.splitId = undefined;
  if (tab.spaceId !== base.spaceId) moveTabToSpace(tab, base.spaceId);
  base.splitId = split.id;
  B.tabs.splice(B.tabs.indexOf(tab), 1);
  const group = splitTabs(split.id);
  B.tabs.splice(side === 'left' ? B.tabs.indexOf(group[0]) : B.tabs.indexOf(group[group.length - 1]) + 1, 0, tab);
  tab.splitId = split.id;
  const n = splitTabs(split.id).length;
  split.sizes = Array.from({ length: n }, () => 1 / n);
  B.activeId = tab.id;
  tab.lastActive = Date.now();
  renderTabs();
  glideSidebar(before);
  showSplit(tab, { from, flash: side === 'left' ? 1 : n - 1 });
  saveSession();
  return split;
}

// Takes `tab` out of its split (the last two: the split ends). The active pane grows back to fill the page.
function unsplitTab(tab) {
  if (!tab?.splitId) return;
  const split = splitById(tab.splitId);
  const panes = splitTabs(split.id);
  const keep = panes.length > 2 ? panes.filter((t) => t !== tab) : [];
  const focus = tab.id === B.activeId ? (keep.length ? keep[0] : panes.find((t) => t !== tab)) : tabById(B.activeId);
  const from = paneRects(panes);
  const before = sidebarRects(panes);
  if (keep.length) { tab.splitId = undefined; split.sizes = keep.map(() => 1 / keep.length); }
  else for (const t of panes) t.splitId = undefined;
  // a tab leaving the split goes just after it in the sidebar
  if (keep.length) { B.tabs.splice(B.tabs.indexOf(tab), 1); B.tabs.splice(B.tabs.indexOf(keep[keep.length - 1]) + 1, 0, tab); }
  B.activeId = focus.id;
  renderTabs();
  glideSidebar(before);
  showSplit(focus, { from });
  updateChrome();
  saveSession();
}

// Ends a split: every tab goes back to its own row, and the pane you were in grows to fill the page.
function separateSplit(splitId) {
  const split = splitById(splitId);
  const panes = splitTabs(splitId);
  if (!split || !panes.length) return;
  const focus = panes.find((t) => t.id === B.activeId) || panes[0];
  const from = paneRects(panes);
  const before = sidebarRects(panes);
  for (const t of panes) t.splitId = undefined;
  B.activeId = focus.id;
  renderTabs();
  glideSidebar(before);
  showSplit(focus, { from });
  saveSession();
}

function swapSplit(splitId) {
  const panes = splitTabs(splitId);
  const split = splitById(splitId);
  const from = paneRects(panes);
  const reversed = [...panes].reverse();
  const at = B.tabs.indexOf(panes[0]);
  B.tabs = B.tabs.filter((t) => !panes.includes(t));
  B.tabs.splice(at, 0, ...reversed);
  split.sizes = [...split.sizes].reverse();
  renderTabs();
  showSplit(tabById(B.activeId), { from });
  saveSession();
}

// Shows `tab` (and its panes) with an animation; the page area's other bits (internal pages) are hidden.
function showSplit(tab, anim) {
  for (const t of B.tabs) t.webview?.classList.toggle('hidden', !((t.splitId && t.splitId === tab.splitId) || t === tab));
  $('#internal').hidden = true;
  $('#internal').innerHTML = '';
  layoutPanes(tab, anim);
  notifyActiveTab(tab);
  updateChrome();
  setTimeout(() => tab.webview?.focus(), 0);
}

// "Split view": the active tab with the regular tab you used last (that isn't in a split with it).
function splitActive() {
  const tab = activeTab();
  if (!canSplit(tab)) return toast('Open a web page to split its tab');
  const other = spaceTabs().filter((t) => t !== tab && canSplit(t) && (!tab.splitId || t.splitId !== tab.splitId))
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
  if (!other) return toast('Open another web page to split this tab with');
  return splitWith(tab, other, 'right');
}

function focusNextPane(dir = 1) {
  const tab = activeTab();
  if (!tab?.splitId) return;
  const panes = splitTabs(tab.splitId);
  focusPane(panes[(panes.indexOf(tab) + dir + panes.length) % panes.length]);
  activeTab().webview?.focus();
}

// ---------- the sidebar animation: tabs glide from their rows into the split row (FLIP) ----------
function sidebarRects(tabs) {
  return new Map(tabs.map((t) => [t.id, $(`#sidebar [data-tab="${t.id}"]`)?.getBoundingClientRect()]).filter(([, r]) => r));
}

function glideSidebar(before) {
  for (const [id, a] of before) {
    const el = $(`#sidebar [data-tab="${id}"]`);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    if (!b.width) continue;
    el.style.transition = 'none';
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    void el.offsetWidth;
    el.style.transition = `transform ${SPLIT_MS + 30}ms ${SPLIT_EASE}`;
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; el.style.transformOrigin = ''; }, SPLIT_MS + 80);
  }
  $$('#sidebar .tsplit').forEach((s) => { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); });
}

// ---------- menus ----------
async function splitMenu(splitId, pos) {
  const panes = splitTabs(splitId);
  const choice = await showMenu([
    { id: 'swap', label: panes.length === 2 ? 'Swap sides' : 'Reverse order', icon: 'duplicate' },
    { id: 'even', label: 'Make panes the same size', icon: 'layers' },
    { type: 'separator' },
    { id: 'separate', label: 'Separate tabs', icon: 'sidebar', shortcut: 'unsplit-tab' },
    { id: 'close', label: `Close split (${panes.length} tabs)`, icon: 'close', danger: true },
  ], pos);
  if (choice === 'swap') swapSplit(splitId);
  else if (choice === 'even') { const s = splitById(splitId); s.sizes = panes.map(() => 1 / panes.length); showSplit(activeTab(), null); saveSession(); }
  else if (choice === 'separate') separateSplit(splitId);
  else if (choice === 'close') for (const t of panes) closeTab(t.id);
}

function tabSplitMenuItems(tab) {
  const cur = activeTab();
  const items = [];
  if (tab.splitId) items.push({ id: 'split-leave', icon: 'sidebar', label: 'Remove from split view', shortcut: tab === cur ? 'unsplit-tab' : undefined });
  else if (canSplit(tab) && canSplit(cur) && tab !== cur) items.push({ id: 'split-with', icon: 'split', label: cur.splitId ? 'Add to split view' : 'Split with current tab' });
  return items;
}

function runTabSplitChoice(tab, choice) {
  if (choice === 'split-with') splitWith(activeTab(), tab, 'right');
  else if (choice === 'split-leave') unsplitTab(tab);
  else return false;
  return true;
}

// ---------- dividers ----------
function initSplitView() {
  const vp = $('#viewport');
  vp.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-split-handle]');
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    const tab = activeTab();
    const split = splitById(tab?.splitId);
    if (!split) return;
    const i = Number(handle.dataset.splitHandle);
    const rect = vp.getBoundingClientRect();
    const usable = rect.width - (split.sizes.length - 1) * SPLIT_GAP;
    const start = split.sizes.slice(0, i - 1).reduce((a, b) => a + b, 0); // where the left pane begins
    const pair = split.sizes[i - 1] + split.sizes[i];
    $$('webview').forEach((w) => { w.style.pointerEvents = 'none'; });
    document.body.classList.add('split-resizing');
    // followed at the window (the pages ignore the pointer meanwhile), so it can't slip off the thin divider
    // at most one layout per frame, however fast the pointer reports
    let pending = null;
    const apply = () => {
      if (pending === null) return; // already applied on release
      const x = (pending - rect.left - (i - 0.5) * SPLIT_GAP) / usable - start;
      pending = null;
      const left = Math.max(SPLIT_MIN, Math.min(pair - SPLIT_MIN, x));
      split.sizes[i - 1] = left;
      split.sizes[i] = pair - left;
      layoutPanes(tab);
    };
    const move = (ev) => {
      if (pending === null) requestAnimationFrame(apply);
      pending = ev.clientX;
    };
    const up = () => {
      if (pending !== null) apply();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      $$('webview').forEach((w) => { w.style.pointerEvents = ''; });
      document.body.classList.remove('split-resizing');
      saveSession();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  });
  // the panes' control boxes
  vp.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-pane-act="grip"]');
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    startPaneDrag(tabById(Number(grip.closest('[data-ctl]').dataset.ctl)), e);
  });
  vp.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pane-act]');
    if (!b) return;
    const tab = tabById(Number(b.closest('[data-ctl]').dataset.ctl));
    const act = b.dataset.paneAct;
    if (act === 'left') movePane(tab, -1);
    else if (act === 'right') movePane(tab, 1);
    else if (act === 'out') unsplitTab(tab);
    else if (act === 'close') closeTab(tab.id);
  });
  vp.addEventListener('mouseleave', (e) => {
    const ctl = e.target.closest?.('.split-ctl');
    if (ctl && PANE.hover === Number(ctl.dataset.ctl)) setPaneHover(tabById(PANE.hover), false);
  }, true);
  // double-click a divider: back to equal sizes
  vp.addEventListener('dblclick', (e) => {
    if (!e.target.closest('[data-split-handle]')) return;
    const split = splitById(activeTab()?.splitId);
    if (split) { split.sizes = split.sizes.map(() => 1 / split.sizes.length); layoutPanes(activeTab()); saveSession(); }
  });
  $('#tabs').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tsplit');
    if (!row || e.target.closest('[data-tab]')) return;
    e.preventDefault();
    splitMenu(row.dataset.split, { x: e.clientX, y: e.clientY });
  });
}
