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
// Essentials are shared by every space, except a space with its own (space.ownEssentials): its Essentials
// (tab.essentialsOf = its id) are shown there alone, and the shared ones aren't.
const essentialsSpace = (id = B.activeSpaceId) => (spaceById(id)?.ownEssentials ? id : undefined);
// the space a tab belongs to: its own, or for an Essential the space whose own Essentials it is (none when shared)
const homeSpaceOf = (t) => (t.zone === 'essential' ? t.essentialsOf : t.spaceId);
// Tabs shown while a space is open: its Essentials (shared or its own), plus its own pinned and regular tabs.
const spaceTabs = (id = B.activeSpaceId) => B.tabs.filter((t) => (t.zone === 'essential' ? t.essentialsOf === essentialsSpace(id) : t.spaceId === id));
const ownTabs = (id) => B.tabs.filter((t) => t.zone !== 'essential' && t.spaceId === id);
const ownEssentials = (id) => B.tabs.filter((t) => t.zone === 'essential' && t.essentialsOf === id);
const partitionFor = (spaceId) => (spaceById(spaceId)?.separate ? `${SHARED_PARTITION}-space-${spaceId}` : SHARED_PARTITION);
// Shared Essentials use the shared sign-ins; a space's own Essentials use that space's. Private tabs browse in memory only.
const tabPartition = (tab) => (tab.private ? PRIVATE_PARTITION
  : tab.zone === 'essential' ? (tab.essentialsOf ? partitionFor(tab.essentialsOf) : SHARED_PARTITION) : partitionFor(tab.spaceId));

function initSpaces(saved, activeId) {
  // a private window has one space of its own, not yours (windows.js)
  if (B.private) saved = [privateSpace()];
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
  else { leaveEmpty(); renderTabs(); } // nothing open here: no tab is made for it (tabs.js)
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
  if (B.private) return toast('Private windows don’t have spaces');
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
  // with horizontal tabs (and the compact sidebar) the space's name isn't on screen to edit in place: a dialog asks
  if (!label || !label.getClientRects().length) {
    editDialog({ title: 'Rename space', fields: [{ id: 'name', label: 'Name', value: space.name }], ok: 'Rename' }).then((v) => {
      const name = v?.name?.trim().slice(0, 28);
      if (!name) return;
      space.name = name;
      renderSpaces();
      saveSession();
    });
    return;
  }
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
  // A webview can't change partition once attached, so reload this space's tabs into the new one (only those whose
  // partition changes: a private tab's stays the private one, and dropping it could end private browsing)
  for (const t of [...ownTabs(space.id), ...ownEssentials(space.id)]) if (t.webview && t.webview.getAttribute('partition') !== tabPartition(t)) dropWebview(t);
  const cur = activeTab();
  if (cur?.spaceId === space.id) activateTab(cur.id);
  renderTabs();
  renderSpaces();
  saveSession();
  toast(separate ? `${space.name} now keeps its own sign-ins and cookies` : `${space.name} now shares sign-ins with your other spaces`);
}

// Gives a space Essentials of its own instead of the shared ones, or takes them away. Its own Essentials stay with it
// when they go: they become its pinned tabs, so nothing is lost.
function setSpaceEssentials(space, own) {
  if (Boolean(space.ownEssentials) === own) return;
  space.ownEssentials = own;
  const kept = own ? [] : ownEssentials(space.id);
  for (const t of kept) Object.assign(t, { zone: 'pinned', essentialsOf: undefined, spaceId: space.id });
  // the page you're on may be an Essential this space no longer shows: you stay on it, and the sidebar shows its own
  sortZones();
  renderTabs();
  renderSpaces();
  saveSession();
  if (own) toast(`${space.name} now has its own Essentials. Drag tabs to the top of the sidebar to add them.`);
  else toast(`${space.name} uses the shared Essentials again${kept.length ? `; its own ${kept.length === 1 ? 'one is now a pinned tab' : `${kept.length} are now pinned tabs`} there` : ''}`);
}

// An Essential of a space that no longer has its own (turned off in another window, or a space deleted there) becomes a
// pinned tab of that space, or a shared Essential if the space is gone
function settleEssentials() {
  for (const t of B.tabs) {
    if (t.zone !== 'essential' || !t.essentialsOf || essentialsSpace(t.essentialsOf)) continue;
    if (spaceById(t.essentialsOf)) Object.assign(t, { zone: 'pinned', spaceId: t.essentialsOf, essentialsOf: undefined });
    else t.essentialsOf = undefined;
  }
}

async function deleteSpace(space) {
  if (B.spaces.length === 1) return toast('You need at least one space');
  const tabs = [...ownTabs(space.id), ...ownEssentials(space.id)];
  const closes = tabs.length ? `Its ${tabs.length} tab${tabs.length > 1 ? 's' : ''} will be closed. ` : '';
  const ok = await confirmDialog(`${closes}${space.ownEssentials ? 'Its own Essentials go with it; the shared ones are kept.' : 'Essentials are kept.'}`, { title: `Delete the “${space.name}” space?`, ok: 'Delete space', danger: true });
  if (!ok) return undefined;
  for (const t of tabs) dropWebview(t);
  B.tabs = B.tabs.filter((t) => !tabs.includes(t));
  B.spaces = B.spaces.filter((s) => s !== space);
  if (B.activeSpaceId === space.id) switchSpace(B.spaces[0].id);
  else { renderSpaces(); saveSession(); }
  return toast(`Deleted ${space.name}`);
}

// (`quiet`: no "Moved to" message, when several tabs move at once and one message says so: tabselect.js)
function moveTabToSpace(tab, spaceId, { quiet = false } = {}) {
  const target = spaceById(spaceId);
  if (!tab || !target || tab.spaceId === spaceId) return;
  const fromActive = tab.id === B.activeId;
  const before = tabPartition(tab);
  const next = fromActive ? pickNextTab(tab) : undefined;
  if (next) activateTab(next.id);
  if (tab.zone === 'essential') Object.assign(tab, { zone: 'pinned', essentialsOf: undefined }); // an essential sent to one space becomes a pinned tab there
  tab.spaceId = spaceId;
  tab.openerId = undefined;
  tab.folderId = undefined; // folders and split views belong to a space
  tab.splitId = undefined;
  if (tab.webview && tabPartition(tab) !== before) dropWebview(tab);
  if (next === null) leaveEmpty(); // nothing left open in the space it left
  sortZones();
  renderTabs();
  saveSession();
  if (!quiet) toast(`Moved to ${target.icon} ${target.name}`, { label: 'Go', run: () => switchSpace(spaceId, tab) });
}

async function spaceMenu(space = activeSpace(), pos = undefined) {
  if (B.private) return;
  const choice = await showMenu([
    { id: 'rename', icon: 'layers', label: 'Rename space' },
    { label: 'Icon', icon: 'sparkle', submenu: SPACE_ICONS.map((i) => ({ id: `icon:${i}`, label: i })) },
    { id: 'theme', icon: 'palette', label: 'Edit theme…', shortcut: 'space-theme' },
    { id: 'separate', type: 'checkbox', checked: space.separate, label: 'Separate sign-ins and cookies' },
    { id: 'essentials', type: 'checkbox', checked: Boolean(space.ownEssentials), label: 'Own Essentials' },
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
  else if (kind === 'essentials') setSpaceEssentials(space, !space.ownEssentials);
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
  // with horizontal tabs, one button for them all (the space you're in); in the sidebar, a chip for each
  if (tabsAcross()) renderSpaceSwitch(space);
  else {
    $('#space-bar').innerHTML = B.spaces.map((s, i) => `<button class="space-chip ${s.id === space.id ? 'on' : ''}" data-space="${s.id}"
      style="--chip:${s.color}" title="${esc(withKey(s.name, `space-${i + 1}`))}">${s.icon}</button>`).join('')
      + `<button class="space-chip add" data-act="new-space" title="${esc(withKey('New space', 'new-space'))}">${icon('plus', 14)}</button>`;
  }
}

// ---------- the space switcher (horizontal tabs) ----------
// The space you're in, as one button at the start of the tab strip: its icon and name in its color. Clicking it lists
// your spaces; scrolling or swiping over it flips to the next or previous one, its name sliding in from that side.
const SS = { shown: null };
function renderSpaceSwitch(space) {
  const bar = $('#space-bar');
  const i = B.spaces.indexOf(space);
  const before = SS.shown && B.spaces.findIndex((s) => s.id === SS.shown);
  bar.innerHTML = `<button class="space-switch" data-space-switch style="--chip:${space.color}" aria-haspopup="menu"
      title="${esc(`${space.name} — click for your spaces, scroll to switch`)}">
    <span class="ss-face"><span class="ss-icon">${space.icon}</span><span class="ss-name">${esc(space.name)}</span></span>
    <span class="ss-chev">${icon('forward', 12)}</span></button>`;
  if (SS.shown && SS.shown !== space.id && before >= 0 && !reducedMotion()) {
    const face = $('.ss-face', bar);
    face.style.setProperty('--ss-from', i > before ? '12px' : '-12px');
    face.classList.add('ss-in');
  }
  SS.shown = space.id;
}

// Every space (its color, icon and name, a tick on the one you're in), then New space and the options of this one.
async function spaceSwitchMenu() {
  const btn = $('[data-space-switch]');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.classList.add('open');
  const current = activeSpace();
  const choice = await showMenu([
    ...B.spaces.map((s, i) => ({ id: `space:${s.id}`, type: 'checkbox', checked: s.id === current.id, swatch: s.color, label: `${s.icon}  ${s.name}`, shortcut: `space-${i + 1}` })),
    { type: 'separator' },
    { id: 'new', icon: 'plus', label: 'New space', shortcut: 'new-space' },
    { id: 'options', icon: 'more', label: `${current.name} options…` },
  ], { x: r.left, y: r.bottom + 6 });
  btn.classList.remove('open');
  if (choice?.startsWith('space:')) switchSpace(choice.slice(6));
  else if (choice === 'new') createSpace();
  else if (choice === 'options') spaceMenu(current, { x: r.left, y: r.bottom + 6 });
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
    if (e.target.closest('[data-space-switch]')) { spaceSwitchMenu(); return; }
    const chip = e.target.closest('.space-chip');
    if (!chip) return;
    if (chip.dataset.act === 'new-space') createSpace();
    else switchSpace(chip.dataset.space);
  });
  bar.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('[data-space]');
    if (chip) { e.preventDefault(); spaceMenu(spaceById(chip.dataset.space)); }
    else if (e.target.closest('[data-space-switch]')) { e.preventDefault(); spaceMenu(activeSpace()); }
  });
  // scrolling or a two-finger swipe over the switcher flips through the spaces (a notch, or a swipe's worth, at a time)
  let flip = 0;
  let flipLockedUntil = 0;
  bar.addEventListener('wheel', (e) => {
    if (!e.target.closest('[data-space-switch]')) return;
    e.preventDefault();
    if (Date.now() < flipLockedUntil) return;
    flip += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(flip) >= 40) {
      cycleSpace(flip > 0 ? 1 : -1);
      flip = 0;
      flipLockedUntil = Date.now() + 320;
    }
  }, { passive: false });
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
    if (tabsAcross()) return; // (across the top, sideways scrolls the tabs)
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Date.now() < lockedUntil) return;
    swipe += e.deltaX;
    if (Math.abs(swipe) > 90) {
      cycleSpace(swipe > 0 ? 1 : -1);
      swipe = 0;
      lockedUntil = Date.now() + 450;
    }
  }, { passive: true });
}
