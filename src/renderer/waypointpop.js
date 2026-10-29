// The Waypoint popup. Adding a page to Waypoints (the star, its shortcut or the page menu) saves it at once, at the end
// of the Waypoints bar, then opens this under the star to change its name, link or folder, or to remove it again (if
// that was a slip). On a page that's saved already it opens to edit that Waypoint. Changes are kept however it closes
// (Done, Enter, Esc, clicking elsewhere); only Remove takes the Waypoint away.
const WP = { open: null }; // { node, el, restoreFocus }

// The star, its shortcut and the page menu all come here.
async function bookmarkPage() {
  const tab = activeTab();
  if (!tab || isInternal(tab.url)) return;
  if (WP.open) { closeWaypointPopup('done'); return; } // pressed again: done
  BM.nodes = await window.ultima.bookmarkTree();
  let node = BM.nodes.find((n) => n.type === 'url' && n.url === tab.url);
  const added = !node;
  if (added) {
    node = await window.ultima.addBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon });
    BM.nodes = await window.ultima.bookmarkTree();
  }
  if (!node) return;
  updateChrome();
  openWaypointPopup(node, { added });
}

// every folder, each under the one it's in (indented): the Waypoints bar first
function wpFolderOptions(selected) {
  const out = [];
  const walk = (parent, depth) => {
    const folders = bmChildren(parent).filter((n) => n.type === 'folder');
    if (parent === null) folders.sort((a, b) => (b.id === 'bar') - (a.id === 'bar'));
    for (const f of folders) {
      out.push(`<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${' '.repeat(depth)}${esc(f.title)}</option>`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join('');
}

function openWaypointPopup(node, { added = false } = {}) {
  const heading = added ? 'Waypoint added' : 'Edit Waypoint';
  const el = h(`<div class="wp-pop" role="dialog" aria-label="${heading}">
    <div class="wp-head"><span class="wp-star">${icon('star', 16).replace('fill="none"', 'fill="currentColor"')}</span>${heading}</div>
    <label class="dlg-field"><span>Name</span><input class="field" data-f="title" spellcheck="false" autocomplete="off"></label>
    <label class="dlg-field"><span>Link</span><input class="field" data-f="url" spellcheck="false" autocomplete="off"></label>
    <label class="dlg-field"><span>Folder</span><select class="field" data-f="parent">${wpFolderOptions(node.parent)}</select></label>
    <div class="wp-buttons"><button class="btn danger" data-act="remove">${icon('trash', 15)} Remove</button><button class="btn primary" data-act="done">Done</button></div>
  </div>`);
  $('[data-f="title"]', el).value = node.title || '';
  $('[data-f="url"]', el).value = node.url || '';
  document.body.append(el);
  WP.open = { node, el, restoreFocus: document.activeElement };
  placeWaypointPopup(el);

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) closeWaypointPopup(act);
  });
  el.addEventListener('keydown', (e) => {
    if (DD.open) return; // the folder list is open: its keys are its own
    if (matchesKey(e, 'dialog.cancel')) { e.preventDefault(); e.stopPropagation(); closeWaypointPopup('done'); }
    else if (matchesKey(e, 'dialog.confirm') && e.target.tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); closeWaypointPopup('done'); }
  });
  // clicking or tabbing anywhere else (the page too) closes it; the folder list keeps the focus on its field
  el.addEventListener('focusout', () => setTimeout(() => {
    if (WP.open?.el === el && !DD.open && !el.contains(document.activeElement)) closeWaypointPopup('done');
  }));
  const name = $('[data-f="title"]', el);
  name.focus();
  name.select();
}

// Under the star when it's showing (leaning toward the middle of the window), else at the top right of the page.
function placeWaypointPopup(el) {
  const star = $('#btn-star');
  const a = star && !star.hidden && star.getClientRects().length ? star.getBoundingClientRect() : null;
  const shown = a && a.right > 0 && a.left < innerWidth;
  const vp = $('#viewport').getBoundingClientRect();
  const w = el.offsetWidth;
  let x;
  let y;
  if (shown) {
    x = a.left + a.width / 2 < innerWidth / 2 ? a.left - 10 : a.right - w + 10;
    y = a.bottom + 8;
  } else {
    x = vp.right - w - 12;
    y = vp.top + 12;
  }
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8))}px`;
}

// Done keeps what was typed and picked; Remove takes the Waypoint away (Undo brings it back).
async function closeWaypointPopup(how) {
  const w = WP.open;
  if (!w) return;
  WP.open = null;
  const { node, el } = w;
  const val = (f) => $(`[data-f="${f}"]`, el).value;
  const title = val('title').trim() || node.title;
  const url = val('url').trim() ? fixUrl(val('url').trim()) : node.url;
  const parent = val('parent');
  el.classList.add('out');
  setTimeout(() => el.remove(), 140);
  if (el.contains(document.activeElement) && w.restoreFocus && document.contains(w.restoreFocus)) w.restoreFocus.focus();
  if (how === 'remove') {
    const index = bmChildren(node.parent).findIndex((n) => n.id === node.id);
    await window.ultima.removeBookmark(node.id);
    toast('Waypoint removed', {
      label: 'Undo',
      run: () => window.ultima.addBookmark({ url: node.url, title: node.title, parent: node.parent, index, favicon: node.favicon }).then(updateChrome),
    });
  } else {
    if (title !== node.title || url !== node.url) await window.ultima.updateBookmark({ id: node.id, title, url });
    if (parent && parent !== node.parent) await window.ultima.moveBookmark({ id: node.id, parent });
  }
  updateChrome();
}
