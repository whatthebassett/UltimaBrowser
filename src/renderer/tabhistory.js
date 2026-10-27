// Tab History: a panel listing every open tab in the space with the complete list of pages it has been through
// (newest first, the page it's on marked, pages you went back from dimmed), with a search across all of them.
// Opened from its sidebar button (Settings → Appearance), the Control Palette or a shortcut. Clicking a page jumps that
// tab straight to it; clicking a tab's heading switches to the tab. Back/forward lists come from main
// (webContents.navigationHistory); an unloaded tab has none, since Chromium drops it with the page.
const TH = { panel: null };

function closeTabHistory() {
  TH.panel?.remove();
  TH.panel = null;
}

function toggleTabHistory() {
  if (TH.panel) { closeTabHistory(); return; }
  closeUrlMenu();
  closeMenu(null);
  const el = h(`<div class="tab-history" role="dialog" aria-label="Tab History" tabindex="-1">
    <div class="th-top"><span class="th-title">${icon('tabHistory', 16)} Tab History</span>
      <label class="th-search">${icon('search', 14)}<input placeholder="Search tab history" spellcheck="false"></label></div>
    <div class="th-list"><div class="th-note">Loading…</div></div></div>`);
  document.body.append(el);
  TH.panel = el;
  placeTabHistory();
  const q = $('input', el);
  q.focus();
  q.addEventListener('input', () => filterTabHistory(q.value));
  el.addEventListener('keydown', (e) => { if (matchesKey(e, 'popover.close')) { e.preventDefault(); e.stopPropagation(); closeTabHistory(); } });
  el.addEventListener('click', onTabHistoryClick);
  renderTabHistoryPanel();
}

// Beside its sidebar button when that's showing (the panel opens out of the sidebar), else under the address bar.
function placeTabHistory() {
  const el = TH.panel;
  const btn = document.getElementById(sidebarButtonId('tab-history'));
  const shown = btn && !btn.closest('#sb-pool') && btn.getClientRects().length && $('#sidebar').getBoundingClientRect().right > 0;
  const r = el.getBoundingClientRect();
  if (shown) {
    const b = btn.getBoundingClientRect();
    const side = $('#sidebar').getBoundingClientRect();
    el.style.left = `${Math.min(side.right + 8, window.innerWidth - r.width - 8)}px`;
    el.style.top = `${Math.max(8, Math.min(b.bottom - r.height, window.innerHeight - r.height - 8))}px`;
  } else {
    const u = $('#urlbar').getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(u.left, window.innerWidth - r.width - 8))}px`;
    el.style.top = `${Math.min(u.bottom + 6, window.innerHeight - r.height - 8)}px`;
  }
}

// What each tab has been through: [{ url, title, i }] newest first, the index it's on, and why the list is short.
async function tabPages(t) {
  if (isInternal(t.url)) return { pages: [{ url: t.url, title: tabLabel(t), i: 0 }], active: 0, note: '' };
  if (!ready(t)) return { pages: [{ url: t.url, title: t.title || t.url, i: -1 }], active: -1, note: 'Not loaded: its history starts again when you open it' };
  const hist = await window.ultima.tabHistory(t.webview.getWebContentsId()).catch(() => null);
  if (!hist?.entries.length) return { pages: [{ url: t.url, title: t.title || t.url, i: hist?.active ?? 0 }], active: hist?.active ?? 0, note: '' };
  return { pages: hist.entries.map((e, i) => ({ ...e, i })).reverse(), active: hist.active, note: '' };
}

async function renderTabHistoryPanel() {
  const panel = TH.panel;
  const tabs = spaceTabs();
  const lists = await Promise.all(tabs.map(tabPages));
  if (TH.panel !== panel) return; // closed (or reopened) meanwhile
  const zoneName = { essential: 'Essential', pinned: 'Pinned' };
  $('.th-list', panel).innerHTML = tabs.map((t, n) => {
    const { pages, active, note } = lists[n];
    const count = note ? '' : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`;
    return `<section class="th-tab ${t.id === B.activeId ? 'active' : ''}" data-tab="${t.id}">
      <button class="th-tab-head" data-open="${t.id}" title="Switch to this tab">${tabIcon(t)}
        <span class="th-label">${esc(tabLabel(t) || t.url)}</span>
        ${zoneName[t.zone] ? `<span class="th-tag">${zoneName[t.zone]}</span>` : ''}
        ${t.id === B.activeId ? '<span class="th-tag th-open">Open</span>' : ''}<span class="th-count">${count}</span></button>
      ${pages.map((p) => {
        const here = p.i === active;
        const where = here ? 'The page this tab is on' : p.i > active ? 'Forward' : 'Back';
        return `<button class="th-page ${here ? 'current' : ''} ${p.i > active ? 'ahead' : ''}" data-tab="${t.id}" data-i="${p.i}"
          data-text="${esc(`${p.title} ${p.url}`.toLowerCase())}" title="${esc(`${p.title || p.url}\n${p.url}\n${where}`)}">
          ${favHtml(here && t.favicon ? t.favicon : bmFavicon(p), p.url, p.title)}<span class="th-name">${esc(p.title || p.url)}</span>
          <span class="th-host">${esc(isInternal(p.url) ? 'Ultima' : hostname(p.url))}</span></button>`;
      }).join('')}
      ${note ? `<div class="th-note">${note}</div>` : ''}</section>`;
  }).join('') || '<div class="th-note">No tabs open</div>';
  filterTabHistory($('input', panel).value);
  placeTabHistory();
  $('.th-tab.active', panel)?.scrollIntoView({ block: 'nearest' }); // opens on the tab you're in
}

// Hides the pages that don't match; a tab stays when its name matches or any of its pages do.
function filterTabHistory(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text) => words.every((w) => text.includes(w));
  let any = false;
  for (const sec of $$('.th-tab', TH.panel)) {
    const named = matches(sec.querySelector('.th-label').textContent.toLowerCase());
    let shown = 0;
    for (const p of $$('.th-page', sec)) {
      const ok = !words.length || named || matches(p.dataset.text);
      p.hidden = !ok;
      shown += ok;
    }
    sec.hidden = Boolean(words.length) && !shown;
    any ||= !sec.hidden;
  }
  $('.th-empty', TH.panel)?.remove();
  if (!any && words.length) $('.th-list', TH.panel).insertAdjacentHTML('beforeend', '<div class="th-note th-empty">Nothing matches</div>');
}

function onTabHistoryClick(e) {
  const open = e.target.closest('[data-open]');
  const page = e.target.closest('.th-page');
  const tab = tabById(Number(open ? open.dataset.open : page?.dataset.tab));
  if (!tab) return;
  closeTabHistory();
  if (tab.id !== B.activeId) activateTab(tab.id);
  if (page && !page.classList.contains('current') && ready(tab)) window.ultima.tabHistoryGo(tab.webview.getWebContentsId(), Number(page.dataset.i));
}

function initTabHistory() {
  // a click anywhere else in Ultima closes it (a click in a page does too: see the webview focus handler)
  document.addEventListener('mousedown', (e) => {
    if (TH.panel && !TH.panel.contains(e.target) && !e.target.closest(`#${sidebarButtonId('tab-history')}, .ctx-layer, .dd-layer`)) closeTabHistory();
  }, true);
  window.addEventListener('resize', () => { if (TH.panel) placeTabHistory(); });
}
