// Choosing several tabs in the sidebar (or the horizontal tab strip) to act on together. Ctrl+click (⌘ on a Mac)
// adds a tab to the tabs you chose or takes it out (the first one also takes the tab you're on), Shift+click chooses
// every tab from the one you clicked last (or the one you're on) to this one, and Ctrl+Shift+click adds those to the
// rest. A plain click, Esc (rebindable), or a click anywhere else lets them go. The tabs you chose are B.selected
// (tabs.js draws them); right-clicking one of them opens the menu for all of them, and dragging one drags them all
// (tabdrag.js).
const SEL = { anchor: null }; // the tab Shift+click counts from

const chooseKey = (e) => (KEYS.platform === 'darwin' ? e.metaKey : e.ctrlKey);
// the rows the sidebar shows, top to bottom (left to right across the strip): what a Shift+click range runs along
const shownTabIds = () => [...new Set($$('#sidebar [data-tab]').map((el) => Number(el.dataset.tab)))];
// the tabs you chose, in the sidebar's order
const selectedTabs = () => B.tabs.filter((t) => B.selected.has(t.id));

// A click on a tab with Ctrl or Shift held: chooses tabs. Returns false for a plain click (which lets them go and
// opens the tab, as always).
function selectTabsByClick(tab, e) {
  const add = chooseKey(e);
  if (!tab || (!add && !e.shiftKey)) {
    clearTabSelection();
    SEL.anchor = tab?.id ?? null;
    return false;
  }
  // keys go to Ultima now (Esc lets the tabs go), not to the page you were in
  if (document.activeElement?.tagName === 'WEBVIEW') document.activeElement.blur();
  const shown = shownTabIds();
  if (e.shiftKey) {
    const from = shown.includes(SEL.anchor) ? SEL.anchor : B.activeId;
    const a = shown.indexOf(from);
    const b = shown.indexOf(tab.id);
    const range = a < 0 ? [tab.id] : shown.slice(Math.min(a, b), Math.max(a, b) + 1);
    if (!add) B.selected.clear();
    for (const id of range) B.selected.add(id);
  } else {
    // the first tab you add comes with the one you're on
    if (!B.selected.size && B.activeId !== tab.id && shown.includes(B.activeId)) B.selected.add(B.activeId);
    if (B.selected.has(tab.id)) B.selected.delete(tab.id); else B.selected.add(tab.id);
    SEL.anchor = tab.id;
  }
  renderTabs();
  return true;
}

// `render: false` takes the highlight off the rows as they are (mid-press, when the sidebar mustn't be redrawn)
function clearTabSelection({ render = true } = {}) {
  if (!B.selected.size) return;
  B.selected.clear();
  if (render) renderTabs();
  else $$('#sidebar .selected[data-tab]').forEach((el) => el.classList.remove('selected'));
}

// After each redraw: a chosen tab that closed, went to another space or into a folder that closed is let go.
function pruneTabSelection() {
  for (const id of B.selected) {
    if (!$(`#sidebar [data-tab="${id}"]`)) B.selected.delete(id);
  }
  if (B.selected.size === 1 && B.selected.has(B.activeId)) B.selected.clear(); // just the tab you're on: nothing chosen
  if (!B.selected.size) $$('#sidebar .selected[data-tab]').forEach((el) => el.classList.remove('selected'));
}

// Right-click on a tab: the menu for the tabs you chose when it's one of them, otherwise for that tab alone (which lets
// the others go).
function openTabMenu(tab) {
  if (!tab) return undefined;
  if (B.selected.size > 1 && B.selected.has(tab.id)) return tabSelectionMenu(selectedTabs());
  clearTabSelection();
  return tabContextMenu(tab);
}

// The tabs that go along when `tab` is dragged: all you chose, when it's one of them (otherwise they're let go).
function dragSelection(tab) {
  if (!tab || !B.selected.has(tab.id) || B.selected.size < 2) { clearTabSelection({ render: false }); return null; }
  return selectedTabs();
}

// Before tabs you're on leave (closing, unloading, moving away): open the tab that takes over from them (tabs.js).
function leaveTabs(tabs) {
  const cur = activeTab();
  if (!cur || !tabs.includes(cur)) return;
  const next = pickNextTab(cur, tabs);
  if (next) activateTab(next.id);
  else leaveEmpty(); // nothing stays open in the space (closing the last of them closes the window: tabs.js)
}

async function tabSelectionMenu(tabs) {
  const n = tabs.length;
  const loaded = tabs.filter((t) => t.webview);
  const allPinned = tabs.every((t) => t.zone === 'pinned');
  const movable = tabs.filter((t) => t.zone !== 'essential'); // to a space or a folder
  const regular = tabs.filter((t) => t.zone === 'normal'); // to a new window (pinned tabs and Essentials are in every window)
  const pages = tabs.filter((t) => !isInternal(t.url));
  const allMuted = tabs.every((t) => t.muted);
  const folders = B.folders.filter((f) => f.spaceId === B.activeSpaceId && movable.some((t) => t.folderId !== f.id));
  const splittable = n <= SPLIT_MAX && tabs.every((t) => canSplit(t) && !t.splitId);
  const choice = await showMenu([
    { id: 'reload', icon: 'reload', label: tabs.every(isUnloaded) ? 'Load tabs' : 'Reload tabs' },
    { id: 'unload', icon: 'unload', label: 'Unload tabs', enabled: loaded.length > 0 },
    { id: 'duplicate', icon: 'duplicate', label: 'Duplicate tabs' },
    { type: 'separator' },
    { id: 'pin', icon: 'pin', label: allPinned ? 'Unpin tabs' : 'Pin tabs', enabled: allPinned || regular.length > 0 },
    { id: 'folder-new', icon: 'folder', label: 'Add tabs to new folder', enabled: movable.length > 0 },
    ...(folders.length ? [{ label: 'Add tabs to folder', icon: 'folder', submenu: folders.map((f) => ({ id: `folder:${f.id}`, label: f.name || 'Folder', swatch: folderColor(f.color) })) }] : []),
    ...(splittable ? [{ id: 'split', icon: 'split', label: 'Open in split view' }] : []),
    { id: 'waypoints', icon: 'bookmark', label: 'Add tabs to Waypoints…', enabled: pages.length > 0 },
    { type: 'separator' },
    { id: 'mute', icon: allMuted ? 'volume' : 'mute', label: allMuted ? 'Unmute tabs' : 'Mute tabs' },
    { id: 'copy', icon: 'link', label: 'Copy links' },
    ...(B.private || !movable.length ? [] : [{
      label: 'Move to orbit',
      icon: 'layers',
      submenu: [
        ...B.spaces.map((s) => ({ id: `space:${s.id}`, label: `${s.icon}  ${s.name}`, enabled: s.id !== B.activeSpaceId })),
        { type: 'separator' },
        { id: 'space-new', label: 'New orbit' },
      ],
    }]),
    { id: 'window', icon: 'window', label: 'Move to new window', enabled: regular.length > 0 },
    { type: 'separator' },
    // (pinned tabs and Essentials only unload when closed: all of them, it's taking them out of the sidebar)
    tabs.every(isKept)
      ? { id: 'remove', icon: 'trash', danger: true, label: `Remove ${n} tabs from the sidebar` }
      : { id: 'close', icon: 'close', label: `Close ${n} tabs` },
  ]);
  if (!choice) return;
  if (choice.startsWith('folder:')) { for (const t of movable) addTabToFolder(t, choice.slice(7)); return; }
  if (choice.startsWith('space:')) { moveTabsToSpace(movable, choice.slice(6)); return; }
  switch (choice) {
    case 'reload': reloadTabs(tabs); break;
    case 'unload': leaveTabs(loaded); loaded.forEach(unloadTab); break;
    case 'duplicate': tabs.forEach((t) => duplicateTab(t, { activate: false })); break;
    case 'pin': pinTabs(tabs, !allPinned); break;
    case 'folder-new': newTabFolder(movable); break;
    case 'split': clearTabSelection(); splitTabsTogether(tabs); break;
    case 'waypoints': addTabsToWaypoints(pages); break;
    case 'mute': tabs.filter((t) => t.muted === allMuted).forEach(toggleMute); break;
    case 'copy': copyText(tabs.map((t) => t.url).join('\n'), 'Links copied'); break;
    case 'space-new': {
      const s = createSpace(false);
      if (!s?.id) break;
      moveTabsToSpace(movable, s.id, { say: false });
      switchSpace(s.id, movable[0]);
      startRenameSpace();
      break;
    }
    case 'window': moveTabsToNewWindow(regular); break;
    case 'close': closeTabs(tabs); break;
    case 'remove': closeTabs(tabs, { remove: true }); break;
    default: break;
  }
}

// A loaded tab reloads; an unloaded one loads, without opening it.
function reloadTabs(tabs) {
  for (const t of tabs) {
    if (ready(t)) t.webview.reload();
    else if (isUnloaded(t)) ensureWebview(t);
  }
  renderTabs();
}

// Pinned tabs and Essentials only unload, as their × does (unless `remove`); the rest close, their rows sliding away
// together.
function closeTabs(tabs, { remove = false } = {}) {
  const slide = animateTabClose(tabs.filter((t) => remove || !isKept(t)).map((t) => t.id));
  leaveTabs(tabs);
  for (const t of tabs) closeTab(t.id, { remove, animate: false });
  slide?.();
}

// Pinning pins the regular tabs (never private ones); unpinning, when they're all pinned, unpins them all.
function pinTabs(tabs, pin) {
  const moving = tabs.filter((t) => t.zone === (pin ? 'normal' : 'pinned'));
  if (pin && moving.some((t) => t.private)) toast('Private tabs can’t be pinned');
  for (const t of moving) if (!pin || !t.private) setZone(t, pin ? 'pinned' : 'normal');
}

function moveTabsToSpace(tabs, spaceId, { say = true } = {}) {
  const target = spaceById(spaceId);
  if (!target) return;
  leaveTabs(tabs);
  for (const t of tabs) moveTabToSpace(t, spaceId, { quiet: true });
  if (say) toast(`Moved ${tabs.length} tabs to ${target.icon} ${target.name}`, { label: 'Go', run: () => switchSpace(spaceId, tabs[0]) });
}

// One split view of them, in their order, opened.
function splitTabsTogether(tabs) {
  activateTab(tabs[0].id);
  for (let i = 1; i < tabs.length; i += 1) splitWith(tabs[i - 1], tabs[i], 'right');
}

// A new folder of Waypoints on the Waypoints bar, with a Waypoint for each tab.
async function addTabsToWaypoints(tabs) {
  const v = await editDialog({ title: `Add ${tabs.length} tabs to Waypoints`, fields: [{ id: 'name', label: 'Folder name', value: 'Saved tabs' }], ok: 'Add' });
  if (!v) return;
  const name = v.name.trim() || 'Saved tabs';
  const folder = await window.ultima.addBookmarkFolder({ title: name, parent: 'bar' }).catch(() => null);
  if (!folder?.id) { toast('Couldn’t add the Waypoints'); return; }
  for (const t of tabs) await window.ultima.addBookmark({ url: t.url, title: tabLabel(t) || t.url, favicon: t.favicon, parent: folder.id }).catch(() => {});
  toast(`Added ${tabs.length} Waypoints to “${name}”`);
}

// Moves regular tabs to a new window together, each with its page's history (main/tearoff.js). When they were all
// this window had of its own, the window goes too: it moved, in effect.
async function moveTabsToNewWindow(tabs) {
  if (!tabs.length) return;
  const cur = activeTab();
  const moved = await window.ultima.moveTabsToWindow(tabs.map((t) => ({ ...movingTab(t), active: t === cur }))).catch(() => false);
  if (!moved) return;
  const blank = (t) => t.zone === 'normal' && t.url === NEWTAB;
  if (B.tabs.every((t) => tabs.includes(t) || blank(t) || (isKept(t) && !t.webview))) { closeEmptyWindow(); return; }
  leaveTabs(tabs);
  for (const t of tabs) if (B.tabs.includes(t)) detachTab(t);
}

// In the window they moved to (app.js): the tabs, in their order, opening the one that was open (or the first).
// Those whose pages came along load now (their history waits only so long); the rest stay unloaded until opened.
function openMovedTabs(list) {
  const tabs = list.map((m) => {
    const tab = createTab({
      url: m.url || NEWTAB, title: m.title, name: m.name, favicon: m.favicon, spaceId: m.spaceId, private: m.private, restore: m.restore, activate: false, lazy: !m.restore,
    });
    Object.assign(tab, { zoom: Number(m.zoom) || 0, muted: Boolean(m.muted) });
    return tab;
  });
  activateTab((tabs[list.findIndex((m) => m.active)] || tabs[0]).id);
}

function initTabSelection() {
  // a click anywhere but on a tab (or the menu and dialogs its actions open) lets the chosen tabs go
  document.addEventListener('pointerdown', (e) => {
    if (B.selected.size && !e.target.closest?.('#sidebar [data-tab], .ctx-layer, .dlg-backdrop')) clearTabSelection();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (!B.selected.size || e.defaultPrevented || !matchesKey(e, 'tabs.clear-selection')) return;
    if (e.target.closest?.('input, textarea, [contenteditable], #palette, #findbar')) return;
    e.preventDefault();
    clearTabSelection();
  });
  // Shift+click would otherwise select the sidebar's text
  $('#sidebar').addEventListener('mousedown', (e) => {
    if (e.shiftKey && e.button === 0 && e.target.closest('[data-tab]') && !e.target.closest('.tab-rename')) e.preventDefault();
  });
}
