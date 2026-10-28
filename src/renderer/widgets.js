// Waypoints, History and Downloads as dropdowns from their buttons (in the sidebar, or the toolbar with horizontal
// tabs): a panel with what you want at a glance (search, your folders, the latest pages, what's downloading) and a
// link to the full page. Settings → Appearance can make the buttons open the pages instead (widgetOpen: 'page'); the
// shortcuts (Ctrl+Shift+O, Ctrl+H, Ctrl+J) and the Control Palette always open the pages.
const WG = { panel: null, kind: null, folder: 'bar', query: '', seq: 0 };
const WIDGETS = { bookmarks: 'Waypoints', history: 'History', downloads: 'Downloads' };
const widgetDropdowns = () => B.settings.widgetOpen !== 'page';

// Where a panel goes beside the button that opened it: out of the sidebar, level with the button (top-aligned for a
// button near the top, bottom-aligned near the bottom), or under it with horizontal tabs. (Tab History uses it too.)
function placeByButton(el, btn) {
  const r = el.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  if (tabsAcross()) {
    el.style.left = `${clamp(b.right - r.width, 8, W - r.width - 8)}px`;
    el.style.top = `${clamp(b.bottom + 6, 8, H - r.height - 8)}px`;
  } else {
    const side = $('#sidebar').getBoundingClientRect();
    el.style.left = `${clamp(side.right + 8, 8, W - r.width - 8)}px`;
    el.style.top = `${clamp(b.top < H / 2 ? b.top : b.bottom - r.height, 8, H - r.height - 8)}px`;
  }
}

function closeWidget() {
  WG.panel?.remove();
  WG.panel = null;
  WG.kind = null;
}

// A click on the button: its panel opens (or closes, when it's open already)
function toggleWidget(kind) {
  if (WG.kind === kind) { closeWidget(); return; }
  closeWidget();
  closeTabHistory();
  closeUrlMenu();
  closeMenu(null);
  WG.kind = kind;
  WG.query = '';
  WG.folder = 'bar';
  const icons = { bookmarks: 'bookmark', history: 'history', downloads: 'download' };
  const searchable = kind !== 'downloads';
  const el = h(`<div class="tab-history widget-panel" role="dialog" aria-label="${WIDGETS[kind]}" tabindex="-1" data-widget="${kind}">
    <div class="th-top"><span class="th-title">${icon(icons[kind], 16)} ${WIDGETS[kind]}<span class="wg-top-acts"></span></span>
      ${searchable ? `<label class="th-search">${icon('search', 14)}<input placeholder="Search ${kind === 'bookmarks' ? 'Waypoints' : 'history'}" spellcheck="false"></label>` : ''}</div>
    <div class="th-list wg-list"></div>
    <div class="wg-foot"></div></div>`);
  document.body.append(el);
  WG.panel = el;
  const q = $('input', el);
  if (q) {
    q.addEventListener('input', debounce(() => { WG.query = q.value.trim(); renderWidget(); }, 100));
    q.focus();
  } else el.focus();
  el.addEventListener('keydown', (e) => { if (matchesKey(e, 'popover.close')) { e.preventDefault(); e.stopPropagation(); closeWidget(); } });
  el.addEventListener('click', onWidgetClick);
  el.addEventListener('auxclick', (e) => { if (e.button === 1) onWidgetClick(e); }); // middle-click: in a new tab
  renderWidget();
}

function widgetButton() { return WG.kind && document.getElementById(sidebarButtonId(WG.kind)); }

async function renderWidget() {
  const panel = WG.panel;
  if (!panel) return;
  const seq = ++WG.seq;
  const list = $('.wg-list', panel);
  let body = '';
  let foot = '';
  let acts = '';
  if (WG.kind === 'bookmarks') ({ body, foot, acts } = bookmarksWidget());
  else if (WG.kind === 'history') ({ body, foot } = await historyWidget());
  else ({ body, foot, acts } = downloadsWidget());
  if (seq !== WG.seq || WG.panel !== panel) return; // a newer render (or another panel) took over meanwhile
  list.innerHTML = body;
  $('.wg-foot', panel).innerHTML = foot;
  $('.wg-top-acts', panel).innerHTML = acts;
  const btn = widgetButton();
  if (btn?.getClientRects().length) placeByButton(panel, btn);
}

const wgRow = (attrs, lead, name, sub, tail = '') => `<button class="th-page wg-row" ${attrs}>${lead}<span class="th-name">${esc(name)}</span>${sub ? `<span class="th-host">${esc(sub)}</span>` : ''}${tail}</button>`;
const wgHead = (text) => `<div class="wg-head">${esc(text)}</div>`;

// ---------- Waypoints ----------
function bookmarksWidget() {
  const tab = activeTab();
  const saved = tab && !isInternal(tab.url) && BM.nodes.some((n) => n.type === 'url' && n.url === tab.url);
  const acts = tab && !isInternal(tab.url)
    ? `<button class="icon-btn ${saved ? 'on' : ''}" data-wg="star" title="${saved ? 'Remove this page from Waypoints' : 'Add this page to Waypoints'}">${icon('star', 15).replace('fill="none"', saved ? 'fill="currentColor"' : 'fill="none"')}</button>` : '';
  const foot = '<button class="wg-link" data-wg="page">Open Waypoints</button>';
  const urlRow = (n) => wgRow(`data-bm="${esc(n.id)}" title="${esc(`${n.title || n.url}\n${n.url}`)}"`, favHtml(bmFavicon(n), n.url, n.title), n.title || n.url, hostname(n.url));
  const words = WG.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hits = BM.nodes.filter((n) => n.type === 'url' && words.every((w) => `${n.title} ${n.url}`.toLowerCase().includes(w))).slice(0, 60);
    return { acts, foot, body: hits.length ? hits.map(urlRow).join('') : '<div class="th-note">No Waypoint matches</div>' };
  }
  const here = bmNode(WG.folder) || bmNode('bar');
  const kids = bmChildren(here.id);
  const folderRow = (f) => wgRow(`data-folder-open="${esc(f.id)}"`, `<span class="wg-icon">${icon('folder', 15)}</span>`, f.title, `${bmChildren(f.id).length}`, `<span class="wg-chev">${icon('forward', 12)}</span>`);
  let body = '';
  if (here.id !== 'bar') {
    body += `<button class="wg-back" data-folder-open="${esc(here.parent || 'bar')}">${icon('back', 13)} ${esc(here.parent ? bmNode(here.parent)?.title || 'Back' : 'Back')}</button>${wgHead(here.title)}`;
  }
  body += kids.map((n) => (n.type === 'folder' ? folderRow(n) : urlRow(n))).join('');
  if (here.id === 'bar') {
    const other = bmNode('other');
    if (other && bmChildren('other').length) body += folderRow(other);
  }
  if (!kids.length && here.id !== 'bar') body += '<div class="th-note">This folder is empty</div>';
  if (!body) body = `<div class="th-note">No Waypoints yet. ${keyText('bookmark') ? `Press ${esc(keyText('bookmark'))}` : 'Use the star'} on any page to add it.</div>`;
  return { acts, foot, body };
}

// ---------- History ----------
async function historyWidget() {
  const words = WG.query;
  const { items } = await window.ultima.listHistory({ query: words, limit: words ? 60 : 40 });
  let body = '';
  // the tabs you closed, newest first (reopening one brings it back where it was)
  const closed = words ? [] : B.closed.slice(-3).reverse();
  if (closed.length) {
    body += wgHead('Recently closed');
    body += closed.map((c) => wgRow(`data-closed="${B.closed.indexOf(c)}" title="${esc(`${c.title || c.url}\n${c.url}`)}"`, favHtml(c.favicon, c.url, c.title), c.title || c.url, hostname(c.url), `<span class="wg-tag">${icon('reload', 11)}</span>`)).join('');
  }
  let day = '';
  body += items.map((it) => {
    const d = dayLabel(it.lastVisit);
    const head = d !== day ? wgHead((day = d)) : '';
    return head + wgRow(`data-url="${esc(it.url)}" title="${esc(`${it.title || it.url}\n${it.url}`)}"`, favHtml('', it.url, it.title), it.title || it.url,
      new Date(it.lastVisit).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }).join('');
  if (!items.length && !closed.length) body = `<div class="th-note">${words ? 'Nothing in your history matches' : 'No history yet'}</div>`;
  return { body, foot: '<button class="wg-link" data-wg="page">Show all history</button>' };
}

// ---------- Downloads ----------
function downloadsWidget() {
  const list = [...B.downloads.values()].sort((a, b) => b.started - a.started).slice(0, 20);
  const finished = list.some((d) => d.state !== 'progressing');
  const body = list.length ? list.map((d) => {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    const status = d.state === 'completed' ? fmtBytes(d.total || d.received)
      : d.state === 'progressing' ? `${fmtBytes(d.received)} of ${d.total ? fmtBytes(d.total) : '?'}`
        : d.state === 'cancelled' ? 'Cancelled' : 'Failed';
    return `<div class="wg-dl ${d.state}" data-dl="${esc(d.id)}" title="${esc(d.filename)}">
      <span class="wg-icon">${icon('file', 16)}</span>
      <span class="wg-dl-main"><span class="th-name">${esc(d.filename)}</span><span class="wg-dl-sub">${esc(status)} · ${esc(hostname(d.url))}</span>
        ${d.state === 'progressing' ? `<span class="wg-progress"><i style="width:${pct}%"></i></span>` : ''}</span>
      ${d.state === 'completed' ? `<button class="icon-btn" data-dl-act="open" title="Open">${icon('external', 14)}</button>` : ''}
      <button class="icon-btn" data-dl-act="show" title="Show in folder">${icon('folder', 14)}</button></div>`;
  }).join('') : '<div class="th-note">No downloads in this session</div>';
  return {
    body,
    acts: finished ? '<button class="wg-clear" data-wg="clear-dl">Clear finished</button>' : '',
    foot: '<button class="wg-link" data-wg="page">Open downloads</button>',
  };
}

// ---------- clicks ----------
// a page opens in the tab you're on; Ctrl/Cmd+click or a middle click opens it in a new tab
function widgetOpen(url, e, title = '') {
  const newTab = e.ctrlKey || e.metaKey || e.button === 1;
  closeWidget();
  if (!newTab && activeTab()) navigate(activeTab(), url);
  else createTab({ url, title, activate: !e.shiftKey && e.button !== 1 });
}

async function onWidgetClick(e) {
  const t = e.target.closest('button, .wg-dl');
  if (!t) return;
  const d = t.dataset;
  if (d.wg === 'page') { const kind = WG.kind; closeWidget(); runCommand({ bookmarks: 'open-bookmarks', history: 'open-history', downloads: 'open-downloads' }[kind]); return; }
  if (d.wg === 'star') { await toggleBookmark(); await refreshBookmarkBar(); renderWidget(); return; }
  if (d.wg === 'clear-dl') {
    await window.ultima.clearDownloads();
    for (const [id, x] of B.downloads) if (x.state !== 'progressing') B.downloads.delete(id);
    renderWidget();
    return;
  }
  if (d.folderOpen) { WG.folder = d.folderOpen; renderWidget(); return; }
  if (d.bm) { const n = bmNode(d.bm); if (n) widgetOpen(n.url, e, n.title); return; }
  if (d.url) { widgetOpen(d.url, e); return; }
  if (d.closed) {
    const [c] = B.closed.splice(Number(d.closed), 1);
    closeWidget();
    if (c) createTab({ url: c.url, title: c.title, name: c.name, favicon: c.favicon, zone: c.zone, homeUrl: c.homeUrl, homeTitle: c.homeTitle, homeFavicon: c.homeFavicon, index: c.index, spaceId: c.spaceId, folderId: c.folderId, essentialsOf: c.essentialsOf });
    return;
  }
  const row = t.closest('.wg-dl');
  if (row) {
    const act = e.target.closest('[data-dl-act]')?.dataset.dlAct;
    const dl = B.downloads.get(row.dataset.dl);
    if (act === 'show') window.ultima.showDownload(row.dataset.dl);
    else if (act === 'open' || (!act && dl?.state === 'completed')) window.ultima.openDownload(row.dataset.dl);
  }
}

function initWidgets() {
  // a click anywhere else in Ultima closes it (a click in a page does too: tabs.js)
  document.addEventListener('mousedown', (e) => {
    if (!WG.panel || WG.panel.contains(e.target) || e.target.closest('.ctx-layer, .dd-layer')) return;
    if (e.target.closest(`#${sidebarButtonId(WG.kind)}`)) return; // its button closes it with its own click
    closeWidget();
  }, true);
  window.addEventListener('resize', () => { const btn = widgetButton(); if (WG.panel && btn) placeByButton(WG.panel, btn); });
}
