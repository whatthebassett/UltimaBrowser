// Spaces: separate sets of tabs (Personal, Work, Play…), each with its own icon, color and optionally its own sign-ins.
const SPACE_ICONS = ['🏠', '💼', '🎮', '📚', '🎵', '🎬', '🛒', '✈️', '💡', '🧪', '🎨', '💬', '📰', '🏋️', '🍳', '💰', '🌙', '⭐'];
const SPACE_COLORS = {
  Violet: '#8b5cf6', Blue: '#3b82f6', Teal: '#14b8a6', Green: '#22c55e',
  Amber: '#f59e0b', Red: '#ef4444', Pink: '#ec4899', Slate: '#64748b',
};
const DEFAULT_SPACES = [
  { name: 'Personal', icon: '🏠', color: SPACE_COLORS.Violet },
  { name: 'Work', icon: '💼', color: SPACE_COLORS.Blue },
  { name: 'Play', icon: '🎮', color: SPACE_COLORS.Green },
];
const SHARED_PARTITION = 'persist:ultima';

B.spaces = [];
B.activeSpaceId = null;

const newSpaceId = () => Math.random().toString(36).slice(2, 10);
const spaceById = (id) => B.spaces.find((s) => s.id === id) || null;
const activeSpace = () => spaceById(B.activeSpaceId) || B.spaces[0];
// Tabs shown while a space is open: the shared essentials plus that space's own pinned and regular tabs.
const spaceTabs = (id = B.activeSpaceId) => B.tabs.filter((t) => t.zone === 'essential' || t.spaceId === id);
const ownTabs = (id) => B.tabs.filter((t) => t.zone !== 'essential' && t.spaceId === id);
const partitionFor = (spaceId) => (spaceById(spaceId)?.separate ? `${SHARED_PARTITION}-space-${spaceId}` : SHARED_PARTITION);
// Essentials are shared by every space, so they always use the shared sign-ins.
const tabPartition = (tab) => (tab.zone === 'essential' ? SHARED_PARTITION : partitionFor(tab.spaceId));

function initSpaces(saved, activeId) {
  B.spaces = saved?.length ? saved : DEFAULT_SPACES.map((s) => ({ ...s, id: newSpaceId(), separate: false }));
  B.activeSpaceId = spaceById(activeId) ? activeId : B.spaces[0].id;
  applySpaceTheme();
  renderSpaces();
}

// A space's theme (colors, gradient, light/dark) is part of the app theme, so re-apply the whole thing.
function applySpaceTheme() {
  applyTheme();
}

// Switches the sidebar to another space and brings up the tab used most recently there.
function switchSpace(id, focusTab) {
  const space = spaceById(id);
  if (!space) return;
  const from = B.spaces.indexOf(activeSpace());
  const changed = id !== B.activeSpaceId;
  B.activeSpaceId = id;
  applySpaceTheme();
  const target = focusTab || ownTabs(id).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
  if (target) activateTab(target.id);
  else createTab();
  if (changed) {
    const list = $('#tabs');
    list.style.setProperty('--space-dir', B.spaces.indexOf(space) > from ? '14px' : '-14px');
    list.classList.remove('space-in');
    void list.offsetWidth; // restart the animation
    list.classList.add('space-in');
  }
  renderSpaces();
  saveSession();
  if (TE.el && TE.space !== space) openThemeEditor(space); // the theme editor follows you to the new space
}

function cycleSpace(dir) {
  const i = B.spaces.indexOf(activeSpace());
  switchSpace(B.spaces[(i + dir + B.spaces.length) % B.spaces.length].id);
}

function createSpace(switchTo = true) {
  const usedIcons = new Set(B.spaces.map((s) => s.icon));
  const colors = Object.values(SPACE_COLORS);
  const space = {
    id: newSpaceId(),
    name: `Space ${B.spaces.length + 1}`,
    icon: SPACE_ICONS.find((i) => !usedIcons.has(i)) || '⭐',
    color: colors[B.spaces.length % colors.length],
    separate: false,
  };
  space.theme = defaultTheme(space.color);
  B.spaces.push(space);
  if (switchTo) { switchSpace(space.id); startRenameSpace(); } else renderSpaces();
  return space;
}

function startRenameSpace() {
  const space = activeSpace();
  const label = $('.space-name');
  const input = h(`<input class="space-name-input" value="${esc(space.name)}" maxlength="28" spellcheck="false">`);
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim()) space.name = input.value.trim();
    renderSpaces();
    saveSession();
  };
  input.addEventListener('keydown', (e) => {
    if (matchesKey(e, 'field.submit')) { e.preventDefault(); finish(true); }
    else if (matchesKey(e, 'field.cancel')) { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function setSpaceSeparate(space, separate) {
  if (Boolean(space.separate) === separate) return;
  space.separate = separate;
  // A webview can't change partition once attached, so reload this space's tabs into the new one.
  for (const t of ownTabs(space.id)) dropWebview(t);
  const cur = activeTab();
  if (cur?.spaceId === space.id) activateTab(cur.id);
  renderTabs();
  renderSpaces();
  saveSession();
  toast(separate ? `${space.name} now keeps its own sign-ins and cookies` : `${space.name} now shares sign-ins with your other spaces`);
}

async function deleteSpace(space) {
  if (B.spaces.length === 1) return toast('You need at least one space');
  const tabs = ownTabs(space.id);
  const closes = tabs.length ? `Its ${tabs.length} tab${tabs.length > 1 ? 's' : ''} will be closed. ` : '';
  const ok = await confirmDialog(`${closes}Essentials are kept.`, { title: `Delete the “${space.name}” space?`, ok: 'Delete space', danger: true });
  if (!ok) return undefined;
  for (const t of tabs) dropWebview(t);
  B.tabs = B.tabs.filter((t) => !tabs.includes(t));
  B.spaces = B.spaces.filter((s) => s !== space);
  if (B.activeSpaceId === space.id) switchSpace(B.spaces[0].id);
  else { renderSpaces(); saveSession(); }
  return toast(`Deleted ${space.name}`);
}

function moveTabToSpace(tab, spaceId) {
  const target = spaceById(spaceId);
  if (!tab || !target || tab.spaceId === spaceId) return;
  const fromActive = tab.id === B.activeId;
  const before = tabPartition(tab);
  if (fromActive) {
    const next = pickNextTab(tab);
    if (next) activateTab(next.id);
    else createTab();
  }
  if (tab.zone === 'essential') tab.zone = 'pinned'; // an essential sent to one space becomes a pinned tab there
  tab.spaceId = spaceId;
  tab.openerId = undefined;
  tab.folderId = undefined; // folders and split views belong to a space
  tab.splitId = undefined;
  if (tab.webview && tabPartition(tab) !== before) dropWebview(tab);
  sortZones();
  renderTabs();
  saveSession();
  toast(`Moved to ${target.icon} ${target.name}`, { label: 'Go', run: () => switchSpace(spaceId, tab) });
}

async function spaceMenu(space = activeSpace(), pos = undefined) {
  const choice = await showMenu([
    { id: 'rename', icon: 'layers', label: 'Rename space' },
    { label: 'Icon', icon: 'sparkle', submenu: SPACE_ICONS.map((i) => ({ id: `icon:${i}`, label: i })) },
    { id: 'theme', icon: 'palette', label: 'Edit theme…', shortcut: 'space-theme' },
    { id: 'separate', type: 'checkbox', checked: space.separate, label: 'Separate sign-ins and cookies' },
    { type: 'separator' },
    { label: 'Switch to', icon: 'forward', submenu: B.spaces.map((s) => ({ id: `go:${s.id}`, label: `${s.icon}  ${s.name}`, enabled: s.id !== B.activeSpaceId })) },
    { id: 'new', icon: 'plus', label: 'New space', shortcut: 'new-space' },
    { type: 'separator' },
    { id: 'delete', icon: 'trash', danger: true, label: 'Delete space…', enabled: B.spaces.length > 1 },
  ], pos);
  if (!choice) return;
  const [kind, value] = choice.split(/:(.*)/s);
  if (kind === 'rename') startRenameSpace();
  else if (kind === 'icon') { space.icon = value; renderSpaces(); renderTabs(); saveSession(); }
  else if (kind === 'theme') openThemeEditor(space);
  else if (kind === 'separate') setSpaceSeparate(space, !space.separate);
  else if (kind === 'go') switchSpace(value);
  else if (kind === 'new') createSpace();
  else if (kind === 'delete') deleteSpace(space);
}

function renderSpaces() {
  const space = activeSpace();
  if (!space) return;
  $('#space-head').innerHTML = `<button class="space-icon" title="Space options">${space.icon}</button>
    <span class="space-name" title="Double-click to rename">${esc(space.name)}</span>
    ${space.separate ? `<span class="space-lock" title="Separate sign-ins">${icon('shield', 12)}</span>` : ''}
    <button class="icon-btn space-more" title="Space options">${icon('more', 16)}</button>`;
  $('#space-bar').innerHTML = B.spaces.map((s, i) => `<button class="space-chip ${s.id === space.id ? 'on' : ''}" data-space="${s.id}"
      style="--chip:${s.color}" title="${esc(withKey(s.name, `space-${i + 1}`))}">${s.icon}</button>`).join('')
    + `<button class="space-chip add" data-act="new-space" title="${esc(withKey('New space', 'new-space'))}">${icon('plus', 14)}</button>`;
}

function initSpaceUi() {
  const head = $('#space-head');
  head.addEventListener('click', (e) => {
    const btn = e.target.closest('.space-icon, .space-more');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    spaceMenu(activeSpace(), { x: r.left, y: r.bottom + 4 });
  });
  head.addEventListener('dblclick', (e) => { if (e.target.closest('.space-name')) startRenameSpace(); });

  const bar = $('#space-bar');
  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('.space-chip');
    if (!chip) return;
    if (chip.dataset.act === 'new-space') createSpace();
    else switchSpace(chip.dataset.space);
  });
  bar.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('[data-space]');
    if (chip) { e.preventDefault(); spaceMenu(spaceById(chip.dataset.space)); }
  });
  // drop a dragged tab on a space to move it there
  bar.addEventListener('dragover', (e) => {
    const chip = e.target.closest('[data-space]');
    if (B.dragId === null || !chip) return;
    e.preventDefault();
    $$('.space-chip.drop-target').forEach((c) => c.classList.remove('drop-target'));
    chip.classList.add('drop-target');
  });
  bar.addEventListener('dragleave', (e) => e.target.closest('.space-chip')?.classList.remove('drop-target'));
  bar.addEventListener('drop', (e) => {
    const chip = e.target.closest('[data-space]');
    if (B.dragId === null || !chip) return;
    e.preventDefault();
    chip.classList.remove('drop-target');
    moveTabToSpace(tabById(B.dragId), chip.dataset.space);
  });

  // two-finger horizontal swipe on the sidebar switches spaces
  let swipe = 0;
  let lockedUntil = 0;
  $('#sidebar').addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Date.now() < lockedUntil) return;
    swipe += e.deltaX;
    if (Math.abs(swipe) > 90) {
      cycleSpace(swipe > 0 ? 1 : -1);
      swipe = 0;
      lockedUntil = Date.now() + 450;
    }
  }, { passive: true });
}
