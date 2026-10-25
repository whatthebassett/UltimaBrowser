// Tab folders: Chrome's tab groups, for vertical tabs. A folder has a name and a color, belongs to one space, holds
// regular tabs (kept side by side in the sidebar) and collapses to its header. Like Chrome's groups, a folder goes
// away when its last tab does.
B.folders = []; // { id, spaceId, name, color, collapsed }

// Chrome's group colors: [dark theme, light theme]
const FOLDER_COLORS = {
  gray: ['#bdc1c6', '#5f6368'], blue: ['#8ab4f8', '#1a73e8'], red: ['#f28b82', '#d93025'], yellow: ['#fdd663', '#e8a600'],
  green: ['#81c995', '#188038'], pink: ['#ff8bcb', '#d01884'], purple: ['#c58af9', '#9334e6'], cyan: ['#78d9ec', '#007b83'],
  orange: ['#fcad70', '#fa7b17'],
};
const COLOR_NAMES = { gray: 'Gray', blue: 'Blue', red: 'Red', yellow: 'Yellow', green: 'Green', pink: 'Pink', purple: 'Purple', cyan: 'Cyan', orange: 'Orange' };
const folderById = (id) => B.folders.find((f) => f.id === id) || null;
const folderColor = (key) => (FOLDER_COLORS[key] || FOLDER_COLORS.gray)[document.documentElement.dataset.theme === 'light' ? 1 : 0];
const folderTabs = (id) => B.tabs.filter((t) => t.folderId === id);

function initTabFolders(saved) {
  B.folders = (Array.isArray(saved) ? saved : [])
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => ({ id: f.id, spaceId: f.spaceId, name: String(f.name || ''), color: FOLDER_COLORS[f.color] ? f.color : 'gray', collapsed: Boolean(f.collapsed) }));
}

// Keeps folders sound: only regular tabs of the folder's space, each folder's tabs together (where its first tab is),
// and no empty folders.
function normalizeTabFolders() {
  for (const t of B.tabs) {
    if (!t.folderId) continue;
    const f = folderById(t.folderId);
    if (t.zone !== 'normal' || !f || f.spaceId !== t.spaceId) t.folderId = undefined;
  }
  const placed = new Set();
  const out = [];
  for (const t of B.tabs) {
    if (!t.folderId) out.push(t);
    else if (!placed.has(t.folderId)) { placed.add(t.folderId); out.push(...folderTabs(t.folderId)); }
  }
  B.tabs = out;
  B.folders = B.folders.filter((f) => placed.has(f.id));
}

// The regular tabs of the sidebar, with folders. A collapsed folder still shows its tab when that's the one open.
function normalTabsHtml(tabs) {
  const done = new Set();
  let html = '';
  for (const t of tabs) {
    if (!t.folderId) {
      if (t.splitId && done.has(`s:${t.splitId}`)) continue;
      if (t.splitId) done.add(`s:${t.splitId}`);
      html += t.splitId ? tabRowsHtml(tabs.filter((x) => x.splitId === t.splitId)) : tabRow(t);
      continue;
    }
    if (done.has(t.folderId)) continue;
    done.add(t.folderId);
    const f = folderById(t.folderId);
    const inside = tabs.filter((x) => x.folderId === f.id);
    // collapsed, it still shows the tab that's open (and the rest of its split view)
    const open = tabById(B.activeId);
    const shown = f.collapsed ? inside.filter((x) => x === open || (open?.splitId && x.splitId === open.splitId)) : inside;
    html += `<div class="tfolder ${f.collapsed ? 'collapsed' : ''}" data-folder="${f.id}" style="--fc:${folderColor(f.color)}">
      <div class="tfolder-head" data-folder-head="${f.id}" title="${esc(f.name || 'Folder')} — ${inside.length} tab${inside.length === 1 ? '' : 's'}\n${f.collapsed ? 'Click to expand' : 'Click to collapse'}, right-click for more">
        <span class="tfolder-chev">${icon('forward', 12)}</span>
        <span class="tfolder-icon">${icon('folder', 15)}</span>
        <span class="tfolder-name">${esc(f.name || 'Folder')}</span>
        ${f.collapsed ? `<span class="tfolder-count">${inside.length}</span>` : ''}
      </div>
      <div class="tfolder-tabs">${tabRowsHtml(shown)}</div>
    </div>`;
  }
  return html;
}

function nextFolderColor(spaceId) {
  const used = new Set(B.folders.filter((f) => f.spaceId === spaceId).map((f) => f.color));
  const order = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'gray'];
  return order.find((c) => !used.has(c)) || order[B.folders.length % order.length];
}

// Puts `tab` at the end of folder `id` (making it a regular tab first, as only those go in folders).
function addTabToFolder(tab, id) {
  const f = folderById(id);
  if (!tab || !f) return;
  applyZone(tab, 'normal'); // an Essential coming down lands in the space you're in, the folder's
  // it joins at the end of the folder; the first tab of a new folder stays where it is
  const last = folderTabs(id).filter((t) => t !== tab).pop();
  if (last) {
    B.tabs.splice(B.tabs.indexOf(tab), 1);
    B.tabs.splice(B.tabs.indexOf(last) + 1, 0, tab);
  }
  tab.folderId = id;
  sortZones();
  renderTabs();
  saveSession();
}

async function newTabFolder(tab) {
  if (!tab || tab.zone === 'essential') return toast('Essentials can’t go in a folder');
  const f = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, spaceId: tab.spaceId, name: 'New folder', color: nextFolderColor(tab.spaceId), collapsed: false };
  B.folders.push(f);
  addTabToFolder(tab, f.id);
  const v = await editDialog({ title: 'New tab folder', fields: [{ id: 'name', label: 'Name', value: f.name }], ok: 'Save' });
  if (v?.name.trim()) { f.name = v.name.trim(); renderTabs(); saveSession(); }
  return f;
}

// Out of its folder, the tab goes just after it (as in Chrome).
function removeTabFromFolder(tab) {
  if (!tab?.folderId) return;
  const last = folderTabs(tab.folderId).filter((t) => t !== tab).pop();
  tab.folderId = undefined;
  if (last) {
    B.tabs.splice(B.tabs.indexOf(tab), 1);
    B.tabs.splice(B.tabs.indexOf(last) + 1, 0, tab);
  }
  renderTabs();
  saveSession();
}

function toggleFolder(id) {
  const f = folderById(id);
  if (!f) return;
  f.collapsed = !f.collapsed;
  renderTabs();
  saveSession();
}

async function renameFolder(f) {
  const v = await editDialog({ title: 'Rename folder', fields: [{ id: 'name', label: 'Name', value: f.name }], ok: 'Save' });
  if (v) { f.name = v.name.trim(); renderTabs(); saveSession(); }
}

function ungroupFolder(f) {
  for (const t of folderTabs(f.id)) t.folderId = undefined;
  renderTabs();
  saveSession();
}

async function closeFolder(f) {
  const tabs = folderTabs(f.id);
  if (tabs.length > 1 && !await confirmDialog(`Its ${tabs.length} tabs are closed.`, { title: `Close the “${f.name || 'Folder'}” folder?`, ok: 'Close folder', danger: true })) return;
  for (const t of tabs) closeTab(t.id);
}

async function folderMenu(f, pos) {
  const choice = await showMenu([
    { id: 'new-tab', label: 'New tab in folder', icon: 'plus' },
    { id: 'rename', label: 'Rename…' },
    { label: 'Color', icon: 'palette', submenu: Object.keys(FOLDER_COLORS).map((c) => ({ id: `color:${c}`, label: COLOR_NAMES[c], swatch: folderColor(c), type: 'checkbox', checked: f.color === c })) },
    { id: 'toggle', label: f.collapsed ? 'Expand' : 'Collapse', icon: f.collapsed ? 'arrowDown' : 'arrowUp' },
    { type: 'separator' },
    { id: 'ungroup', label: 'Ungroup (keep the tabs)', icon: 'layers' },
    { id: 'close', label: 'Close folder', icon: 'close', danger: true },
  ], pos);
  if (choice?.startsWith('color:')) { f.color = choice.slice(6); renderTabs(); saveSession(); return; }
  switch (choice) {
    case 'new-tab': {
      if (f.collapsed) f.collapsed = false;
      const last = folderTabs(f.id).pop();
      createTab({ index: last ? B.tabs.indexOf(last) + 1 : undefined, spaceId: f.spaceId, folderId: f.id });
      break;
    }
    case 'rename': renameFolder(f); break;
    case 'toggle': toggleFolder(f.id); break;
    case 'ungroup': ungroupFolder(f); break;
    case 'close': closeFolder(f); break;
    default: break;
  }
}

// Menu entries for a tab's own right-click menu.
function tabFolderMenuItems(tab) {
  if (tab.zone === 'essential') return [];
  const others = B.folders.filter((f) => f.spaceId === tab.spaceId && f.id !== tab.folderId);
  return [
    { id: 'folder-new', icon: 'folder', label: 'Add tab to new folder', shortcut: 'tab-folder-new' },
    ...(others.length ? [{ label: 'Add tab to folder', icon: 'folder', submenu: others.map((f) => ({ id: `folder:${f.id}`, label: f.name || 'Folder', swatch: folderColor(f.color) })) }] : []),
    ...(tab.folderId ? [{ id: 'folder-remove', icon: 'minus', label: 'Remove from folder', shortcut: 'tab-folder-remove' }] : []),
  ];
}

// returns true when the choice was a folder one
function runTabFolderChoice(tab, choice) {
  if (choice === 'folder-new') newTabFolder(tab);
  else if (choice === 'folder-remove') removeTabFromFolder(tab);
  else if (choice?.startsWith('folder:')) addTabToFolder(tab, choice.slice(7));
  else return false;
  return true;
}

// Moves a whole folder (all its tabs, in order) just before `before` (a tab), or to the end of the regular tabs.
function placeFolderBefore(id, before) {
  const tabs = folderTabs(id);
  if (!tabs.length || tabs.includes(before)) return;
  B.tabs = B.tabs.filter((t) => !tabs.includes(t));
  B.tabs.splice(before ? B.tabs.indexOf(before) : B.tabs.length, 0, ...tabs);
  renderTabs();
  saveSession();
}

function initTabFolderUi() {
  const list = $('#tabs');
  list.addEventListener('click', (e) => {
    const head = e.target.closest('[data-folder-head]');
    if (head) toggleFolder(head.dataset.folderHead);
  });
  list.addEventListener('contextmenu', (e) => {
    const head = e.target.closest('[data-folder-head]');
    if (!head) return;
    e.preventDefault();
    folderMenu(folderById(head.dataset.folderHead), { x: e.clientX, y: e.clientY });
  });
}
