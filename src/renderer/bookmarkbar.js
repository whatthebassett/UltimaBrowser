// The bookmarks bar under the toolbar, like Chrome's: the bar's bookmarks and folders (a folder opens as a menu, its
// subfolders as submenus), a » menu for whatever doesn't fit, "Other bookmarks" on the right, editing on right-click,
// and dragging to rearrange, to drop into a folder, or to bookmark a tab dragged from the sidebar.
const BM = { nodes: [], dragId: null };
const bmNode = (id) => BM.nodes.find((n) => n.id === id) || null;
const bmChildren = (parent) => BM.nodes.filter((n) => n.parent === parent);
const bmShown = () => B.settings.showBookmarksBar !== false;

// a saved icon, else the site's own /favicon.ico (a letter when there is none)
function bmFavicon(n) {
  if (n.favicon) return n.favicon;
  try {
    const u = new URL(n.url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}/favicon.ico` : '';
  } catch { return ''; }
}

async function refreshBookmarkBar() {
  BM.nodes = await window.ultima.bookmarkTree();
  renderBookmarkBar();
}

function bmItemHtml(n) {
  if (n.type === 'folder') {
    return `<button class="bmb-item folder" data-bm="${esc(n.id)}" draggable="true" title="${esc(n.title)}">${icon('folder', 15)}<span>${esc(n.title)}</span></button>`;
  }
  return `<button class="bmb-item" data-bm="${esc(n.id)}" draggable="true" title="${esc(n.title)}\n${esc(n.url)}">
    ${favHtml(bmFavicon(n), n.url, n.title)}${n.title ? `<span>${esc(n.title)}</span>` : ''}</button>`;
}

function renderBookmarkBar() {
  const bar = $('#bookmark-bar');
  if (!bmShown()) return; // keeps what it shows while it slides shut
  const items = bmChildren('bar');
  bar.innerHTML = `
    <div class="bmb-items">${items.length ? items.map(bmItemHtml).join('')
      : `<span class="bmb-empty">For quick access, place your bookmarks here on the bookmarks bar.</span>
         <button class="bmb-link" data-bmb="import" title="Copy the bookmarks bar of Chrome, Edge, Brave or Vivaldi">Import bookmarks now…</button>`}</div>
    <button class="bmb-item bmb-more" data-bmb="more" hidden title="More bookmarks">»</button>
    ${bmChildren('other').length ? `<span class="bmb-sep"></span>${bmItemHtml({ ...bmNode('other'), title: 'Other bookmarks' }).replace('draggable="true"', '')}` : ''}`;
  fitBookmarkBar();
}

// Items that don't fit are hidden and listed in the » menu, as in Chrome.
function fitBookmarkBar() {
  const bar = $('#bookmark-bar');
  const box = $('.bmb-items', bar);
  const more = $('.bmb-more', bar);
  if (!box || !more) return;
  const items = $$('.bmb-item', box);
  items.forEach((el) => el.classList.remove('bmb-over'));
  box.style.marginLeft = '';
  more.hidden = box.scrollWidth <= box.clientWidth + 1;
  if (more.hidden) {
    // centered: a left margin as wide as "Other bookmarks" on the right centers the items on the whole bar (as much as fits)
    if (document.body.classList.contains('bm-bar-center') && box.children.length) {
      const right = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight) - box.getBoundingClientRect().right;
      const used = box.lastElementChild.getBoundingClientRect().right - box.firstElementChild.getBoundingClientRect().left;
      box.style.marginLeft = `${Math.max(0, Math.min(right, box.clientWidth - used))}px`;
    }
    return;
  }
  const limit = box.getBoundingClientRect().right;
  for (const el of items) if (el.getBoundingClientRect().right > limit + 0.5) el.classList.add('bmb-over');
}

// Menu items for a folder's contents; subfolders become submenus. Ids: "bm:<id>" opens, "all:<folder>" opens all.
function bmMenuItems(parent, only) {
  const kids = only || bmChildren(parent);
  const items = kids.map((n) => (n.type === 'folder'
    ? { label: n.title, icon: 'folder', submenu: bmMenuItems(n.id) }
    : { id: `bm:${n.id}`, label: n.title || n.url, leadHtml: favHtml(bmFavicon(n), n.url, n.title) }));
  if (!items.length) return [{ label: '(empty)', enabled: false }];
  if (only) return items;
  const urls = kids.filter((n) => n.type === 'url').length;
  return [...items, { type: 'separator' }, { id: `all:${parent}`, label: `Open all (${urls})`, icon: 'external', enabled: urls > 0 }];
}

async function openBookmarkFolderMenu(anchor, items) {
  const r = anchor.getBoundingClientRect();
  anchor.classList.add('open');
  const choice = await showMenu(items, { x: r.left, y: r.bottom + 3 });
  anchor.classList.remove('open');
  if (choice?.startsWith('bm:')) openBookmark(bmNode(choice.slice(3)), 'here');
  else if (choice?.startsWith('all:')) openAllBookmarks(choice.slice(4));
}

// how: 'here' (the current tab), 'tab' (new tab), 'background'
function openBookmark(n, how) {
  if (!n?.url) return;
  if (how === 'here' && activeTab()) navigate(activeTab(), n.url);
  else createTab({ url: n.url, title: n.title, activate: how !== 'background' });
}

async function openAllBookmarks(folderId) {
  const urls = bmChildren(folderId).filter((n) => n.type === 'url');
  if (urls.length > 15 && !await confirmDialog(`This opens ${urls.length} tabs.`, { title: `Open all ${urls.length} bookmarks?`, ok: 'Open all' })) return;
  urls.forEach((n, i) => createTab({ url: n.url, title: n.title, activate: i === 0 }));
}

// ---------- editing ----------
async function addBookmarkPage(parent = 'bar', index) {
  const tab = activeTab();
  const internal = !tab || isInternal(tab.url);
  const v = await editDialog({
    title: 'Add page',
    fields: [{ id: 'title', label: 'Name', value: internal ? '' : tab.title }, { id: 'url', label: 'URL', value: internal ? '' : tab.url }],
    ok: 'Save',
  });
  if (!v?.url.trim()) return;
  await window.ultima.addBookmark({ url: fixUrl(v.url.trim()), title: v.title.trim(), parent, index, favicon: !internal && v.url.trim() === tab.url ? tab.favicon : undefined });
}

async function addBookmarkFolder(parent = 'bar', index) {
  const v = await editDialog({ title: 'New folder', fields: [{ id: 'title', label: 'Name', value: 'New folder' }], ok: 'Save' });
  if (v?.title.trim()) await window.ultima.addBookmarkFolder({ title: v.title.trim(), parent, index });
}

async function editBookmark(n) {
  const fields = [{ id: 'title', label: 'Name', value: n.title }];
  if (n.type === 'url') fields.push({ id: 'url', label: 'URL', value: n.url });
  const v = await editDialog({ title: n.type === 'folder' ? 'Rename folder' : 'Edit bookmark', fields, ok: 'Save' });
  if (v) await window.ultima.updateBookmark({ id: n.id, title: v.title, url: v.url ? fixUrl(v.url.trim()) : undefined });
}

async function deleteBookmark(n) {
  if (n.type === 'folder') {
    const inside = BM.nodes.filter((x) => x.parent === n.id).length;
    if (inside && !await confirmDialog('Everything in it is deleted too.', { title: `Delete the “${n.title}” folder?`, ok: 'Delete', danger: true })) return;
    await window.ultima.removeBookmark(n.id);
    return;
  }
  const index = bmChildren(n.parent).indexOf(n);
  await window.ultima.removeBookmark(n.id);
  toast('Bookmark deleted', { label: 'Undo', run: () => window.ultima.addBookmark({ url: n.url, title: n.title, parent: n.parent, index, favicon: n.favicon }) });
}

// typed addresses without a scheme get https://
const fixUrl = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`);

function toggleBookmarksBar() {
  applySettings({ showBookmarksBar: !bmShown() });
  rerenderIfShowing('settings');
}

async function bookmarkBarMenu(e) {
  const el = e.target.closest('[data-bm]');
  const n = el && bmNode(el.dataset.bm);
  const isRoot = n && n.parent === null;
  // new items go after the one right-clicked, in its folder (as in Chrome)
  const parent = n && !isRoot ? n.parent : 'bar';
  const index = n && !isRoot ? bmChildren(n.parent).indexOf(n) + 1 : undefined;
  const common = [
    { id: 'add-page', label: 'Add page…', icon: 'plus' },
    { id: 'add-folder', label: 'Add folder…', icon: 'folder' },
    { type: 'separator' },
    { id: 'manager', label: 'Bookmark manager', icon: 'bookmark', shortcut: 'open-bookmarks' },
    { id: 'show', label: 'Show bookmarks bar', type: 'checkbox', checked: bmShown(), shortcut: 'toggle-bookmarks-bar' },
  ];
  let items;
  if (n?.type === 'url') {
    items = [
      { id: 'open-tab', label: 'Open in new tab', icon: 'external' },
      { id: 'open-bg', label: 'Open in background tab' },
      { type: 'separator' },
      { id: 'edit', label: 'Edit…' },
      { id: 'copy', label: 'Copy link', icon: 'link' },
      { id: 'delete', label: 'Delete', icon: 'trash', danger: true },
      { type: 'separator' }, ...common];
  } else if (n?.type === 'folder') {
    const urls = bmChildren(n.id).filter((x) => x.type === 'url').length;
    items = [
      { id: 'open-all', label: `Open all (${urls})`, icon: 'external', enabled: urls > 0 },
      { type: 'separator' },
      ...(isRoot ? [] : [{ id: 'edit', label: 'Rename…' }, { id: 'delete', label: 'Delete', icon: 'trash', danger: true }, { type: 'separator' }]),
      ...common];
  } else items = common;
  const choice = await showMenu(items, { x: e.clientX, y: e.clientY });
  switch (choice) {
    case 'open-tab': openBookmark(n, 'tab'); break;
    case 'open-bg': openBookmark(n, 'background'); break;
    case 'open-all': openAllBookmarks(n.id); break;
    case 'edit': editBookmark(n); break;
    case 'copy': navigator.clipboard.writeText(n.url); toast('Link copied'); break;
    case 'delete': deleteBookmark(n); break;
    case 'add-page': addBookmarkPage(parent, index); break;
    case 'add-folder': addBookmarkFolder(parent, index); break;
    case 'manager': runCommand('open-bookmarks'); break;
    case 'show': toggleBookmarksBar(); break;
    default: break;
  }
}

// Copies the bookmarks bar of Chrome (or Edge, Brave… when there are several) onto Ultima's.
async function importChromeBookmarkBar() {
  const sources = await window.ultima.bookmarkBarSources();
  if (!sources.length) return toast('No Chrome, Edge, Brave or Vivaldi bookmarks were found on this computer');
  let src = sources.find((s) => s.browser === 'chrome') || sources[0];
  if (sources.length > 1) {
    const r = $('#bookmark-bar').getBoundingClientRect();
    const id = await showMenu(sources.map((s) => ({ id: s.id, label: `${s.label} — ${s.profile}` })), { x: r.left + 12, y: r.bottom + 3 });
    if (!id) return undefined;
    src = sources.find((s) => s.id === id);
  }
  try {
    const added = await window.ultima.importBookmarkBar(src.id);
    return toast(added ? `Added ${added} bookmark${added === 1 ? '' : 's'} from ${src.label}’s bookmarks bar` : `Nothing new on ${src.label}’s bookmarks bar`);
  } catch (err) {
    return toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

// ---------- drag and drop ----------
// Where a drop lands: into a folder (its middle), or before/after an item on the bar.
function bmDropTarget(e) {
  const el = e.target.closest('.bmb-item[data-bm]');
  if (!el) return { parent: 'bar', index: undefined, el: null, mode: 'end' };
  const n = bmNode(el.dataset.bm);
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  if (n.type === 'folder' && (n.parent === null || (x > 0.25 && x < 0.75))) return { parent: n.id, index: undefined, el, mode: 'into' };
  const siblings = bmChildren('bar').filter((s) => s.id !== BM.dragId);
  const at = siblings.indexOf(n);
  return x < 0.5 ? { parent: 'bar', index: at, el, mode: 'before' } : { parent: 'bar', index: at + 1, el, mode: 'after' };
}

function initBookmarkBar() {
  const bar = $('#bookmark-bar');
  const clearMarks = () => $$('.drop-before, .drop-after, .drop-into', bar).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-bmb]')?.dataset.bmb;
    if (act === 'import') { importChromeBookmarkBar(); return; }
    if (act === 'more') {
      const hidden = $$('.bmb-over', bar).map((el) => bmNode(el.dataset.bm)).filter(Boolean);
      openBookmarkFolderMenu(e.target.closest('[data-bmb]'), bmMenuItems(null, hidden));
      return;
    }
    const el = e.target.closest('.bmb-item[data-bm]');
    const n = el && bmNode(el.dataset.bm);
    if (!n) return;
    if (n.type === 'folder') openBookmarkFolderMenu(el, bmMenuItems(n.id));
    else openBookmark(n, e.ctrlKey || e.metaKey ? 'background' : e.shiftKey ? 'tab' : 'here');
  });
  // middle-click opens in a background tab
  bar.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  bar.addEventListener('auxclick', (e) => {
    const n = e.button === 1 && bmNode(e.target.closest('.bmb-item[data-bm]')?.dataset.bm);
    if (!n) return;
    if (n.type === 'folder') openAllBookmarks(n.id); else openBookmark(n, 'background');
  });
  bar.addEventListener('contextmenu', (e) => { e.preventDefault(); bookmarkBarMenu(e); });

  bar.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.bmb-item[data-bm]');
    const n = el && bmNode(el.dataset.bm);
    if (!n || n.parent === null) { e.preventDefault(); return; }
    BM.dragId = n.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    if (n.url) e.dataTransfer.setData('text/uri-list', n.url);
    e.dataTransfer.setData('text/plain', n.url || n.title);
  });
  bar.addEventListener('dragend', () => { BM.dragId = null; clearMarks(); $$('.dragging', bar).forEach((x) => x.classList.remove('dragging')); });
  bar.addEventListener('dragover', (e) => {
    if (BM.dragId === null && B.dragId === null) return; // a bookmark, or a tab from the sidebar
    e.preventDefault();
    clearMarks();
    const t = bmDropTarget(e);
    if (t.el && t.el.dataset.bm !== BM.dragId) t.el.classList.add(`drop-${t.mode}`);
  });
  bar.addEventListener('dragleave', (e) => { if (!bar.contains(e.relatedTarget)) clearMarks(); });
  bar.addEventListener('drop', async (e) => {
    if (BM.dragId === null && B.dragId === null) return;
    e.preventDefault();
    clearMarks();
    const t = bmDropTarget(e);
    const dragId = BM.dragId;
    BM.dragId = null; // the bar redraws after the move, without the dragged button's dragend
    if (dragId !== null) {
      if (t.parent !== dragId) await window.ultima.moveBookmark({ id: dragId, parent: t.parent, index: t.index });
    } else {
      const tab = tabById(B.dragId);
      if (tab && !isInternal(tab.url)) await window.ultima.addBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon, parent: t.parent, index: t.index });
    }
  });

  new ResizeObserver(() => fitBookmarkBar()).observe(bar);
  // shown from the start without sliding; from then on showing and hiding it slides
  requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('instant')));
  window.ultima.on('bookmarks-changed', async () => { await refreshBookmarkBar(); updateChrome(); drawBookmarksPage(); });
  refreshBookmarkBar();
}
