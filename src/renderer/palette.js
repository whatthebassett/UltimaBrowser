// Control Palette: one box for URLs, search, open tabs, bookmarks, history and every browser command.
const P = { mode: 'new', items: [], sel: 0, seq: 0 };

// Commands are also the single source of truth for keyboard shortcuts (see runCommand in app.js).
const COMMANDS = [
  { id: 'new-tab', title: 'New tab', icon: 'plus' },
  { id: 'close-tab', title: 'Close tab', icon: 'close' },
  { id: 'reopen-tab', title: 'Reopen closed tab', icon: 'history' },
  { id: 'duplicate-tab', title: 'Duplicate tab', icon: 'duplicate' },
  { id: 'pin-tab', title: 'Pin / unpin tab in this space', icon: 'pin', words: 'pinned keep' },
  { id: 'essential-tab', title: 'Add to / remove from Essentials', icon: 'star', words: 'essentials pin all spaces favorite favorite' },
  { id: 'unload-tab', title: 'Unload tab', icon: 'unload', words: 'sleep suspend discard memory hibernate' },
  { id: 'reset-tab', title: 'Back to the pinned link', icon: 'home', words: 'pinned essential home original reset' },
  { id: 'edit-pinned-link', title: 'Edit the pinned link', icon: 'link', words: 'pinned essential url address change home' },
  { id: 'replace-pinned-link', title: 'Replace the pinned link with the current page', icon: 'pin', words: 'pinned essential url set home current this page' },
  { id: 'mute-tab', title: 'Mute / unmute tab', icon: 'mute' },
  { id: 'close-others', title: 'Close other tabs', icon: 'close' },
  { id: 'reload', title: 'Reload page', icon: 'reload' },
  { id: 'hard-reload', title: 'Hard reload (ignore cache)', icon: 'reload' },
  { id: 'back', title: 'Go back', icon: 'back' },
  { id: 'forward', title: 'Go forward', icon: 'forward' },
  { id: 'bookmark', title: 'Add this page to Waypoints', icon: 'star', words: 'bookmark save star favorite' },
  { id: 'copy-url', title: 'Copy page URL', icon: 'link' },
  { id: 'find', title: 'Find in page', icon: 'find' },
  { id: 'fill-login', title: 'Fill saved login on this page', icon: 'key' },
  { id: 'zoom-in', title: 'Zoom in', icon: 'zoomIn' },
  { id: 'caret-browsing', title: 'Caret browsing on/off', icon: 'accessibility', words: 'text cursor keyboard accessibility navigate select f7' },
  { id: 'zoom-out', title: 'Zoom out', icon: 'zoomOut' },
  { id: 'zoom-reset', title: 'Reset zoom', icon: 'search' },
  { id: 'toggle-sidebar', title: 'Toggle sidebar', icon: 'sidebar' },
  { id: 'toggle-tab-layout', title: 'Vertical / horizontal tabs', icon: 'tab', words: 'horizontal vertical tab strip top layout chrome tabs bar sidebar' },
  { id: 'toggle-fullscreen', title: 'Full screen', icon: 'monitor', words: 'f11 fullscreen immersive maximize whole screen kiosk' },
  { id: 'toggle-sidebar-hidden', title: 'Hide / show sidebar', icon: 'sidebar', words: 'auto-hide autohide full screen focus zen arc distraction' },
  { id: 'open-import', title: 'Import data from Chrome, Edge, Firefox, Zen…', icon: 'import', words: 'migrate transfer chrome edge firefox zen brave vivaldi' },
  { id: 'open-bookmarks', title: 'Open Waypoints', icon: 'bookmark', words: 'bookmarks favorites saved manager' },
  { id: 'open-history', title: 'Open history', icon: 'history' },
  { id: 'tab-history', title: 'Tab History', icon: 'tabHistory', words: 'back forward pages visited tab navigation list' },
  { id: 'open-downloads', title: 'Open downloads', icon: 'download' },
  { id: 'welcome', title: 'Replay welcome', icon: 'sparkle', words: 'onboarding setup tour intro first run essentials customize' },
  { id: 'task-manager', title: 'Task manager', icon: 'activity', words: 'processes memory ram cpu gpu performance kill end task usage' },
  { id: 'open-extensions', title: 'Open extensions', icon: 'puzzle', words: 'addons add-ons plugins chrome web store' },
  { id: 'url-menu', title: 'Address bar menu', icon: 'more', words: 'history downloads extensions' },
  { id: 'open-passwords', title: 'Open passwords', icon: 'key', words: 'logins credentials' },
  { id: 'open-settings', title: 'Open settings', icon: 'settings', words: 'preferences options' },
  { id: 'make-default-browser', title: 'Make Ultima the default browser', icon: 'globe', words: 'default browser links open with system' },
  { id: 'open-shortcuts', title: 'Keyboard shortcuts', icon: 'command', words: 'keybindings hotkeys keys customize remap' },
  { id: 'edit-url', title: 'Edit address', icon: 'globe' },
  { id: 'next-tab', title: 'Next tab', icon: 'forward' },
  { id: 'prev-tab', title: 'Previous tab', icon: 'back' },
  { id: 'space-theme', title: 'Edit space theme (colors and gradient)', icon: 'palette', words: 'theme color color gradient appearance customize arc' },
  { id: 'split-tab', title: 'Split view (side by side)', icon: 'split', words: 'split screen side by side two tabs panes tile' },
  { id: 'split-move-left', title: 'Split view: move pane left', icon: 'back', words: 'reorder arrange split swap pane order' },
  { id: 'split-move-right', title: 'Split view: move pane right', icon: 'forward', words: 'reorder arrange split swap pane order' },
  { id: 'unsplit-tab', title: 'Take tab out of split view', icon: 'sidebar', words: 'unsplit separate split screen' },
  { id: 'rename-tab', title: 'Rename tab', icon: 'edit', words: 'name label title tab custom' },
  { id: 'tab-folder-new', title: 'Add tab to a new folder', icon: 'folder', words: 'group tab group folder organize organize' },
  { id: 'tab-folder-remove', title: 'Remove tab from its folder', icon: 'folder', words: 'ungroup tab group folder' },
  { id: 'import-bookmarks-bar', title: 'Import bookmarks bar (Chrome, Edge…)', icon: 'import', words: 'chrome edge brave vivaldi favorites favorites copy' },
  { id: 'toggle-bookmarks-bar', title: 'Show / hide Waypoints bar', icon: 'bookmark', words: 'bookmarks favorites toolbar bar' },
  { id: 'customize-sidebar', title: 'Edit sidebar', icon: 'sidebar', words: 'customize widgets toolbar add remove buttons edit layout divider' },
  { id: 'toggle-loading-animation', title: 'Loading animation on / off', icon: 'sparkle', words: 'address bar progress gradient spinner' },
  { id: 'theme-dark', title: 'Theme: Dark', icon: 'moon' },
  { id: 'theme-light', title: 'Theme: Light', icon: 'sun' },
  { id: 'theme-system', title: 'Theme: Match system', icon: 'sun' },
  { id: 'clear-data', title: 'Clear browsing data…', icon: 'eraser' },
  { id: 'print', title: 'Print page', icon: 'print' },
  { id: 'devtools', title: 'Developer tools', icon: 'code' },
  { id: 'home', title: 'Go to new tab page', icon: 'home' },
];

// Space commands depend on which spaces exist, so they are built on every search.
function spaceCommands() {
  const cur = activeSpace();
  const others = B.spaces.filter((s) => s.id !== cur.id);
  return [
    ...others.map((s) => ({ id: `go-space:${s.id}`, title: `Switch to space: ${s.icon} ${s.name}`, icon: 'layers', words: `space ${s.name}`, keyId: `space-${B.spaces.indexOf(s) + 1}` })),
    ...others.map((s) => ({ id: `move-to-space:${s.id}`, title: `Move tab to ${s.icon} ${s.name}`, icon: 'layers', words: `send space ${s.name}` })),
    { id: 'new-space', title: 'New space', icon: 'plus', words: 'space workspace profile create add' },
    { id: 'rename-space', title: `Rename space “${cur.name}”`, icon: 'layers' },
    { id: 'toggle-space-separate', title: cur.separate ? `Share sign-ins in ${cur.name} with other spaces` : `Give ${cur.name} its own sign-ins`, icon: 'shield', words: 'space cookies profile container separate' },
    { id: 'space-options', title: 'Space icon, color and options…', icon: 'layers', words: 'space emoji color color' },
    { id: 'next-space', title: 'Next space', icon: 'forward' },
    { id: 'prev-space', title: 'Previous space', icon: 'back' },
    ...(B.spaces.length > 1 ? [{ id: 'delete-space', title: `Delete space “${cur.name}”…`, icon: 'trash' }] : []),
  ];
}

const MODE_LABEL = { new: 'New tab', current: 'Current tab', any: 'Control Palette' };

// Where the address bar (and the new-tab button) opens the palette: Settings → Address bar (addressBarMode)
//   palette:  the Control Palette, in the middle of the window
//   extended: the same palette hanging from the address bar, its search box over the bar
//   classic:  a traditional address bar: you type in the bar itself, and places to go drop down under it
// The Control Palette's own shortcut (Ctrl+K) always opens it in the middle.
const ADDRESS_MODES = ['palette', 'extended', 'classic'];
const addressMode = () => (ADDRESS_MODES.includes(B.settings.addressBarMode) ? B.settings.addressBarMode : 'palette');

function openPalette(mode = 'any', prefill = '') {
  P.mode = mode;
  P.at = mode === 'any' ? 'palette' : addressMode();
  // (an address bar that's off screen, in a hidden sidebar, has nothing to hang from: the middle it is)
  const bar = $('#urlbar').getBoundingClientRect();
  if (P.at !== 'palette' && (bar.right <= 0 || bar.width < 24)) P.at = 'palette';
  const backdrop = $('#palette-backdrop');
  backdrop.classList.toggle('p-extended', P.at === 'extended');
  backdrop.classList.toggle('p-classic', P.at === 'classic');
  $('.pi-icon').innerHTML = P.at === 'classic' ? icon('search', 14) : icon('command', 18);
  const input = $('#palette-input');
  input.placeholder = P.at === 'classic' ? 'Search or type a web address' : 'Search tabs, Waypoints, history, commands — or type a URL';
  backdrop.hidden = false;
  if (P.at !== 'palette') placePaletteAtBar();
  $('#palette-mode').textContent = MODE_LABEL[mode];
  input.value = prefill;
  input.focus();
  input.select();
  updatePalette();
}

// Lines the palette up with the address bar: the extended one a little bigger all round, so its search box sits over
// the bar, at least wide enough to read; the traditional one's box exactly on the bar, its list at least as wide.
function placePaletteAtBar() {
  const bar = $('#urlbar').getBoundingClientRect();
  const pal = $('#palette');
  const W = window.innerWidth;
  const classic = P.at === 'classic';
  const width = Math.min(W - 16, classic ? Math.max(bar.width, 460) : Math.min(Math.max(bar.width + 12, 560), 760));
  const left = Math.max(8, Math.min(bar.left - (classic ? 0 : 6), W - width - 8));
  pal.style.setProperty('--px', `${left}px`);
  pal.style.setProperty('--py', `${bar.top - (classic ? 0 : 6)}px`);
  pal.style.setProperty('--pw', `${width}px`);
  pal.style.setProperty('--bar-w', `${bar.width}px`);
  pal.style.setProperty('--bar-h', `${bar.height}px`);
}

function closePalette(refocus = true) {
  if ($('#palette-backdrop').hidden) return;
  $('#palette-backdrop').hidden = true;
  const tab = activeTab();
  if (refocus && tab && !isInternal(tab.url)) tab.webview?.focus();
}

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.every((w) => t.includes(w))) return 60 - Math.min(30, t.indexOf(words[0]));
  // subsequence match, e.g. "nwtb" → "new tab"
  let i = 0;
  for (const c of t) if (c === q[i]) i += 1;
  return i === q.length ? 20 : 0;
}

async function updatePalette() {
  const raw = $('#palette-input').value;
  const commandsOnly = raw.startsWith('>');
  const q = (commandsOnly ? raw.slice(1) : raw).trim();
  const seq = ++P.seq;
  const items = [];
  const engine = SEARCH_ENGINES[B.settings.searchEngine] || SEARCH_ENGINES.google;

  if (q && !commandsOnly) {
    const url = resolveInput(q, B.settings.searchEngine);
    if (looksLikeUrl(q)) items.push({ group: '', kind: 'url', icon: 'globe', title: url, sub: 'Open address', url });
    else items.push({ group: '', kind: 'url', icon: 'search', title: q, sub: `Search ${engine.name}`, url });
  }

  const classic = P.at === 'classic';
  if (!commandsOnly && (q || !classic)) {
    const tabs = B.tabs
      .filter((t) => (t.id !== B.activeId && t.spaceId === B.activeSpaceId) || q)
      .map((t) => ({ t, s: q ? Math.max(fuzzyScore(q, tabLabel(t)), fuzzyScore(q, t.title), fuzzyScore(q, t.url) * 0.8) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (q ? b.s - a.s : (b.t.lastActive || 0) - (a.t.lastActive || 0)))
      .slice(0, q ? 5 : 6);
    for (const { t } of tabs) {
      const space = spaceById(homeSpaceOf(t));
      const elsewhere = space && space.id !== B.activeSpaceId;
      items.push({
        group: 'Open tabs', kind: 'tab', tab: t, title: tabLabel(t), sub: hostname(t.url) || t.url, fav: favHtml(t.favicon, t.url, t.title),
        hint: elsewhere ? `${space.icon} ${esc(space.name)}` : t.zone === 'essential' ? 'Essential' : isUnloaded(t) ? 'Unloaded' : 'Switch to tab',
      });
    }
  }

  const cmds = classic && !commandsOnly ? [] : [...COMMANDS, ...spaceCommands()]
    .map((c) => ({ c, s: Math.max(fuzzyScore(q, c.title), c.words ? fuzzyScore(q, c.words) * 0.7 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, commandsOnly ? 40 : q ? 5 : 4);
  for (const { c } of cmds) items.push({ group: 'Commands', kind: 'cmd', cmd: c.id, icon: c.icon, title: c.title, keyId: c.keyId || c.id });

  if (q && !commandsOnly) {
    const res = await window.ultima.search(q);
    if (seq !== P.seq) return; // a newer keystroke already rendered
    const open = new Set(B.tabs.map((t) => t.url));
    res.bookmarks = res.bookmarks.filter((b) => !open.has(b.url));
    res.history = res.history.filter((x) => !open.has(x.url));
    for (const b of res.bookmarks) items.push({ group: 'Waypoints', kind: 'url', url: b.url, title: b.title, sub: b.url, fav: favHtml('', b.url, b.title), hint: icon('star', 13) });
    for (const x of res.history) items.push({ group: 'History', kind: 'url', url: x.url, title: x.title || x.url, sub: x.url, fav: favHtml('', x.url, x.title) });
  }

  P.items = items;
  P.sel = 0;
  renderPalette(q);
}

function renderPalette(q) {
  let lastGroup = null;
  const html = P.items.map((it, i) => {
    let head = '';
    if (it.group !== lastGroup) { lastGroup = it.group; if (it.group) head = `<div class="p-group">${esc(it.group)}</div>`; }
    const ico = it.fav || icon(it.icon || 'globe');
    const combo = it.keyId && keysFor(it.keyId)[0];
    const keys = combo ? kbdHtml(combo) : '';
    return `${head}<div class="p-item ${i === P.sel ? 'sel' : ''}" data-i="${i}">
      <span class="p-ico">${ico}</span>
      <span class="p-text"><span class="p-title">${highlight(it.title, q)}</span><span class="p-sub">${it.sub ? highlight(it.sub, q) : ''}</span></span>
      <span class="p-hint">${keys || it.hint || ''}</span></div>`;
  }).join('');
  // (a traditional address bar shows no list until you type)
  $('#palette-results').innerHTML = html || (P.at === 'classic' && !q ? '' : '<div class="empty">Nothing matches</div>');
}

function movePaletteSel(d) {
  if (!P.items.length) return;
  P.sel = (P.sel + d + P.items.length) % P.items.length;
  $$('.p-item').forEach((el) => el.classList.toggle('sel', Number(el.dataset.i) === P.sel));
  $('.p-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function choosePaletteItem(i, background = false) {
  const it = P.items[i];
  if (!it) return;
  const mode = P.mode;
  if (it.kind === 'cmd') {
    // let the command decide where focus goes (e.g. a rename box), then fall back to the page
    closePalette(false);
    runCommand(it.cmd);
    const tab = activeTab();
    if (document.activeElement === document.body && tab && !isInternal(tab.url)) tab.webview?.focus();
    return undefined;
  }
  closePalette();
  if (it.kind === 'tab') return activateTab(it.tab.id);
  const cur = activeTab();
  const reuse = mode === 'current' || (cur && cur.url === NEWTAB && !background);
  if (reuse && cur) navigate(cur, it.url);
  else createTab({ url: it.url, activate: !background });
}

// Footer hints always show the current palette bindings.
function renderPaletteFoot() {
  const hint = (ids, label) => {
    const combos = ids.map((id) => keysFor(id)[0]).filter(Boolean);
    return combos.length ? `<span>${combos.map(kbdHtml).join(' ')} ${label}</span>` : '';
  };
  $('#palette-foot').innerHTML = [
    hint(['palette.next', 'palette.prev'], 'navigate'),
    hint(['palette.open'], 'open'),
    hint(['palette.open-background'], 'background tab'),
    '<span><kbd>&gt;</kbd> commands only</span>',
    hint(['palette.close'], 'close'),
  ].join('');
}

function initPalette() {
  $('.pi-icon').innerHTML = icon('command', 18);
  const input = $('#palette-input');
  input.addEventListener('input', updatePalette);
  input.addEventListener('keydown', (e) => {
    const act = ['palette.next', 'palette.prev', 'palette.open', 'palette.open-background', 'palette.close'].find((id) => matchesKey(e, id));
    if (!act) return;
    e.preventDefault();
    if (act === 'palette.next') movePaletteSel(1);
    else if (act === 'palette.prev') movePaletteSel(-1);
    else if (act === 'palette.open') choosePaletteItem(P.sel, false);
    else if (act === 'palette.open-background') choosePaletteItem(P.sel, true);
    else closePalette();
  });
  $('#palette-results').addEventListener('mousemove', (e) => {
    const el = e.target.closest('.p-item');
    if (el && Number(el.dataset.i) !== P.sel) { P.sel = Number(el.dataset.i); $$('.p-item').forEach((x) => x.classList.toggle('sel', x === el)); }
  });
  $('#palette-results').addEventListener('click', (e) => {
    const el = e.target.closest('.p-item');
    if (el) choosePaletteItem(Number(el.dataset.i), e.ctrlKey || e.metaKey);
  });
  $('#palette-backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'palette-backdrop') closePalette(); });
  window.addEventListener('resize', () => { if (!$('#palette-backdrop').hidden && P.at !== 'palette') placePaletteAtBar(); });
}
