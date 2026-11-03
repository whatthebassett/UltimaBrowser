// The sidebar's buttons: which ones, in which order, in the grid at the top (beside the logo) or the one at the bottom,
// with upright dividers between groups and blank spaces to push them apart. Arranged by dragging, in the sheet that slides up from the bottom (sidebaredit.js).
const SIDEBAR_BUTTONS = {
  back: { icon: 'back', cmd: 'back', label: 'Back' },
  forward: { icon: 'forward', cmd: 'forward', label: 'Forward' },
  reload: { icon: 'reload', cmd: 'reload', label: 'Reload' },
  home: { icon: 'home', cmd: 'home', label: 'New tab page' },
  'new-tab': { icon: 'plus', cmd: 'new-tab', label: 'New tab' },
  'new-window': { icon: 'window', cmd: 'new-window', label: 'New window' },
  'private-window': { icon: 'incognito', cmd: 'new-private-window', label: 'New private window' },
  'private-tab': { icon: 'incognito', cmd: 'new-private-tab', label: 'New private tab' },
  palette: { icon: 'command', cmd: 'palette', label: 'Control Palette' },
  'url-menu': { icon: 'more', cmd: 'url-menu', label: 'Address bar menu' },
  bookmarks: { icon: 'bookmark', cmd: 'open-bookmarks', label: 'Waypoints' },
  'bookmarks-bar': { icon: 'star', cmd: 'toggle-bookmarks-bar', label: 'Show / hide Waypoints bar' },
  'tab-folder': { icon: 'folder', cmd: 'tab-folder-new', label: 'Add tab to a new folder' },
  split: { icon: 'split', cmd: 'split-tab', label: 'Split view' },
  'bookmark-page': { icon: 'star', cmd: 'bookmark', label: 'Add this page to Waypoints' },
  history: { icon: 'history', cmd: 'open-history', label: 'History' },
  'tab-history': { icon: 'tabHistory', cmd: 'tab-history', label: 'Tab History' },
  downloads: { icon: 'download', cmd: 'open-downloads', label: 'Downloads' },
  'task-manager': { icon: 'activity', cmd: 'task-manager', label: 'Task manager' },
  extensions: { icon: 'puzzle', cmd: 'open-extensions', label: 'Extensions' },
  passwords: { icon: 'key', cmd: 'open-passwords', label: 'Passwords' },
  import: { icon: 'import', cmd: 'open-import', label: 'Import browser data' },
  find: { icon: 'find', cmd: 'find', label: 'Find in page' },
  'copy-url': { icon: 'copy', cmd: 'copy-url', label: 'Copy page address' },
  print: { icon: 'print', cmd: 'print', label: 'Print' },
  'zoom-in': { icon: 'zoomIn', cmd: 'zoom-in', label: 'Zoom in' },
  'zoom-out': { icon: 'zoomOut', cmd: 'zoom-out', label: 'Zoom out' },
  'new-space': { icon: 'layers', cmd: 'new-space', label: 'New orbit' },
  'space-theme': { icon: 'palette', cmd: 'space-theme', label: 'Edit orbit theme' },
  devtools: { icon: 'code', cmd: 'devtools', label: 'Developer tools' },
  'clear-data': { icon: 'eraser', cmd: 'clear-data', label: 'Clear browsing data' },
  shortcuts: { icon: 'keyboard', cmd: 'open-shortcuts', label: 'Keyboard shortcuts' },
  collapse: { icon: 'sidebar', cmd: 'toggle-sidebar', label: 'Compact sidebar' },
  'hide-sidebar': { icon: 'sidebar', cmd: 'toggle-sidebar-hidden', label: 'Hide sidebar' },
  'tab-layout': { icon: 'tab', cmd: 'toggle-tab-layout', label: 'Vertical / horizontal tabs' },
  settings: { icon: 'settings', cmd: 'open-settings', label: 'Settings' },
};
const SIDEBAR_DEFAULT = { head: ['back', 'forward', 'reload'], foot: ['palette', 'bookmarks', 'history', 'tab-history', 'downloads', 'import', 'settings', 'space', 'collapse'] };
const SIDEBAR_DIVIDER = 'divider'; // an upright line between buttons
const SIDEBAR_SPACE = 'space'; // an empty cell, a button wide
const SIDEBAR_REPEATS = new Set([SIDEBAR_DIVIDER, SIDEBAR_SPACE]); // these two go in as often as you like
// buttons that were in the page before this was customizable keep their ids (other code looks them up)
const SIDEBAR_BUILT_IN = new Set(['back', 'forward', 'reload', 'palette', 'bookmarks', 'history', 'downloads', 'import', 'settings', 'collapse']);
const sidebarButtonId = (key) => (SIDEBAR_BUILT_IN.has(key) ? `btn-${key}` : `sbb-${key}`);
// the two grids the buttons sit in: beside the logo, and at the foot of the sidebar (with horizontal tabs, both in the
// toolbar: tablayout.js)
const sidebarZones = () => ({ head: $('#sidebar .nav'), foot: $('#sidebar .sb-cells') });

// the saved layout, cleaned up: known buttons only, each once (dividers and blank spaces as often as you like)
function sidebarLayout() {
  const saved = B.settings.sidebarButtons;
  const seen = new Set();
  const clean = (list) => (Array.isArray(list) ? list : []).filter((k) => SIDEBAR_REPEATS.has(k) || (SIDEBAR_BUTTONS[k] && !seen.has(k) && seen.add(k)));
  if (!saved || typeof saved !== 'object') return { head: [...SIDEBAR_DEFAULT.head], foot: [...SIDEBAR_DEFAULT.foot] };
  const layout = { head: clean(saved.head), foot: clean(saved.foot) };
  // layouts saved before the compact sidebar button could be moved had it fixed at the bottom right: it stays there
  if (saved.version !== 2 && !seen.has('collapse')) layout.foot.push(SIDEBAR_SPACE, 'collapse');
  return layout;
}

// Every button exists once; the ones not in use wait in a hidden pool, so code that updates them always finds them.
function initSidebarButtons() {
  const pool = $('#sb-pool');
  $('#sidebar .nav').dataset.zone = 'head';
  const foot = $('#sidebar .sb-foot');
  if (!$('.sb-cells', foot)) foot.prepend(h('<div class="sb-cells" data-zone="foot"></div>'));
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
      if (sidebarEditing()) return; // being arranged (sidebaredit.js)
      if (key === 'reload' && activeTab()?.loading) return activeTab().webview?.stop();
      if (WIDGETS[key] && widgetDropdowns()) return toggleWidget(key); // Waypoints, History, Downloads: a dropdown (widgets.js)
      return runCommand(b.cmd);
    });
  }
  renderSidebarButtons();
}

function renderSidebarButtons() {
  const layout = sidebarLayout();
  const zones = sidebarZones();
  const pool = $('#sb-pool');
  const used = new Set([...layout.head, ...layout.foot]);
  $$('#sidebar .sb-div, #sidebar .sb-space').forEach((d) => d.remove());
  for (const zone of ['head', 'foot']) {
    for (const key of layout[zone]) {
      zones[zone].append(key === SIDEBAR_DIVIDER ? h(`<span class="sb-div" data-sbb="${SIDEBAR_DIVIDER}" role="separator" aria-orientation="vertical"></span>`)
        : key === SIDEBAR_SPACE ? h(`<span class="sb-space" data-sbb="${SIDEBAR_SPACE}" aria-hidden="true"></span>`)
          : document.getElementById(sidebarButtonId(key)));
    }
  }
  for (const key of Object.keys(SIDEBAR_BUTTONS)) if (!used.has(key)) pool.append(document.getElementById(sidebarButtonId(key)));
}

function setSidebarLayout(layout) {
  applySettings({ sidebarButtons: { head: [...layout.head], foot: [...layout.foot], version: 2 } });
  renderSidebarButtons();
  updateChrome();
  renderSidebarSheet(); // the buttons left to add (sidebaredit.js)
}

// Adds a button (or a divider) at the end of `zone`, or moves it there.
function placeSidebarButton(key, zone) {
  const layout = sidebarLayout();
  if (!SIDEBAR_REPEATS.has(key)) for (const z of ['head', 'foot']) layout[z] = layout[z].filter((k) => k !== key);
  layout[zone].push(key);
  setSidebarLayout(layout);
}

function removeSidebarButton(key) {
  const layout = sidebarLayout();
  setSidebarLayout({ head: layout.head.filter((k) => k !== key), foot: layout.foot.filter((k) => k !== key) });
}

// Takes one item off the sidebar by where it is (there can be several dividers and blank spaces).
function removeSidebarItem(el) {
  const zoneEl = el?.closest('[data-zone]');
  if (!zoneEl) return;
  const layout = sidebarLayout();
  const index = $$(':scope > [data-sbb]', zoneEl).indexOf(el);
  if (index >= 0) layout[zoneEl.dataset.zone].splice(index, 1);
  setSidebarLayout(layout);
}
