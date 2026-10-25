// The sidebar's buttons: which ones, in which order, at the top (beside the logo) or the bottom.
// Edited in Settings → Sidebar by dragging, or by right-clicking a button in the sidebar itself.
const SIDEBAR_BUTTONS = {
  back: { icon: 'back', cmd: 'back', label: 'Back' },
  forward: { icon: 'forward', cmd: 'forward', label: 'Forward' },
  reload: { icon: 'reload', cmd: 'reload', label: 'Reload' },
  home: { icon: 'home', cmd: 'home', label: 'New tab page' },
  'new-tab': { icon: 'plus', cmd: 'new-tab', label: 'New tab' },
  palette: { icon: 'command', cmd: 'palette', label: 'Control Palette' },
  'url-menu': { icon: 'more', cmd: 'url-menu', label: 'Address bar menu' },
  bookmarks: { icon: 'bookmark', cmd: 'open-bookmarks', label: 'Bookmarks' },
  'bookmarks-bar': { icon: 'star', cmd: 'toggle-bookmarks-bar', label: 'Show / hide bookmarks bar' },
  'tab-folder': { icon: 'folder', cmd: 'tab-folder-new', label: 'Add tab to a new folder' },
  split: { icon: 'split', cmd: 'split-tab', label: 'Split view' },
  'bookmark-page': { icon: 'star', cmd: 'bookmark', label: 'Bookmark this page' },
  history: { icon: 'history', cmd: 'open-history', label: 'History' },
  'tab-history': { icon: 'tabHistory', cmd: 'tab-history', label: 'Tab History' },
  downloads: { icon: 'download', cmd: 'open-downloads', label: 'Downloads' },
  extensions: { icon: 'puzzle', cmd: 'open-extensions', label: 'Extensions' },
  passwords: { icon: 'key', cmd: 'open-passwords', label: 'Passwords' },
  import: { icon: 'import', cmd: 'open-import', label: 'Import browser data' },
  find: { icon: 'find', cmd: 'find', label: 'Find in page' },
  'copy-url': { icon: 'copy', cmd: 'copy-url', label: 'Copy page address' },
  print: { icon: 'print', cmd: 'print', label: 'Print' },
  'zoom-in': { icon: 'zoomIn', cmd: 'zoom-in', label: 'Zoom in' },
  'zoom-out': { icon: 'zoomOut', cmd: 'zoom-out', label: 'Zoom out' },
  'new-space': { icon: 'layers', cmd: 'new-space', label: 'New space' },
  'space-theme': { icon: 'palette', cmd: 'space-theme', label: 'Edit space theme' },
  devtools: { icon: 'code', cmd: 'devtools', label: 'Developer tools' },
  'clear-data': { icon: 'eraser', cmd: 'clear-data', label: 'Clear browsing data' },
  shortcuts: { icon: 'keyboard', cmd: 'open-shortcuts', label: 'Keyboard shortcuts' },
  'hide-sidebar': { icon: 'sidebar', cmd: 'toggle-sidebar-hidden', label: 'Hide sidebar' },
  settings: { icon: 'settings', cmd: 'open-settings', label: 'Settings' },
};
const SIDEBAR_DEFAULT = { head: ['back', 'forward', 'reload'], foot: ['palette', 'bookmarks', 'history', 'tab-history', 'downloads', 'import', 'settings'] };
const SIDEBAR_HEAD_MAX = 5; // beside the logo there's only room for a few
// buttons that were in the page before this was customizable keep their ids (other code looks them up)
const SIDEBAR_BUILT_IN = new Set(['back', 'forward', 'reload', 'palette', 'bookmarks', 'history', 'downloads', 'import', 'settings']);
const sidebarButtonId = (key) => (SIDEBAR_BUILT_IN.has(key) ? `btn-${key}` : `sbb-${key}`);

// the saved layout, cleaned up: known buttons only, each once, the top no fuller than it can be
function sidebarLayout() {
  const saved = B.settings.sidebarButtons;
  const seen = new Set();
  const clean = (list, max) => (Array.isArray(list) ? list : []).filter((k) => SIDEBAR_BUTTONS[k] && !seen.has(k) && seen.add(k)).slice(0, max);
  if (!saved || typeof saved !== 'object') return { head: [...SIDEBAR_DEFAULT.head], foot: [...SIDEBAR_DEFAULT.foot] };
  const head = clean(saved.head, SIDEBAR_HEAD_MAX);
  return { head, foot: clean(saved.foot, Infinity) };
}

// Every button exists once; the ones not in use wait in a hidden pool, so code that updates them always finds them.
function initSidebarButtons() {
  const pool = $('#sb-pool');
  for (const [key, b] of Object.entries(SIDEBAR_BUTTONS)) {
    let el = document.getElementById(sidebarButtonId(key));
    if (!el) {
      el = h(`<button class="icon-btn" id="${sidebarButtonId(key)}"></button>`);
      pool.append(el);
    }
    el.dataset.sbb = key;
    el.dataset.cmd = b.cmd;
    el.dataset.label = b.label;
    el.insertAdjacentHTML('afterbegin', icon(b.icon, 16));
    el.addEventListener('click', () => {
      if (key === 'reload' && activeTab()?.loading) return activeTab().webview?.stop();
      return runCommand(b.cmd);
    });
  }
  renderSidebarButtons();
}

function renderSidebarButtons() {
  const layout = sidebarLayout();
  const nav = $('.sb-head .nav');
  const spacer = $('.sb-foot .spacer');
  const pool = $('#sb-pool');
  const used = new Set([...layout.head, ...layout.foot]);
  for (const key of layout.head) nav.append(document.getElementById(sidebarButtonId(key)));
  for (const key of layout.foot) spacer.before(document.getElementById(sidebarButtonId(key)));
  for (const key of Object.keys(SIDEBAR_BUTTONS)) if (!used.has(key)) pool.append(document.getElementById(sidebarButtonId(key)));
}

function setSidebarLayout(layout) {
  applySettings({ sidebarButtons: { head: [...layout.head], foot: [...layout.foot] } });
  renderSidebarButtons();
  updateChrome();
  for (const ed of $$('.sbe')) renderSidebarEditor(ed);
}

// Moves a button to `zone` at `index` (or adds it there); a full top row sends it to the bottom instead.
function placeSidebarButton(key, zone, index = Infinity) {
  const layout = sidebarLayout();
  const from = layout.head.includes(key) ? 'head' : layout.foot.includes(key) ? 'foot' : null;
  if (from) {
    const at = layout[from].indexOf(key);
    layout[from].splice(at, 1);
    if (from === zone && at < index) index -= 1;
  }
  if (zone === 'head' && layout.head.length >= SIDEBAR_HEAD_MAX) {
    toast(`The top of the sidebar holds ${SIDEBAR_HEAD_MAX} buttons`);
    return;
  }
  layout[zone].splice(Math.max(0, Math.min(index, layout[zone].length)), 0, key);
  setSidebarLayout(layout);
}

function removeSidebarButton(key) {
  const layout = sidebarLayout();
  setSidebarLayout({ head: layout.head.filter((k) => k !== key), foot: layout.foot.filter((k) => k !== key) });
}

async function sidebarButtonMenu(key, pos) {
  const layout = sidebarLayout();
  const zone = layout.head.includes(key) ? 'head' : 'foot';
  const list = layout[zone];
  const i = list.indexOf(key);
  const choice = await showMenu([
    { id: 'left', label: 'Move left', icon: 'back', enabled: i > 0 },
    { id: 'right', label: 'Move right', icon: 'forward', enabled: i < list.length - 1 },
    { id: 'other', label: zone === 'head' ? 'Move to the bottom' : 'Move to the top', icon: zone === 'head' ? 'arrowDown' : 'arrowUp', enabled: zone === 'head' || layout.head.length < SIDEBAR_HEAD_MAX },
    { type: 'separator' },
    { id: 'remove', label: 'Remove from sidebar', icon: 'minus' },
  ], pos);
  if (choice === 'left') placeSidebarButton(key, zone, i - 1);
  else if (choice === 'right') placeSidebarButton(key, zone, i + 2);
  else if (choice === 'other') placeSidebarButton(key, zone === 'head' ? 'foot' : 'head');
  else if (choice === 'remove') removeSidebarButton(key);
}

// ---------- Settings → Sidebar ----------
function pageSidebarButtons(el) {
  el.innerHTML = '<div class="sbe"></div>';
  const ed = $('.sbe', el);
  renderSidebarEditor(ed);
  let dragKey = null;

  const chip = (e) => e.target.closest('.sbe-chip[data-key]');
  ed.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { removeSidebarButton(rm.dataset.remove); return; }
    const add = e.target.closest('[data-add]');
    if (add) placeSidebarButton(add.dataset.add, 'foot');
    else if (e.target.closest('[data-sbe-reset]')) setSidebarLayout(SIDEBAR_DEFAULT);
  });
  ed.addEventListener('contextmenu', (e) => {
    const c = chip(e);
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    sidebarButtonMenu(c.dataset.key, { x: e.clientX, y: e.clientY });
  });

  // drag a button to reorder it, move it between top and bottom, or drop it on the library to remove it
  ed.addEventListener('dragstart', (e) => {
    const src = e.target.closest('[data-key], [data-add]');
    if (!src) return;
    dragKey = src.dataset.key || src.dataset.add;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragKey);
    src.classList.add('dragging');
  });
  ed.addEventListener('dragend', () => { dragKey = null; clearMarks(); $$('.dragging', ed).forEach((x) => x.classList.remove('dragging')); });
  const clearMarks = () => $$('.drop-before, .drop-after, .drop-into', ed).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
  // where in a row the pointer is: before which chip
  const dropPoint = (slots, x) => {
    const chips = $$('.sbe-chip[data-key]', slots).filter((c) => c.dataset.key !== dragKey);
    const i = chips.findIndex((c) => { const r = c.getBoundingClientRect(); return x < r.left + r.width / 2; });
    return { chips, index: i < 0 ? chips.length : i };
  };
  ed.addEventListener('dragover', (e) => {
    if (!dragKey) return;
    const slots = e.target.closest('.sbe-slots');
    const library = e.target.closest('.sbe-library');
    if (!slots && !library) return;
    e.preventDefault();
    clearMarks();
    if (library) { if (!library.querySelector(`[data-add="${dragKey}"]`)) library.classList.add('drop-into'); return; }
    const { chips, index } = dropPoint(slots, e.clientX);
    if (!chips.length) slots.classList.add('drop-into');
    else if (index < chips.length) chips[index].classList.add('drop-before');
    else chips[chips.length - 1].classList.add('drop-after');
  });
  ed.addEventListener('dragleave', (e) => { if (!ed.contains(e.relatedTarget)) clearMarks(); });
  ed.addEventListener('drop', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    const key = dragKey;
    const slots = e.target.closest('.sbe-slots');
    clearMarks();
    if (e.target.closest('.sbe-library')) { removeSidebarButton(key); return; }
    if (!slots) return;
    // index among the row's chips as they are now (placeSidebarButton allows for the chip leaving its old spot)
    const all = $$('.sbe-chip[data-key]', slots);
    const { chips, index } = dropPoint(slots, e.clientX);
    const target = chips[index];
    placeSidebarButton(key, slots.dataset.zone, target ? all.indexOf(target) : all.length);
  });
}

function renderSidebarEditor(ed) {
  const layout = sidebarLayout();
  const used = new Set([...layout.head, ...layout.foot]);
  const chip = (key) => {
    const b = SIDEBAR_BUTTONS[key];
    return `<div class="sbe-chip" draggable="true" data-key="${key}" title="${esc(b.label)} — drag to move, right-click for more">
      ${icon(b.icon, 16)}<button class="sbe-x" data-remove="${key}" title="Remove ${esc(b.label)}">${icon('close', 10)}</button></div>`;
  };
  const free = Object.keys(SIDEBAR_BUTTONS).filter((k) => !used.has(k));
  ed.innerHTML = `
    <section class="s-group"><h3 class="s-group-title">Your sidebar</h3>
      <div class="s-card sbe-card">
        <div class="sbe-mock">
          <div class="sbe-row sbe-top">
            <span class="sbe-brand">${LOGO}<span>Ultima</span></span>
            <div class="sbe-slots" data-zone="head">${layout.head.map(chip).join('')}</div>
          </div>
          <div class="sbe-body" aria-hidden="true"><i></i><i></i><i class="short"></i><i></i></div>
          <div class="sbe-row sbe-bottom">
            <div class="sbe-slots" data-zone="foot">${layout.foot.map(chip).join('')}</div>
            <span class="sbe-chip locked" title="Compact sidebar — always here">${icon('sidebar', 16)}</span>
          </div>
        </div>
        <p class="sbe-hint">Drag buttons to reorder them, or between the top and the bottom. Right-click one for more, or drag it down to the list below to remove it. The top holds up to ${SIDEBAR_HEAD_MAX}.</p>
      </div>
    </section>
    <section class="s-group"><h3 class="s-group-title">Add buttons</h3>
      <div class="s-card"><div class="sbe-library">${free.length ? free.map((k) => `
        <button class="sbe-tile" draggable="true" data-add="${k}" title="Add to the bottom of the sidebar, or drag it where you want it">${icon(SIDEBAR_BUTTONS[k].icon, 18)}<span>${esc(SIDEBAR_BUTTONS[k].label)}</span></button>`).join('')
          : '<div class="sbe-empty">Every button is in your sidebar.</div>'}</div></div>
    </section>
    <div class="s-actions"><button class="btn" data-sbe-reset>${icon('reload', 14)} Reset to default</button></div>`;
}
