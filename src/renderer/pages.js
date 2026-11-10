// Built-in ultima:// pages, rendered directly in the browser UI.

// (`tab` null: a space with nothing open shows the new tab page on its own)
// (`keepScroll`: redrawn in place, where it was scrolled to)
function renderInternal(tab, { keepScroll = false } = {}) {
  // its own element when it's a pane of a split (split.js), else the page area's
  const root = (tab?.splitId && paneRootOf(tab)) || $('#internal');
  clearInterval(root.pageTimer);
  const name = tab ? internalName(tab.url) : 'newtab';
  const pages = { newtab: pageNewTab, settings: pageSettings, history: pageHistory, waypoints: pageBookmarks, import: pageImport, passwords: pagePasswords, downloads: pageDownloads, shortcuts: pageShortcuts, tasks: pageTasks };
  const top = keepScroll ? root.scrollTop : 0;
  root.scrollTop = 0;
  const drawn = (pages[name] || pageNewTab)(root, tab);
  if (top) Promise.resolve(drawn).then(() => { root.scrollTop = top; });
}

// Every one on screen (the tab you're on, or a pane of its split) is redrawn when what it shows changes: where it was
// scrolled to, and not while you're typing in one of its boxes or pressing on it (it's redrawn once you're done, so
// what you're typing isn't lost and a click isn't swallowed by a row being replaced under it)
const PAGE_REDRAW = { pressing: false, later: new Set() };
const typingInPage = (root) => root.contains(document.activeElement)
  && document.activeElement.matches('textarea, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])');
function redrawPage(tab) {
  const root = (tab.splitId && paneRootOf(tab)) || $('#internal');
  if (PAGE_REDRAW.pressing || typingInPage(root)) { PAGE_REDRAW.later.add(tab.id); return; }
  renderInternal(tab, { keepScroll: true });
}
const rerenderIfShowing = (name) => {
  const t = activeTab();
  for (const s of t?.splitId ? splitTabs(t.splitId) : t ? [t] : []) if (isInternal(s.url) && internalName(s.url) === name) redrawPage(s);
};
// the redraws held back, once you've let go or left the box (if their page is still on screen)
function redrawLater() {
  setTimeout(() => {
    const ids = [...PAGE_REDRAW.later];
    PAGE_REDRAW.later.clear();
    const t = activeTab();
    const shown = t?.splitId ? splitTabs(t.splitId) : t ? [t] : [];
    for (const s of shown) if (ids.includes(s.id) && isInternal(s.url)) redrawPage(s);
  }, 0);
}
document.addEventListener('pointerdown', () => { PAGE_REDRAW.pressing = true; }, true);
document.addEventListener('pointerup', () => { PAGE_REDRAW.pressing = false; if (PAGE_REDRAW.later.size) redrawLater(); }, true);
document.addEventListener('focusout', () => { if (PAGE_REDRAW.later.size) redrawLater(); }, true);

// ---------- new tab ----------
async function pageNewTab(root, tab) {
  // with no tab (a space with nothing open), what you open here gets a tab of its own
  const go = (url) => (tab ? navigate(tab, url) : createTab({ url }));
  const engine = SEARCH_ENGINES[B.settings.searchEngine] || SEARCH_ENGINES.google;
  root.innerHTML = `<div class="ntp">
    <div class="clock" id="ntp-clock"></div>
    <div class="greet" id="ntp-greet"></div>
    <label class="ntp-search">${icon('search', 18)}<input id="ntp-q" placeholder="Search ${esc(engine.name)} or type a URL" spellcheck="false"></label>
    ${tab?.private || (!tab && B.private) ? `<div class="ntp-private">${icon('incognito', 20)}<div><b>${B.private ? 'Private window' : 'Private tab'}</b>
      <span>Pages you visit here aren’t saved to your history, and their cookies and site data are deleted when your last private tab closes. Downloads and Waypoints are kept. Extensions are off.</span></div></div>`
    : '<div class="tiles" id="ntp-tiles"></div>'}
    ${keysFor('palette')[0] ? `<div class="ntp-hint">Press ${kbdHtml(keysFor('palette')[0])} anywhere to open the Control Palette</div>` : ''}
  </div>`;
  const tick = () => {
    const now = new Date();
    const c = $('#ntp-clock');
    if (!c) return;
    c.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const hr = now.getHours();
    $('#ntp-greet').textContent = `${hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'} · ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`;
  };
  tick();
  root.pageTimer = setInterval(tick, 10000);
  const q = $('#ntp-q');
  q.addEventListener('keydown', (e) => {
    if (matchesKey(e, 'field.submit') && q.value.trim()) go(resolveInput(q.value, B.settings.searchEngine));
  });
  // don't steal focus from something the user is already typing in (palette, space rename…)
  setTimeout(() => { if (activeTab() === tab && (!document.activeElement || document.activeElement === document.body)) q.focus(); }, 0);

  const sites = await window.ultima.topSites();
  const tiles = $('#ntp-tiles');
  if (!tiles) return;
  if (!sites.length) {
    tiles.outerHTML = `<div style="margin-top:36px"><button class="btn" id="ntp-import">${icon('import')} Bring your bookmarks & history from another browser</button></div>`;
    $('#ntp-import').onclick = () => go('ultima://import');
    return;
  }
  tiles.innerHTML = sites.map((s) => `<button class="tile" data-url="${esc(s.url)}" title="${esc(s.title)}">
    <span class="tile-icon">${favHtml(`https://${s.host}/favicon.ico`, s.url, s.host)}</span><span>${esc(s.host)}</span></button>`).join('');
  tiles.onclick = (e) => { const b = e.target.closest('.tile'); if (b) go(b.dataset.url); };
}

// ---------- history ----------
async function pageHistory(root, tab, query = '') {
  root.innerHTML = `<div class="page"><h1>History</h1><p class="sub">Everything you have visited, newest first.</p>
    <div class="toolbar"><input class="field" id="hq" placeholder="Search history" value="${esc(query)}" spellcheck="false">
    <button class="btn danger" id="hclear">${icon('trash')} Clear all</button></div><div id="hlist" class="list"></div></div>`;
  const draw = async () => {
    const q = $('#hq').value;
    const { items, total } = await window.ultima.listHistory({ query: q, limit: 300 });
    let day = '';
    $('#hlist').innerHTML = items.length ? items.map((it) => {
      const d = dayLabel(it.lastVisit);
      const head = d !== day ? `<h3>${esc((day = d))}</h3>` : '';
      return `${head}<div class="row" data-url="${esc(it.url)}">${favHtml('', it.url, it.title)}
        <div class="main"><div class="t">${highlight(it.title || it.url, q)}</div><div class="u">${highlight(it.url, q)}</div></div>
        <span class="meta">${new Date(it.lastVisit).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <div class="acts"><button class="icon-btn" data-act="del" title="Remove from history">${icon('trash', 15)}</button></div></div>`;
    }).join('') + (total > items.length ? `<div class="empty">Showing ${items.length} of ${total.toLocaleString()} — search to narrow it down</div>` : '')
      : '<div class="empty">No history yet</div>';
  };
  $('#hq').addEventListener('input', debounce(draw, 120));
  $('#hclear').onclick = async () => {
    if (!await confirmDialog('This removes every page from your history on this computer.', { title: 'Clear all browsing history?', ok: 'Clear history', danger: true })) return;
    await window.ultima.clearHistory();
    draw();
  };
  $('#hlist').onclick = async (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (e.target.closest('[data-act=del]')) { await window.ultima.deleteHistory(row.dataset.url); row.remove(); return; }
    if (e.target.closest('.main')) navigate(tab, row.dataset.url);
  };
  draw();
  $('#hq').focus();
}

// the bookmarks page (pageBookmarks) is in bookmarkmanager.js

// ---------- import ----------
const BROWSER_BADGE = {
  chrome: ['C', 'linear-gradient(135deg,#ea4335,#fbbc05 50%,#34a853)'],
  edge: ['E', 'linear-gradient(135deg,#0c59a4,#1fb3c4)'],
  brave: ['B', 'linear-gradient(135deg,#ff5500,#fb542b)'],
  vivaldi: ['V', 'linear-gradient(135deg,#ef3939,#b81d1d)'],
  firefox: ['F', 'linear-gradient(135deg,#ff980e,#e3205f)'],
  zen: ['Z', 'linear-gradient(135deg,#f4a261,#e76f51 60%,#9d4edd)'],
  opera: ['O', 'linear-gradient(135deg,#ff1b2d,#a70014)'],
  arc: ['A', 'linear-gradient(135deg,#fc5c65,#7b61ff 55%,#3dd5f3)'],
  dia: ['D', 'linear-gradient(135deg,#7aa2ff,#b388ff)'],
  safari: ['S', 'linear-gradient(135deg,#19d7ff,#1e64f0)'],
};
// Chrome's logo, for a Chrome whose profile is still here after the browser itself was removed
const CHROME_LOGO = `<svg viewBox="0 0 96 96" aria-hidden="true">
  <path fill="#ea4335" d="M7.62 22.06A48 48 0 0 1 90.66 26H48A22 22 0 0 0 28.95 59Z"/>
  <path fill="#fbbc04" d="M90.66 26A48 48 0 0 1 45.72 95.95L67.05 59A22 22 0 0 0 48 26Z"/>
  <path fill="#34a853" d="M45.72 95.95A48 48 0 0 1 7.62 22.06L28.95 59A22 22 0 0 0 67.05 59Z"/>
  <circle cx="48" cy="48" r="22" fill="#fff"/><circle cx="48" cy="48" r="18" fill="#1a73e8"/></svg>`;

// A browser's tile: empty at first (data-badge), then its app icon from where it's installed (browsericons.js), else
// a drawn logo or its letter. Icons are found in main, which takes a moment the first time.
const browserBadge = (cls, browser) => `<span class="${cls}" data-badge="${esc(browser)}"></span>`;
async function fillBrowserBadges(root, sources) {
  const icons = await window.ultima.browserIcons([...new Set(sources.map((s) => s.browser))]).catch(() => ({}));
  for (const el of root.querySelectorAll('[data-badge]')) {
    const b = el.dataset.badge;
    const family = b.split('-')[0]; // a Beta or Nightly is drawn as its browser (chrome-beta → chrome)
    if (icons[b] || family === 'chrome') {
      el.classList.add('app-icon');
      el.innerHTML = icons[b] ? `<img src="${esc(icons[b])}" alt="" draggable="false">` : CHROME_LOGO;
    } else {
      const [letter, bg] = BROWSER_BADGE[family] || ['?', 'var(--accent)'];
      el.style.background = bg;
      el.textContent = letter;
    }
  }
}

function describeResult(r) {
  const parts = [];
  if (r.bookmarks) parts.push(`${r.bookmarks.toLocaleString()} bookmarks`);
  if (r.history) parts.push(`${r.history.toLocaleString()} history entries`);
  if (r.tabs?.length) parts.push(`${r.tabs.length} tabs`);
  if (r.cookies) parts.push(`${r.cookies.toLocaleString()} cookies`);
  return parts.length ? `Imported ${parts.join(', ')}.` : 'Nothing new to import — you already have all of it.';
}

function openImportedTabs(tabs) {
  const existing = new Set(B.tabs.map((t) => t.url));
  for (const t of tabs) {
    if (existing.has(t.url)) continue;
    existing.add(t.url);
    createTab({ url: t.url, title: t.title, favicon: t.favicon, zone: t.zone, activate: false, lazy: true });
  }
}

async function pageImport(root) {
  root.innerHTML = `<div class="page"><h1>Bring your stuff to Ultima</h1>
    <p class="sub">Bring bookmarks, history, tabs and logins from your other browsers. Nothing leaves this computer. Tabs and cookies go into ${esc(activeSpace().icon)} ${esc(activeSpace().name)}.</p>
    <div class="toolbar"><span style="flex:1;color:var(--text-3)" id="imp-status">Looking for browsers…</span>
    <button class="btn primary" id="imp-all" disabled>${icon('import')} Import everything</button></div>
    <div class="grid" id="imp-grid"></div>
    <h3>Passwords</h3>
    <div class="card"><div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:280px"><b>Import saved passwords from a CSV export</b>
      <ol class="steps">
        <li><b>Chrome / Brave / Vivaldi:</b> Settings → Passwords (Google Password Manager) → Settings → Export passwords</li>
        <li><b>Edge:</b> Settings → Passwords → ⋯ → Export passwords</li>
        <li><b>Opera / Opera GX / Arc / Dia:</b> Settings → Passwords → ⋯ → Export passwords</li>
        <li><b>Firefox / Zen:</b> open <code>about:logins</code> → ⋯ → Export Passwords</li>
        <li><b>Safari:</b> File → Export → Passwords</li>
      </ol>
      <span class="result" style="color:var(--text-3)">Passwords are encrypted with your OS account key. Delete the CSV afterward — it is plain text.</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><button class="btn primary" id="imp-csv">${icon('key')} Choose CSV file…</button><span class="result" id="imp-csv-res"></span></div>
    </div></div>
    <h3>Other browsers</h3>
    <div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:260px"><b>Bookmarks HTML file</b>
      <div class="result">Works with any browser that can “Export bookmarks to HTML”.</div></div>
      <span class="result" id="imp-html-res"></span><button class="btn" id="imp-html">${icon('bookmark')} Choose HTML file…</button></div>
  </div>`;

  $('#imp-csv').onclick = async () => {
    const res = $('#imp-csv-res');
    try {
      const r = await window.ultima.importPasswordsCsv();
      if (!r) return;
      res.className = 'result';
      res.textContent = `✓ ${r.added} new logins saved (${r.found} in file)`;
      toast(`Imported ${r.added} passwords`, { label: 'View', run: () => runCommand('open-passwords') });
    } catch (err) { res.className = 'result err'; res.textContent = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  };
  $('#imp-html').onclick = async () => {
    const res = $('#imp-html-res');
    try {
      const r = await window.ultima.importBookmarksHtml();
      if (r) { res.className = 'result'; res.textContent = `✓ ${r.added} bookmarks added to your Waypoints`; }
    } catch (err) { res.className = 'result err'; res.textContent = err.message; }
  };

  const sources = await window.ultima.detectBrowsers();
  const grid = $('#imp-grid');
  if (!grid) return;
  $('#imp-status').textContent = sources.length
    ? `Found ${sources.length} browser profile${sources.length > 1 ? 's' : ''} on this computer. Close a browser before importing if it reports a locked file.`
    : 'No supported browsers found on this computer.';
  grid.innerHTML = sources.map((s, i) => {
    const opt = (key, label, on = true) => (s.has[key] ? `<label><input type="checkbox" data-k="${key}" ${on ? 'checked' : ''}>${label}</label>` : '');
    return `<div class="card browser-card" data-i="${i}">
      <div class="head">${browserBadge('badge', s.browser)}
        <div style="flex:1;min-width:0"><div class="name">${esc(s.label)}</div><div class="prof">${esc(s.profile)}</div></div>
        <button class="btn" data-act="go">Import</button></div>
      <div class="checks">${opt('bookmarks', 'Bookmarks')}${opt('history', 'History')}${opt('tabs', 'Open &amp; pinned tabs')}${opt('cookies', 'Cookies (stay signed in)')}</div>
      ${s.kind === 'chromium' ? '<div class="result" style="color:var(--text-3)">Saved logins: use the CSV import below — this browser encrypts them for itself.</div>' : ''}
      <div class="result" data-res></div></div>`;
  }).join('');
  fillBrowserBadges(grid, sources);
  $('#imp-all').disabled = !sources.length;

  const runOne = async (card) => {
    const s = sources[Number(card.dataset.i)];
    const what = Object.fromEntries($$('input[data-k]', card).map((c) => [c.dataset.k, c.checked]));
    const res = $('[data-res]', card);
    const btn = $('[data-act=go]', card);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Importing';
    res.className = 'result';
    res.textContent = '';
    try {
      const r = await window.ultima.runImport({ sourceId: s.id, what, partition: partitionFor(B.activeSpaceId) });
      openImportedTabs(r.tabs || []);
      res.textContent = `✓ ${describeResult(r)}`;
      if (r.errors.length) { res.className = 'result err'; res.textContent += ` ${r.errors.join(' · ')}`; }
      btn.innerHTML = `${icon('check')} Done`;
      return r;
    } catch (err) {
      res.className = 'result err';
      res.textContent = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      btn.textContent = 'Retry';
      return null;
    } finally {
      btn.disabled = false;
    }
  };
  grid.onclick = (e) => { const b = e.target.closest('[data-act=go]'); if (b) runOne(b.closest('.browser-card')); };
  $('#imp-all').onclick = async () => {
    $('#imp-all').disabled = true;
    for (const card of $$('.browser-card', grid)) await runOne(card);
    $('#imp-all').disabled = false;
    toast('Import finished');
  };
}

// ---------- passwords: the vault is in vault.js ----------

// ---------- downloads ----------
function pageDownloads(root) {
  const list = [...B.downloads.values()].sort((a, b) => b.started - a.started);
  root.innerHTML = `<div class="page"><h1>Downloads</h1><p class="sub">Files are saved to your Downloads folder.</p>
    <div class="toolbar"><span style="flex:1"></span><button class="btn" id="dclear">Clear finished</button></div>
    <div class="list">${list.length ? list.map((d) => {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      const status = d.state === 'completed' ? fmtBytes(d.total || d.received) : d.state === 'progressing'
        ? `${fmtBytes(d.received)} of ${d.total ? fmtBytes(d.total) : '?'}` : d.state;
      return `<div class="row" data-id="${esc(d.id)}">${icon('download', 18)}
        <div class="main"><div class="t">${esc(d.filename)}</div><div class="u">${esc(status)} · ${esc(hostname(d.url))}</div>
        ${d.state === 'progressing' ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}</div>
        <div class="acts" style="opacity:1">${d.state === 'completed' ? `<button class="icon-btn" data-act="open" title="Open">${icon('external', 15)}</button>` : ''}
        <button class="icon-btn" data-act="show" title="Show in folder">${icon('folder', 15)}</button></div></div>`;
    }).join('') : '<div class="empty">No downloads in this session</div>'}</div></div>`;
  root.querySelector('.list').onclick = (e) => {
    const row = e.target.closest('.row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row) return;
    if (act === 'open' || (!act && e.target.closest('.main'))) window.ultima.openDownload(row.dataset.id);
    if (act === 'show') window.ultima.showDownload(row.dataset.id);
  };
  $('#dclear').onclick = async () => {
    await window.ultima.clearDownloads();
    for (const [id, d] of B.downloads) if (d.state !== 'progressing') B.downloads.delete(id);
    pageDownloads(root);
  };
}

