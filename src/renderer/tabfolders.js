// Tab folders: Chrome's tab groups, for vertical tabs. A folder has a name and a color, belongs to one space, holds
// either regular tabs or pinned tabs (kept side by side in the sidebar) and collapses to its header. Like Chrome's
// groups, a folder goes away when its last tab does. Folders of regular tabs belong to their window; pinned folders,
// like pinned tabs, are in every window's sidebar (windows.js).
B.folders = []; // { id, spaceId, name, color, collapsed, zone: 'normal' | 'pinned', auto?, autoName? } (auto: autogroup.js)
// set while many tabs are added at once (restoring, another window's sidebar): a folder whose tabs aren't there yet stays
let holdFolders = false;

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
    .map(cleanFolder);
}

const cleanFolder = (f) => ({
  id: f.id, spaceId: f.spaceId, name: String(f.name || ''), color: FOLDER_COLORS[f.color] ? f.color : 'gray', collapsed: Boolean(f.collapsed), zone: f.zone === 'pinned' ? 'pinned' : 'normal',
  ...(typeof f.auto === 'string' ? { auto: f.auto, autoName: String(f.autoName || '') } : {}), // an automatic group (autogroup.js)
});

// Runs fn, which adds many tabs, without dropping the folders their tabs are still on the way to.
function withFoldersHeld(fn) {
  holdFolders = true;
  try { return fn(); } finally { holdFolders = false; }
}

// Keeps folders sound: only tabs of the folder's kind (regular or pinned) and space, each folder's tabs together
// (where its first tab is), and no empty folders.
function normalizeTabFolders() {
  for (const t of B.tabs) {
    if (!t.folderId) continue;
    const f = folderById(t.folderId);
    if (!f || f.zone !== t.zone || f.spaceId !== t.spaceId) t.folderId = undefined;
  }
  const placed = new Set();
  const out = [];
  for (const t of B.tabs) {
    if (!t.folderId) out.push(t);
    else if (!placed.has(t.folderId)) { placed.add(t.folderId); out.push(...folderTabs(t.folderId)); }
  }
  B.tabs = out;
  if (!holdFolders) B.folders = B.folders.filter((f) => placed.has(f.id));
}

// Regular or pinned tabs of the sidebar, with folders. A collapsed folder still shows its tab when that's the one open.
function tabListHtml(tabs) {
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
    // (--n and --s: how many lone tabs and split views it shows, which size it in the horizontal tab strip)
    const splits = new Set(shown.filter((x) => x.splitId).map((x) => x.splitId)).size;
    const lone = shown.filter((x) => !x.splitId).length;
    html += `<div class="tfolder ${f.collapsed ? 'collapsed' : ''}" data-folder="${f.id}" style="--fc:${folderColor(f.color)}; --n:${lone}; --s:${splits}">
      <div class="tfolder-head" data-folder-head="${f.id}" title="${esc(f.name || 'Folder')} — ${inside.length} tab${inside.length === 1 ? '' : 's'}\n${f.collapsed ? 'Click to expand' : 'Click to collapse'}, right-click for more">
        <span class="tfolder-chev">${icon('forward', 12)}</span>
        <span class="tfolder-icon">${icon('folder', 15)}</span>
        <span class="tfolder-name">${esc(f.name || 'Folder')}</span>
        ${f.collapsed ? `<span class="tfolder-count">${inside.length}</span>` : ''}
        <button class="tfolder-add" data-folder-add title="New tab in this folder">${icon('plus', 14)}</button>
      </div>
      <div class="tfolder-tabs">${tabRowsHtml(shown)}</div>
    </div>`;
  }
  return html;
}

// In the horizontal tab strip a folder's label never shrinks, so left alone its tabs would give up the whole folder's
// share when the strip runs out of room. Each folder shrinks at the rate its tabs alone would, so they narrow like the
// rest.
function sizeStripFolders() {
  if (!document.body.classList.contains('htabs')) return;
  for (const f of $$('#tabs .tfolder')) {
    // the tabs' full width, as styles.css sizes .tfolder-tabs
    const tabs = Number(f.style.getPropertyValue('--n')) * 222 + Number(f.style.getPropertyValue('--s')) * 242 - 2;
    const label = $('.tfolder-head', f).offsetWidth + 2;
    f.style.flexShrink = tabs > 0 ? (tabs / (tabs + label)).toFixed(3) : '';
  }
}

function nextFolderColor(spaceId) {
  const used = new Set(B.folders.filter((f) => f.spaceId === spaceId).map((f) => f.color));
  const order = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'gray'];
  return order.find((c) => !used.has(c)) || order[B.folders.length % order.length];
}

// Puts `tab` at the end of folder `id` (making it a regular or pinned tab first, as the folder is).
function addTabToFolder(tab, id) {
  const f = folderById(id);
  if (!tab || !f) return;
  if (tab.private && f.zone === 'pinned') { toast('Private tabs can’t be pinned'); renderTabs(); return; }
  applyZone(tab, f.zone); // an Essential coming down lands in the space you're in, the folder's
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

// `tabs`: one tab, or several (chosen in the sidebar, tabselect.js) that go in together, in their order
async function newTabFolder(tabs) {
  tabs = [].concat(tabs).filter(Boolean);
  const tab = tabs[0];
  if (!tab || tabs.some((t) => t.zone === 'essential')) return toast('Essentials can’t go in a folder');
  // pinned tabs' folder is a pinned folder (with any regular tab among them, a regular one)
  const zone = tabs.every((t) => t.zone === 'pinned') ? 'pinned' : 'normal';
  const f = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, spaceId: tab.spaceId, name: 'New folder', color: nextFolderColor(tab.spaceId), collapsed: false, zone };
  B.folders.push(f);
  for (const t of tabs) addTabToFolder(t, f.id);
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
  const box = () => $(`.tfolder[data-folder="${id}"] .tfolder-tabs`);
  const before = box();
  const closing = folderSlides.get(id); // clicked again while it was closing: it opens from what's staying
  folderSlides.delete(id);
  const was = { size: before ? sizeAcross(before) : 0, tabs: closing?.kept || new Set(before ? $$('.tab[data-tab]', before).map((el) => el.dataset.tab) : []) };
  f.collapsed = !f.collapsed;
  saveSession();
  if (f.collapsed && before) slideFolderClosed(f, before);
  else { renderTabs(); if (box()) slideFolderOpen(box(), was); }
}

// Opening or closing a folder slides its tabs in or out instead of jumping: each tab that appears grows from nothing
// and fades in, each that goes shrinks away (closing redraws the sidebar once they're gone). Down the sidebar they
// grow taller; in the horizontal tab strip, wider, and the folder's underline with them.
const FOLDER_SLIDE = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const folderSlides = new Map(); // folder id → its closing slide, until it redraws
const sizeAcross = (el) => (tabsAcross() ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
// the blocks of a folder's tabs: a tab, or a split view (which comes and goes as one)
const folderBlocks = (box) => [...new Set($$('.tab[data-tab]', box).map((el) => el.closest('.tsplit') || el))];
const blockTabs = (el) => (el.matches('.tab') ? [el.dataset.tab] : $$('.tab[data-tab]', el).map((t) => t.dataset.tab));

// (r: its size where it ends up, or starts from; measured before anything around it starts moving)
function slideBlock(el, appearing, r = el.getBoundingClientRect()) {
  const across = tabsAcross();
  const gone = across
    ? { flexBasis: '0px', width: '0px', minWidth: '0px', paddingLeft: '0px', paddingRight: '0px', marginRight: '-2px', opacity: 0 }
    : { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-2px', opacity: 0 };
  const full = across ? { flexBasis: `${r.width}px`, width: `${r.width}px`, minWidth: `${r.width}px`, opacity: 1 } : { height: `${r.height}px`, minHeight: `${r.height}px`, opacity: 1 };
  el.style.overflow = 'hidden';
  el.style.flexShrink = '0';
  const a = el.animate(appearing ? [gone, full] : [full, gone], { ...FOLDER_SLIDE, fill: appearing ? 'none' : 'forwards' });
  if (appearing) a.onfinish = a.oncancel = () => { el.style.overflow = ''; el.style.flexShrink = ''; };
  return a;
}

// in the tab strip the folder's tabs part has a set width (styles.css), so it's slid along with them
function slideStripWidth(box, from, to, closing) {
  if (!tabsAcross() || from === to) return null;
  box.style.overflow = 'hidden';
  const a = box.animate([{ width: `${from}px` }, { width: `${to}px` }], { ...FOLDER_SLIDE, fill: closing ? 'forwards' : 'none' });
  if (!closing) a.onfinish = a.oncancel = () => { box.style.overflow = ''; }; // (closing, the redraw replaces it)
  return a;
}

function slideFolderOpen(box, was) {
  const blocks = folderBlocks(box).filter((el) => !blockTabs(el).some((t) => was.tabs.has(t)));
  if (!blocks.length) return;
  const sizes = blocks.map((el) => el.getBoundingClientRect());
  slideStripWidth(box, was.size, sizeAcross(box));
  blocks.forEach((el, i) => slideBlock(el, true, sizes[i]));
}

function slideFolderClosed(f, box) {
  // what stays: the open tab, if it's in here (and the rest of its split view)
  const open = tabById(B.activeId);
  const stays = (el) => blockTabs(el).some((t) => Number(t) === open?.id || (open?.splitId && tabById(Number(t))?.splitId === open.splitId));
  const blocks = folderBlocks(box);
  const going = blocks.filter((el) => !stays(el));
  const kept = blocks.filter(stays);
  if (!going.length) { renderTabs(); return; }
  box.parentElement.classList.add('collapsed'); // its chevron turns as they go
  const to = kept.reduce((w, el) => w + el.getBoundingClientRect().width, 0) + Math.max(0, kept.length - 1) * 2;
  const anims = [slideStripWidth(box, box.getBoundingClientRect().width, to, true), ...going.map((el) => slideBlock(el, false))].filter(Boolean);
  const slide = { kept: new Set(kept.flatMap(blockTabs)) };
  folderSlides.set(f.id, slide);
  Promise.all(anims.map((a) => a.finished)).catch(() => {}).then(() => {
    if (folderSlides.get(f.id) !== slide) return; // opened again meanwhile
    folderSlides.delete(f.id);
    renderTabs();
  });
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

// A pinned folder's tabs are taken out of the sidebar (closing a pinned tab would only unload it).
async function closeFolder(f) {
  const tabs = folderTabs(f.id);
  const pinned = f.zone === 'pinned';
  if (tabs.length > 1 && !await confirmDialog(`Its ${tabs.length} tabs are ${pinned ? 'unpinned and ' : ''}closed.`, { title: `Close the “${f.name || 'Folder'}” folder?`, ok: 'Close folder', danger: true })) return;
  for (const t of tabs) closeTab(t.id, { remove: pinned });
}

// Pins a folder (its tabs become pinned tabs) or unpins it (they become regular tabs), and puts it just before
// `before` (a tab), or at the end of that area.
function moveFolder(id, zone, before) {
  const f = folderById(id);
  const tabs = folderTabs(id);
  if (!f || !tabs.length || tabs.includes(before)) return;
  if (zone === 'pinned' && tabs.some((t) => t.private)) { toast('Private tabs can’t be pinned'); renderTabs(); return; }
  if (f.zone !== zone) {
    f.zone = zone;
    for (const t of tabs) applyZone(t, zone);
  }
  B.tabs = B.tabs.filter((t) => !tabs.includes(t));
  if (before) B.tabs.splice(B.tabs.indexOf(before), 0, ...tabs);
  else if (zone === 'pinned') B.tabs.splice(B.tabs.findLastIndex((t) => t.zone !== 'normal') + 1, 0, ...tabs);
  else B.tabs.push(...tabs);
  sortZones();
  renderTabs();
  saveSession();
}

// Unloads every tab in a pinned folder: they stay in the sidebar, on their pinned links.
function unloadFolder(f) {
  for (const t of folderTabs(f.id)) unloadTab(t);
}

async function folderMenu(f, pos) {
  const pinned = f.zone === 'pinned';
  const choice = await showMenu([
    // a pinned tab belongs to a link, so a pinned folder has no "new tab" in it
    ...(pinned ? [] : [{ id: 'new-tab', label: 'New tab in folder', icon: 'plus' }]),
    { id: 'rename', label: 'Rename…' },
    { label: 'Color', icon: 'palette', submenu: Object.keys(FOLDER_COLORS).map((c) => ({ id: `color:${c}`, label: COLOR_NAMES[c], swatch: folderColor(c), type: 'checkbox', checked: f.color === c })) },
    { id: 'toggle', label: f.collapsed ? 'Expand' : 'Collapse', icon: f.collapsed ? 'arrowDown' : 'arrowUp' },
    { id: 'pin', label: pinned ? 'Unpin folder' : 'Pin folder', icon: 'pin' },
    ...(pinned ? [{ id: 'unload', label: 'Unload tabs', icon: 'unload' }] : []),
    { type: 'separator' },
    { id: 'ungroup', label: 'Ungroup (keep the tabs)', icon: 'layers' },
    { id: 'close', label: pinned ? 'Unpin and close folder' : 'Close folder', icon: 'close', danger: true },
  ], pos);
  if (choice?.startsWith('color:')) { f.color = choice.slice(6); renderTabs(); saveSession(); return; }
  switch (choice) {
    case 'new-tab': newTabInFolder(f); break;
    case 'rename': renameFolder(f); break;
    case 'toggle': toggleFolder(f.id); break;
    case 'pin': moveFolder(f.id, pinned ? 'normal' : 'pinned'); break; // at the end, as a pinned or unpinned tab goes
    case 'unload': unloadFolder(f); break;
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
// (a tab in a split view takes the split along: its tabs share one folder)
function runTabFolderChoice(tab, choice) {
  const tabs = tab.splitId ? splitTabs(tab.splitId) : [tab];
  if (choice === 'folder-new') newTabFolder(tabs.length > 1 ? tabs : tab);
  else if (choice === 'folder-remove') tabs.forEach((t) => removeTabFromFolder(t));
  else if (choice?.startsWith('folder:')) tabs.forEach((t) => addTabToFolder(t, choice.slice(7)));
  else return false;
  return true;
}

// A new tab at the end of the folder (a pinned folder's is a pinned tab), opened.
function newTabInFolder(f) {
  if (!f) return;
  if (f.collapsed) f.collapsed = false;
  const last = folderTabs(f.id).pop();
  createTab({ index: last ? B.tabs.indexOf(last) + 1 : undefined, spaceId: f.spaceId, folderId: f.id, zone: f.zone });
}

function initTabFolderUi() {
  for (const list of [$('#pinned-list'), $('#tabs')]) {
    list.addEventListener('click', (e) => {
      const head = e.target.closest('[data-folder-head]');
      if (!head) return;
      if (e.target.closest('[data-folder-add]')) newTabInFolder(folderById(head.dataset.folderHead));
      else toggleFolder(head.dataset.folderHead);
    });
    list.addEventListener('contextmenu', (e) => {
      const head = e.target.closest('[data-folder-head]');
      if (!head) return;
      e.preventDefault();
      folderMenu(folderById(head.dataset.folderHead), { x: e.clientX, y: e.clientY });
    });
  }
}
