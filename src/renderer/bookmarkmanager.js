// The bookmarks page (ultima://bookmarks), like Chrome's bookmark manager: the folder tree on the left, the open
// folder's bookmarks and subfolders on the right, in their real order. Drag a row to reorder it, onto a folder (in the
// list, the tree or the path above the list) to move it in, or up onto the bookmarks bar; right-click for the rest.
// Shares BM.nodes and the editing helpers with the bookmarks bar.
const BMP = { folder: 'bar', query: '', open: new Set(['bar', 'other']), tab: null };

const bmpFolders = (parent) => bmChildren(parent).filter((n) => n.type === 'folder');
// the folder and the ones it is in, outermost first
const bmpPath = (id) => {
  const path = [];
  for (let n = bmNode(id); n; n = bmNode(n.parent)) path.unshift(n);
  return path;
};
// true when `id` is `ancestor` or anywhere inside it (a folder can't be dropped into itself)
const bmpWithin = (id, ancestor) => bmpPath(id).some((n) => n.id === ancestor);
const bmpSearching = () => BMP.query.trim() !== '';

function bmpMatches() {
  const tokens = BMP.query.toLowerCase().split(/\s+/).filter(Boolean);
  return BM.nodes.filter((n) => n.parent !== null && tokens.every((t) => `${n.title} ${n.url || ''}`.toLowerCase().includes(t)));
}

async function pageBookmarks(root, tab) {
  BMP.tab = tab;
  const star = keysFor('bookmark')[0];
  root.innerHTML = `<div class="page bm-page" id="bm-page"><h1>Bookmarks</h1>
    <p class="sub">${star ? `Press ${kbdHtml(star)} on any page to bookmark it.` : 'Use the star in the toolbar to bookmark a page.'} Drag bookmarks to rearrange them or move them into folders.</p>
    <div class="toolbar"><input class="field" id="bq" placeholder="Search bookmarks" spellcheck="false" value="${esc(BMP.query)}">
      <button class="btn" id="bnew-folder">${icon('folder')} New folder</button>
      <button class="btn" id="badd-page">${icon('plus')} Add page</button>
      <button class="btn" id="bimport">${icon('import')} Import</button></div>
    <div class="bm-layout"><nav class="bm-tree" id="btree" aria-label="Folders"></nav>
      <section class="bm-main"><div class="bm-crumbs" id="bcrumbs"></div><div class="list" id="blist"></div></section></div></div>`;
  const page = $('#bm-page');
  $('#bq').addEventListener('input', (e) => { BMP.query = e.target.value; drawBookmarksPage(); });
  $('#bq').addEventListener('keydown', (e) => { if (e.key === 'Escape' && BMP.query) { e.target.value = BMP.query = ''; drawBookmarksPage(); } });
  $('#bnew-folder').onclick = () => addBookmarkFolder(BMP.folder);
  $('#badd-page').onclick = () => addBookmarkPage(BMP.folder);
  $('#bimport').onclick = () => navigate(tab, 'ultima://import');
  page.addEventListener('click', bmpClick);
  page.addEventListener('mousedown', (e) => { if (e.button === 1 && e.target.closest('.bm-row')) e.preventDefault(); });
  page.addEventListener('auxclick', (e) => {
    const n = e.button === 1 && bmNode(e.target.closest('.bm-row')?.dataset.id);
    if (!n) return;
    if (n.type === 'folder') openAllBookmarks(n.id); else openBookmark(n, 'background');
  });
  page.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.bm-row, .bmt-item');
    if (!el && !e.target.closest('#blist')) return;
    e.preventDefault();
    if (el) bmpItemMenu(bmNode(el.dataset.id), { x: e.clientX, y: e.clientY });
    else bmpBlankMenu({ x: e.clientX, y: e.clientY });
  });
  bmpInitDrag(page);
  BM.nodes = await window.ultima.bookmarkTree();
  drawBookmarksPage();
}

// Redraws the page in place (keeping its scroll), e.g. after anything changes the bookmarks.
function drawBookmarksPage() {
  if (!$('#bm-page')) return;
  if (!bmNode(BMP.folder) || bmNode(BMP.folder).type !== 'folder') BMP.folder = 'bar';
  const q = BMP.query.trim();
  // the open folder is always visible in the tree
  for (const n of bmpPath(BMP.folder).slice(0, -1)) BMP.open.add(n.id);
  $('#btree').innerHTML = bmpTreeHtml(null, 0);

  const items = q ? bmpMatches() : bmChildren(BMP.folder);
  const count = `<span class="bm-count">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>`;
  $('#bcrumbs').innerHTML = q ? `<span class="bmc cur">Results for “${esc(q)}”</span>${count}`
    : bmpPath(BMP.folder).map((n, i, all) => (i === all.length - 1
      ? `<span class="bmc cur" data-drop-folder="${esc(n.id)}">${esc(n.title)}</span>`
      : `<button class="bmc" data-open-folder="${esc(n.id)}" data-drop-folder="${esc(n.id)}">${esc(n.title)}</button>${icon('forward', 12)}`)).join('') + count;

  $('#blist').innerHTML = items.length ? items.map((n) => bmpRowHtml(n, q)).join('')
    : `<div class="empty">${q ? 'Nothing matches' : 'This folder is empty — drag bookmarks here, or use Add page'}</div>`;
}

function bmpTreeHtml(parent, depth) {
  return bmpFolders(parent).map((f) => {
    const subs = bmpFolders(f.id).length > 0;
    const open = subs && BMP.open.has(f.id);
    const sel = f.id === BMP.folder && !bmpSearching();
    return `<div class="bmt-item ${sel ? 'sel' : ''}" data-id="${esc(f.id)}" data-drop-folder="${esc(f.id)}" ${f.parent !== null ? 'draggable="true"' : ''} style="--depth:${depth}" role="treeitem" aria-selected="${sel}" ${subs ? `aria-expanded="${open}"` : ''}>
      <button class="bmt-caret ${open ? 'open' : ''} ${subs ? '' : 'none'}" data-act="toggle" tabindex="-1" title="${open ? 'Collapse' : 'Expand'}">${icon('forward', 12)}</button>
      ${icon('folder', 15)}<span>${esc(f.title)}</span></div>${open ? bmpTreeHtml(f.id, depth + 1) : ''}`;
  }).join('');
}

function bmpRowHtml(n, q) {
  const where = q ? `<span class="meta" title="${esc(bmpPath(n.parent).map((p) => p.title).join(' › '))}">${icon('folder', 12)} ${esc(bmNode(n.parent)?.title)}</span>` : '';
  if (n.type === 'folder') {
    const inside = bmChildren(n.id).length;
    return `<div class="row bm-row folder" data-id="${esc(n.id)}" draggable="true">
      <span class="bm-ic">${icon('folder', 18)}</span>
      <div class="main"><div class="t">${highlight(n.title, q)}</div><div class="u">${inside ? `${inside} ${inside === 1 ? 'item' : 'items'}` : 'Empty'}</div></div>${where}
      <div class="acts"><button class="icon-btn" data-act="edit" title="Rename folder">${icon('edit', 15)}</button>
      <button class="icon-btn" data-act="more" title="More">${icon('more', 15)}</button></div></div>`;
  }
  return `<div class="row bm-row" data-id="${esc(n.id)}" draggable="true">
    <span class="bm-ic">${favHtml(bmFavicon(n), n.url, n.title)}</span>
    <div class="main"><div class="t">${highlight(n.title || n.url, q)}</div><div class="u">${highlight(n.url, q)}</div></div>${where}
    <div class="acts"><button class="icon-btn" data-act="tab" title="Open in new tab">${icon('external', 15)}</button>
    <button class="icon-btn" data-act="edit" title="Edit bookmark">${icon('edit', 15)}</button>
    <button class="icon-btn" data-act="more" title="More">${icon('more', 15)}</button></div></div>`;
}

function bmpShowFolder(id) {
  BMP.folder = id;
  BMP.open.add(id);
  if (bmpSearching()) { BMP.query = ''; $('#bq').value = ''; }
  drawBookmarksPage();
}

function bmpClick(e) {
  const crumb = e.target.closest('[data-open-folder]');
  if (crumb) { bmpShowFolder(crumb.dataset.openFolder); return; }
  const treeItem = e.target.closest('.bmt-item');
  if (treeItem) {
    const id = treeItem.dataset.id;
    if (e.target.closest('[data-act=toggle]')) {
      if (BMP.open.has(id)) BMP.open.delete(id); else BMP.open.add(id);
      // collapsing the folder that holds the open one shows the collapsed folder instead
      if (!BMP.open.has(id) && BMP.folder !== id && bmpWithin(BMP.folder, id)) BMP.folder = id;
      drawBookmarksPage();
    } else bmpShowFolder(id);
    return;
  }
  const row = e.target.closest('.bm-row');
  const n = row && bmNode(row.dataset.id);
  if (!n) return;
  const act = e.target.closest('[data-act]');
  if (act?.dataset.act === 'more') {
    const r = act.getBoundingClientRect();
    bmpItemMenu(n, { x: r.left, y: r.bottom + 3 });
  } else if (act?.dataset.act === 'edit') editBookmark(n);
  else if (act?.dataset.act === 'tab') openBookmark(n, 'background');
  else if (n.type === 'folder') bmpShowFolder(n.id);
  else if (e.target.closest('.main, .bm-ic')) openBookmark(n, e.ctrlKey || e.metaKey ? 'background' : e.shiftKey ? 'tab' : 'here');
}

// "Move to" submenu: every folder except the one being moved (and so everything inside it).
function bmpMoveMenu(n, parent = null) {
  return bmpFolders(parent).filter((f) => f.id !== n.id).map((f) => {
    const subs = bmpMoveMenu(n, f.id);
    const here = { id: `mv:${f.id}`, label: subs.length ? `Into “${f.title}”` : f.title, icon: 'folder', enabled: f.id !== n.parent };
    return subs.length ? { label: f.title, icon: 'folder', submenu: [here, { type: 'separator' }, ...subs] } : here;
  });
}

async function bmpMove(n, parent) {
  const from = { parent: n.parent, index: bmChildren(n.parent).indexOf(n) };
  if (!await window.ultima.moveBookmark({ id: n.id, parent })) return;
  toast(`Moved to ${bmNode(parent)?.title || 'folder'}`, { label: 'Undo', run: () => window.ultima.moveBookmark({ id: n.id, ...from }) });
}

async function bmpItemMenu(n, pos) {
  if (!n) return;
  const isRoot = n.parent === null;
  const searching = bmpSearching();
  let items;
  if (n.type === 'url') {
    items = [
      { id: 'open', label: 'Open', icon: 'globe' },
      { id: 'open-tab', label: 'Open in new tab', icon: 'external' },
      { id: 'open-bg', label: 'Open in background tab' },
      { type: 'separator' },
      { id: 'edit', label: 'Edit…', icon: 'edit' },
      { label: 'Move to', icon: 'folder', submenu: bmpMoveMenu(n) },
      ...(searching ? [{ id: 'reveal', label: 'Show in folder', icon: 'folder' }] : []),
      { id: 'copy', label: 'Copy link', icon: 'link' },
      { type: 'separator' },
      { id: 'delete', label: 'Delete', icon: 'trash', danger: true }];
  } else {
    const urls = bmChildren(n.id).filter((x) => x.type === 'url').length;
    items = [
      { id: 'show', label: 'Open folder', icon: 'folder' },
      { id: 'open-all', label: `Open all (${urls})`, icon: 'external', enabled: urls > 0 },
      { type: 'separator' },
      { id: 'add-page', label: 'Add page here…', icon: 'plus' },
      { id: 'add-folder', label: 'New folder here…', icon: 'folder' },
      ...(isRoot ? [] : [
        { type: 'separator' },
        { id: 'edit', label: 'Rename…', icon: 'edit' },
        { label: 'Move to', icon: 'folder', submenu: bmpMoveMenu(n) },
        { type: 'separator' },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true }])];
  }
  const choice = await showMenu(items, pos);
  if (choice?.startsWith('mv:')) { bmpMove(n, choice.slice(3)); return; }
  switch (choice) {
    case 'open': openBookmark(n, 'here'); break;
    case 'open-tab': openBookmark(n, 'tab'); break;
    case 'open-bg': openBookmark(n, 'background'); break;
    case 'open-all': openAllBookmarks(n.id); break;
    case 'show': bmpShowFolder(n.id); break;
    case 'reveal': bmpShowFolder(n.parent); break;
    case 'edit': editBookmark(n); break;
    case 'copy': copyText(n.url, 'Link copied'); break;
    case 'delete': deleteBookmark(n); break;
    case 'add-page': addBookmarkPage(n.id); break;
    case 'add-folder': addBookmarkFolder(n.id); break;
    default: break;
  }
}

// right-click on the empty part of the list
async function bmpBlankMenu(pos) {
  const choice = await showMenu([
    { id: 'add-page', label: 'Add page…', icon: 'plus' },
    { id: 'add-folder', label: 'New folder…', icon: 'folder' },
  ], pos);
  if (choice === 'add-page') addBookmarkPage(BMP.folder);
  else if (choice === 'add-folder') addBookmarkFolder(BMP.folder);
}

// ---------- drag and drop ----------
// Where a drop lands: into a folder (a tree item, a step of the path, or the middle of a folder row), before/after a
// row of the open folder, or at its end. Null when it can't go there (a folder into itself, or reordering search results).
function bmpDropTarget(e) {
  const id = BM.dragId;
  const box = e.target.closest('[data-drop-folder]');
  if (box) return bmpWithin(box.dataset.dropFolder, id) ? null : { parent: box.dataset.dropFolder, el: box, mode: 'into' };
  if (bmpSearching() || !e.target.closest('#blist')) return null;
  const rows = $$('#blist .bm-row');
  const row = e.target.closest('.bm-row');
  if (!row) {
    const last = rows[rows.length - 1];
    if (last?.dataset.id === id) return null;
    return { parent: BMP.folder, el: last || $('#blist'), mode: last ? 'after' : 'into' };
  }
  const n = bmNode(row.dataset.id);
  if (n.id === id) return null;
  const r = row.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (n.type === 'folder' && y > 0.25 && y < 0.75) return bmpWithin(n.id, id) ? null : { parent: n.id, el: row, mode: 'into' };
  const at = bmChildren(BMP.folder).filter((s) => s.id !== id).indexOf(n);
  return y < 0.5 ? { parent: BMP.folder, index: at, el: row, mode: 'before' } : { parent: BMP.folder, index: at + 1, el: row, mode: 'after' };
}

function bmpInitDrag(page) {
  const clearMarks = () => $$('.drop-before, .drop-after, .drop-into', page).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
  let expand = { id: null, timer: null };
  const stopExpand = () => { clearTimeout(expand.timer); expand = { id: null, timer: null }; };

  page.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('.bm-row, .bmt-item[draggable]');
    const n = el && bmNode(el.dataset.id);
    if (!n || n.parent === null) return;
    BM.dragId = n.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    if (n.url) e.dataTransfer.setData('text/uri-list', n.url);
    e.dataTransfer.setData('text/plain', n.url || n.title);
  });
  page.addEventListener('dragend', () => {
    BM.dragId = null;
    stopExpand();
    clearMarks();
    $$('.dragging', page).forEach((x) => x.classList.remove('dragging'));
  });
  page.addEventListener('dragover', (e) => {
    if (BM.dragId === null) return; // a bookmark from this page or the bookmarks bar
    const t = bmpDropTarget(e);
    clearMarks();
    if (!t) { stopExpand(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    t.el.classList.add(`drop-${t.mode}`);
    // hovering a collapsed folder in the tree opens it, unless the drag started in the tree (redrawing it would drop the drag)
    const treeId = t.el.matches('.bmt-item') ? t.el.dataset.id : null;
    if (treeId !== expand.id) {
      stopExpand();
      if (treeId && !BMP.open.has(treeId) && bmpFolders(treeId).length && !$('#btree .dragging')) {
        expand = { id: treeId, timer: setTimeout(() => { BMP.open.add(treeId); drawBookmarksPage(); }, 700) };
      }
    }
  });
  page.addEventListener('dragleave', (e) => { if (!page.contains(e.relatedTarget)) { clearMarks(); stopExpand(); } });
  page.addEventListener('drop', async (e) => {
    if (BM.dragId === null) return;
    const t = bmpDropTarget(e);
    clearMarks();
    stopExpand();
    if (!t) return;
    e.preventDefault();
    const dragId = BM.dragId;
    BM.dragId = null; // the page redraws after the move, without the dragged row's dragend
    await window.ultima.moveBookmark({ id: dragId, parent: t.parent, index: t.index });
  });
}
