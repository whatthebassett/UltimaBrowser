// Built-in ultima:// pages, rendered directly in the browser UI.
let pageTimer = null;

function renderInternal(tab) {
  clearInterval(pageTimer);
  const root = $('#internal');
  const name = internalName(tab.url);
  const pages = { newtab: pageNewTab, settings: pageSettings, history: pageHistory, bookmarks: pageBookmarks, import: pageImport, passwords: pagePasswords, downloads: pageDownloads, shortcuts: pageShortcuts };
  root.scrollTop = 0;
  (pages[name] || pageNewTab)(root, tab);
}

const rerenderIfShowing = (name) => {
  const t = activeTab();
  if (t && isInternal(t.url) && internalName(t.url) === name) renderInternal(t);
};

// ---------- new tab ----------
async function pageNewTab(root, tab) {
  const engine = SEARCH_ENGINES[B.settings.searchEngine] || SEARCH_ENGINES.google;
  root.innerHTML = `<div class="ntp">
    <div class="clock" id="ntp-clock"></div>
    <div class="greet" id="ntp-greet"></div>
    <label class="ntp-search">${icon('search', 18)}<input id="ntp-q" placeholder="Search ${esc(engine.name)} or type a URL" spellcheck="false"></label>
    <div class="tiles" id="ntp-tiles"></div>
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
  pageTimer = setInterval(tick, 10000);
  const q = $('#ntp-q');
  q.addEventListener('keydown', (e) => {
    if (matchesKey(e, 'field.submit') && q.value.trim()) navigate(tab, resolveInput(q.value, B.settings.searchEngine));
  });
  // don't steal focus from something the user is already typing in (palette, space rename…)
  setTimeout(() => { if (activeTab() === tab && (!document.activeElement || document.activeElement === document.body)) q.focus(); }, 0);

  const sites = await window.ultima.topSites();
  const tiles = $('#ntp-tiles');
  if (!tiles) return;
  if (!sites.length) {
    tiles.outerHTML = `<div style="margin-top:36px"><button class="btn" id="ntp-import">${icon('import')} Bring your bookmarks & history from another browser</button></div>`;
    $('#ntp-import').onclick = () => navigate(tab, 'ultima://import');
    return;
  }
  tiles.innerHTML = sites.map((s) => `<button class="tile" data-url="${esc(s.url)}" title="${esc(s.title)}">
    <span class="tile-icon">${favHtml(`https://${s.host}/favicon.ico`, s.url, s.host)}</span><span>${esc(s.host)}</span></button>`).join('');
  tiles.onclick = (e) => { const b = e.target.closest('.tile'); if (b) navigate(tab, b.dataset.url); };
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
};

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
    <p class="sub">Ultima reads bookmarks, history, open &amp; pinned tabs and logins straight from your other browsers. Nothing leaves this computer. Imported tabs and cookies go into your current space, ${esc(activeSpace().icon)} ${esc(activeSpace().name)}.</p>
    <div class="toolbar"><span style="flex:1;color:var(--text-3)" id="imp-status">Looking for browsers…</span>
    <button class="btn primary" id="imp-all" disabled>${icon('import')} Import everything</button></div>
    <div class="grid" id="imp-grid"></div>
    <h3>Passwords</h3>
    <div class="card"><div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:280px"><b>Import saved passwords from a CSV export</b>
      <ol class="steps">
        <li><b>Chrome / Brave / Vivaldi:</b> Settings → Passwords (Google Password Manager) → Settings → Export passwords</li>
        <li><b>Edge:</b> Settings → Passwords → ⋯ → Export passwords</li>
        <li><b>Firefox / Zen:</b> open <code>about:logins</code> → ⋯ → Export Passwords</li>
      </ol>
      <span class="result" style="color:var(--text-3)">Passwords are encrypted with your OS account key. Delete the CSV afterward — it is plain text.</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><button class="btn primary" id="imp-csv">${icon('key')} Choose CSV file…</button><span class="result" id="imp-csv-res"></span></div>
    </div></div>
    <h3>Other browsers</h3>
    <div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:260px"><b>Bookmarks HTML file</b>
      <div class="result">Works with Safari, Opera, Arc and any browser that can “Export bookmarks to HTML”.</div></div>
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
      if (r) { res.className = 'result'; res.textContent = `✓ ${r.added} bookmarks added`; }
    } catch (err) { res.className = 'result err'; res.textContent = err.message; }
  };

  const sources = await window.ultima.detectBrowsers();
  const grid = $('#imp-grid');
  if (!grid) return;
  $('#imp-status').textContent = sources.length
    ? `Found ${sources.length} browser profile${sources.length > 1 ? 's' : ''} on this computer. Close a browser before importing if it reports a locked file.`
    : 'No supported browsers found on this computer.';
  grid.innerHTML = sources.map((s, i) => {
    const [letter, bg] = BROWSER_BADGE[s.browser] || ['?', 'var(--accent)'];
    const opt = (key, label, on = true) => (s.has[key] ? `<label><input type="checkbox" data-k="${key}" ${on ? 'checked' : ''}>${label}</label>` : '');
    return `<div class="card browser-card" data-i="${i}">
      <div class="head"><span class="badge" style="background:${bg}">${letter}</span>
        <div style="flex:1;min-width:0"><div class="name">${esc(s.label)}</div><div class="prof">${esc(s.profile)}</div></div>
        <button class="btn" data-act="go">Import</button></div>
      <div class="checks">${opt('bookmarks', 'Bookmarks')}${opt('history', 'History')}${opt('tabs', 'Open &amp; pinned tabs')}${opt('cookies', 'Cookies (stay signed in)')}</div>
      ${s.kind === 'chromium' ? '<div class="result" style="color:var(--text-3)">Saved logins: use the CSV import below — this browser encrypts them for itself.</div>' : ''}
      <div class="result" data-res></div></div>`;
  }).join('');
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

// ---------- passwords ----------
async function pagePasswords(root, tab) {
  root.innerHTML = `<div class="page"><h1>Passwords</h1><p class="sub">Encrypted with your operating-system account. Right-click a login field and choose “Fill saved login”, or use the key button in the toolbar.</p>
    <div class="toolbar"><input class="field" id="pq" placeholder="Search logins" spellcheck="false"><button class="btn" id="pimport">${icon('import')} Import CSV</button></div>
    <div id="plist" class="list"></div></div>`;
  let all = await window.ultima.listPasswords();
  const draw = () => {
    const q = $('#pq').value.toLowerCase();
    const items = all.filter((p) => !q || `${p.origin} ${p.username}`.toLowerCase().includes(q)).sort((a, b) => a.origin.localeCompare(b.origin));
    $('#plist').innerHTML = items.length ? items.map((p) => `<div class="row" data-id="${esc(p.id)}">${favHtml('', p.origin, p.origin)}
      <div class="main"><div class="t">${esc(hostname(p.origin) || p.origin)}</div><div class="u">${esc(p.username || '(no username)')}</div></div>
      <div class="acts" style="opacity:1"><button class="icon-btn" data-act="user" title="Copy username">${icon('copy', 15)}</button>
      <button class="icon-btn" data-act="pass" title="Copy password (cleared from clipboard after 30s)">${icon('key', 15)}</button>
      <button class="icon-btn" data-act="open" title="Open site">${icon('external', 15)}</button>
      <button class="icon-btn" data-act="del" title="Delete">${icon('trash', 15)}</button></div></div>`).join('')
      : `<div class="empty">${all.length ? 'Nothing matches' : 'No saved logins yet — import them from your old browser.'}</div>`;
  };
  $('#pq').addEventListener('input', draw);
  $('#pimport').onclick = async () => {
    try {
      const r = await window.ultima.importPasswordsCsv();
      if (r) { toast(`Imported ${r.added} passwords`); all = await window.ultima.listPasswords(); draw(); }
    } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  $('#plist').onclick = async (e) => {
    const row = e.target.closest('.row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const id = row.dataset.id;
    if (act === 'user') { await window.ultima.copyPassword({ id, field: 'username' }); toast('Username copied'); }
    if (act === 'pass') { await window.ultima.copyPassword({ id, field: 'password' }); toast('Password copied — clipboard clears in 30 s'); }
    if (act === 'open') createTab({ url: all.find((p) => p.id === id).origin });
    if (act === 'del' && await confirmDialog('You can import it again from a CSV export.', { title: 'Delete this saved login?', ok: 'Delete', danger: true })) { await window.ultima.deletePassword(id); all = all.filter((p) => p.id !== id); draw(); }
  };
  draw();
}

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

