// The password vault (ultima://passwords, and Settings → Passwords): every saved login, searchable, in folders and
// favorites, with weak and reused passwords picked out; see, copy, add, edit and delete logins; the password generator;
// import and export. The logins live in main (data.js, encrypted); a login's password and notes come here only while
// it's open.
const VAULT = { all: [], folders: [], health: { weak: [], reused: [] }, filter: 'all', query: '', sel: null, open: null, mode: 'view', reveal: false };

const MATCH_LABELS = [['', 'Base domain'], ['host', 'Host'], ['starts', 'Starts with'], ['exact', 'Exact'], ['never', 'Never']];
const vaultSite = (l) => { const u = l.uris[0]?.uri || ''; return hostname(/^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`); };
const vaultFav = (l, size = '') => `<span class="vault-fav ${size}">${favHtml('', `https://${vaultSite(l) || l.name}`, l.name)}</span>`;

async function pagePasswords(root) {
  root.innerHTML = `<div class="page vault-page" id="vault"><h1>Passwords</h1>
    <p class="sub">Encrypted with your computer account. Ultima fills them in at login fields and offers to save new ones.</p>
    <div class="toolbar"><input class="field" id="vq" placeholder="Search passwords" spellcheck="false" value="${esc(VAULT.query)}">
      <button class="btn primary" id="vnew">${icon('plus')} New login</button>
      <button class="btn" id="vgen">${icon('sparkle')} Generator</button>
      <button class="icon-btn" id="vmore" title="More">${icon('more')}</button></div>
    <div class="vault-layout"><nav class="vault-filters" id="vfilters" aria-label="Filters"></nav>
      <section class="vault-list" id="vlist" aria-label="Logins"></section>
      <section class="vault-detail" id="vdetail"></section></div>
    <div id="voptions"></div></div>`;
  const page = $('#vault');
  $('#vq').addEventListener('input', (e) => { VAULT.query = e.target.value; drawVaultList(); });
  $('#vq').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && VAULT.query) { e.target.value = VAULT.query = ''; drawVaultList(); }
    if (e.key === 'ArrowDown' || e.key === 'Enter') { const first = vaultItems()[0]; if (first) { e.preventDefault(); openVaultLogin(first.id); } }
  });
  $('#vnew').onclick = () => editVaultLogin(null);
  $('#vgen').onclick = () => showVaultGenerator();
  $('#vmore').onclick = () => vaultMoreMenu();
  $('#vfilters').addEventListener('click', vaultFilterClick);
  $('#vfilters').addEventListener('contextmenu', (e) => {
    const id = e.target.closest('[data-folder]')?.dataset.folder;
    if (id && id !== 'none') { e.preventDefault(); vaultFolderMenu(id, { x: e.clientX, y: e.clientY }); }
  });
  $('#vlist').addEventListener('click', (e) => { const row = e.target.closest('[data-id]'); if (row) openVaultLogin(row.dataset.id); });
  $('#vlist').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = vaultItems();
    const i = items.findIndex((l) => l.id === VAULT.sel);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) openVaultLogin(next.id, { keepFocus: true });
  });
  page.addEventListener('click', vaultDetailClick);
  page.addEventListener('input', vaultDetailInput);
  await loadVault();
  // drawn again (back on the page, or redrawn while open): the generator, or a login being edited, stays as it was
  if (VAULT.mode === 'generator') showVaultGenerator();
  else if (VAULT.mode === 'edit') drawVaultDetail();
  else if (VAULT.sel && VAULT.all.some((l) => l.id === VAULT.sel)) openVaultLogin(VAULT.sel); else drawVaultDetail();
}

async function loadVault() {
  [VAULT.all, VAULT.folders, VAULT.health] = await Promise.all([window.ultima.listPasswords(), window.ultima.passwordFolders(), window.ultima.passwordHealth()]);
  drawVaultFilters();
  drawVaultList();
  drawVaultOptions();
}

function vaultItems() {
  const f = VAULT.filter;
  const tokens = VAULT.query.toLowerCase().split(/\s+/).filter(Boolean);
  return VAULT.all.filter((l) => {
    if (f === 'favorites' && !l.favorite) return false;
    if (f === 'weak' && !VAULT.health.weak.includes(l.id)) return false;
    if (f === 'reused' && !VAULT.health.reused.includes(l.id)) return false;
    if (f.startsWith('folder:') && (l.folder || 'none') !== f.slice(7)) return false;
    const hay = `${l.name} ${l.username} ${l.uris.map((u) => u.uri).join(' ')}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.username.localeCompare(b.username));
}

function drawVaultFilters() {
  const el = $('#vfilters');
  if (!el) return;
  const count = (fn) => VAULT.all.filter(fn).length;
  const item = (id, ic, label, n, extra = '') => `<button class="vault-filter ${VAULT.filter === id ? 'sel' : ''}" data-filter="${esc(id)}" ${extra}>${icon(ic, 15)}<span>${esc(label)}</span><b>${n}</b></button>`;
  el.innerHTML = item('all', 'key', 'All logins', VAULT.all.length)
    + item('favorites', 'star', 'Favorites', count((l) => l.favorite))
    + (VAULT.health.weak.length ? item('weak', 'shield', 'Weak passwords', VAULT.health.weak.length) : '')
    + (VAULT.health.reused.length ? item('reused', 'duplicate', 'Reused passwords', VAULT.health.reused.length) : '')
    + `<div class="vault-filters-head"><span>Folders</span><button class="icon-btn" data-act="new-folder" title="New folder">${icon('plus', 14)}</button></div>`
    + VAULT.folders.map((f) => item(`folder:${f.id}`, 'folder', f.name, count((l) => l.folder === f.id), `data-folder="${esc(f.id)}"`)).join('')
    + item('folder:none', 'folder', 'No folder', count((l) => !l.folder), 'data-folder="none"');
}

function drawVaultList() {
  const el = $('#vlist');
  if (!el) return;
  const items = vaultItems();
  el.innerHTML = items.length ? items.map((l) => `<button class="vault-row ${l.id === VAULT.sel ? 'sel' : ''}" data-id="${esc(l.id)}">${vaultFav(l)}
      <span class="vault-row-text"><span class="t">${highlight(l.name, VAULT.query)}</span><span class="u">${highlight(l.username || '(no username)', VAULT.query)}</span></span>
      ${l.favorite ? `<span class="vault-star">${icon('star', 13).replace('fill="none"', 'fill="currentColor"')}</span>` : ''}</button>`).join('')
    : `<div class="empty">${VAULT.all.length ? 'Nothing matches' : 'No saved passwords yet. Sign in to a site and Ultima will offer to save it, or import them from another browser.'}</div>`;
}

async function vaultFilterClick(e) {
  if (e.target.closest('[data-act="new-folder"]')) {
    const v = await editDialog({ title: 'New folder', fields: [{ id: 'name', label: 'Name', value: '' }], ok: 'Create' });
    if (v?.name.trim()) { const f = await window.ultima.addPasswordFolder(v.name); VAULT.folders.push(f); VAULT.filter = `folder:${f.id}`; drawVaultFilters(); drawVaultList(); }
    return;
  }
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  VAULT.filter = b.dataset.filter;
  drawVaultFilters();
  drawVaultList();
}

async function vaultFolderMenu(id, pos) {
  const f = VAULT.folders.find((x) => x.id === id);
  const act = await showMenu([{ id: 'rename', label: 'Rename', icon: 'edit' }, { id: 'delete', label: 'Delete folder', icon: 'trash', danger: true }], pos);
  if (act === 'rename') {
    const v = await editDialog({ title: 'Rename folder', fields: [{ id: 'name', label: 'Name', value: f.name }] });
    if (v?.name.trim()) { await window.ultima.renamePasswordFolder({ id, name: v.name }); f.name = v.name.trim(); drawVaultFilters(); }
  } else if (act === 'delete' && await confirmDialog('Its logins stay, in no folder.', { title: `Delete the folder “${f.name}”?`, ok: 'Delete', danger: true })) {
    await window.ultima.deletePasswordFolder(id);
    if (VAULT.filter === `folder:${id}`) VAULT.filter = 'all';
    await loadVault();
    if (VAULT.open) openVaultLogin(VAULT.open.id);
  }
}

// ---------- one login ----------
async function openVaultLogin(id, { keepFocus = false } = {}) {
  const login = await window.ultima.getLogin(id);
  if (!login) return;
  VAULT.sel = id;
  VAULT.open = login;
  VAULT.mode = 'view';
  VAULT.reveal = false;
  $$('.vault-row', $('#vlist')).forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
  drawVaultDetail();
  if (keepFocus) $(`.vault-row[data-id="${CSS.escape(id)}"]`)?.focus();
}

function strengthHtml(password) {
  const r = PWGEN.strength(password);
  return `<div class="pwg-meter" data-score="${password ? r.score : ''}"><i></i><span>${esc(r.label)}</span></div>`;
}

function drawVaultDetail() {
  const el = $('#vdetail');
  if (!el) return;
  const l = VAULT.open;
  if (VAULT.mode === 'generator') return;
  if (VAULT.mode === 'edit') { el.innerHTML = vaultEditHtml(VAULT.edit); return; }
  if (!l) {
    el.innerHTML = `<div class="vault-empty">${icon('key', 28)}<div>Pick a login to see it here.</div></div>`;
    return;
  }
  const folder = VAULT.folders.find((f) => f.id === l.folder);
  const weak = VAULT.health.weak.includes(l.id);
  const reused = VAULT.health.reused.includes(l.id);
  const field = (label, value, acts) => `<div class="vd-field ${label ? '' : 'vd-nolabel'}"><div class="vd-label">${label}</div><div class="vd-value">${value}</div><div class="vd-acts">${acts}</div></div>`;
  el.innerHTML = `<div class="vd-head">${vaultFav(l, 'big')}<div class="vd-title"><div class="vd-name">${esc(l.name)}</div>
      <div class="vd-sub">${folder ? `${icon('folder', 12)} ${esc(folder.name)}` : esc(vaultSite(l))}</div></div>
      <button class="icon-btn ${l.favorite ? 'on' : ''}" data-vact="favorite" title="${l.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star', 16).replace('fill="none"', l.favorite ? 'fill="currentColor"' : 'fill="none"')}</button>
      <button class="btn" data-vact="edit">${icon('edit', 14)} Edit</button></div>
    <div class="vd-card">
      ${field('Username', l.username ? esc(l.username) : '<span class="vd-none">No username</span>', l.username ? `<button class="icon-btn" data-vact="copy-user" title="Copy username">${icon('copy', 15)}</button>` : '')}
      ${field('Password', `<span class="vd-pw">${VAULT.reveal ? colorPassword(l.password) : '•'.repeat(Math.min(16, l.password.length || 8))}</span>${strengthHtml(l.password)}${weak || reused ? `<div class="vd-warn">${icon('shield', 13)} ${[weak && 'Weak', reused && 'Used for other logins too'].filter(Boolean).join(' · ')}</div>` : ''}`,
    `<button class="icon-btn" data-vact="reveal" title="${VAULT.reveal ? 'Hide password' : 'Show password'}">${icon(VAULT.reveal ? 'eyeOff' : 'eye', 15)}</button>
         <button class="icon-btn" data-vact="copy-pass" title="Copy password (cleared from the clipboard after 30 seconds)">${icon('copy', 15)}</button>`)}
    </div>
    <div class="vd-card">${l.uris.length ? l.uris.map((u, i) => field(i ? '' : (l.uris.length > 1 ? 'Websites' : 'Website'), `<span class="vd-uri">${esc(u.uri)}</span>${u.match && u.match !== 'domain' ? ` <span class="s-badge s-badge-quiet">${esc(MATCH_LABELS.find(([v]) => v === u.match)?.[1] || '')}</span>` : ''}`,
    `<button class="icon-btn" data-vact="open-uri" data-i="${i}" title="Open">${icon('external', 15)}</button><button class="icon-btn" data-vact="copy-uri" data-i="${i}" title="Copy">${icon('copy', 15)}</button>`)).join('')
    : field('Website', '<span class="vd-none">No website: Ultima won’t offer it on any site</span>', '')}</div>
    ${l.notes ? `<div class="vd-card">${field('Notes', `<div class="vd-notes">${esc(l.notes)}</div>`, '')}</div>` : ''}
    ${l.history.length ? `<details class="vd-card vd-history"><summary>${icon('history', 14)} Password history <b>${l.history.length}</b></summary>
      ${l.history.map((h, i) => field(dayLabel(h.date), `<span class="vd-pw">${colorPassword(h.password)}</span>`, `<button class="icon-btn" data-vact="copy-old" data-i="${i}" title="Copy">${icon('copy', 15)}</button>`)).join('')}</details>` : ''}
    <div class="vd-meta">Updated ${esc(timeAgo(l.updated))} · Created ${esc(new Date(l.created).toLocaleDateString())}${l.used ? ` · Last filled ${esc(timeAgo(l.used))}` : ''}</div>
    <div class="vd-foot"><button class="btn danger" data-vact="delete">${icon('trash', 14)} Delete</button></div>`;
}

async function vaultDetailClick(e) {
  const b = e.target.closest('[data-vact]');
  if (!b) return;
  const l = VAULT.open;
  const act = b.dataset.vact;
  const i = Number(b.dataset.i);
  if (act === 'edit') editVaultLogin(l);
  else if (act === 'reveal') { VAULT.reveal = !VAULT.reveal; drawVaultDetail(); }
  else if (act === 'copy-user') copyText(l.username, 'Username copied');
  else if (act === 'copy-pass') { await window.ultima.copyPassword({ id: l.id, field: 'password' }); toast('Password copied. The clipboard clears in 30 seconds.'); }
  else if (act === 'copy-old') copyText(l.history[i].password, 'Old password copied');
  else if (act === 'copy-uri') copyText(l.uris[i].uri, 'Website copied');
  else if (act === 'open-uri') createTab({ url: /^[a-z][\w+.-]*:/i.test(l.uris[i].uri) ? l.uris[i].uri : `https://${l.uris[i].uri}` });
  else if (act === 'favorite') { await window.ultima.saveLogin({ id: l.id, favorite: !l.favorite }); await loadVault(); openVaultLogin(l.id); }
  else if (act === 'delete') {
    if (!await confirmDialog(`${l.username || 'This login'} on ${vaultSite(l) || l.name} will be gone for good.`, { title: 'Delete this login?', ok: 'Delete', danger: true })) return;
    await window.ultima.deletePassword(l.id);
    VAULT.open = null;
    VAULT.sel = null;
    await loadVault();
    drawVaultDetail();
    toast('Login deleted');
  } else if (act === 'edit-cancel') { VAULT.mode = 'view'; if (VAULT.open) drawVaultDetail(); else { VAULT.edit = null; drawVaultDetail(); } }
  else if (act === 'edit-save') saveVaultEdit();
  else if (act === 'edit-reveal') {
    const input = $('[data-e="password"]');
    input.type = input.type === 'password' ? 'text' : 'password';
    b.innerHTML = icon(input.type === 'password' ? 'eye' : 'eyeOff', 15);
  } else if (act === 'edit-generate') {
    const old = $('#vgen-inline');
    if (!old.hidden) { old.hidden = true; return; }
    const box = old.cloneNode(false); // a fresh box each time, so its listeners don't pile up
    old.replaceWith(box);
    box.hidden = false;
    box.innerHTML = `${generatorHtml()}<div class="vd-gen-use"><button class="btn primary" data-vact="edit-use">Use this password</button></div>`;
    VAULT.genCurrent = mountGenerator(box);
  } else if (act === 'edit-use') {
    const input = $('[data-e="password"]');
    input.value = VAULT.genCurrent();
    input.type = 'text';
    $('#vgen-inline').hidden = true;
    vaultDetailInput({ target: input });
  } else if (act === 'uri-add') { readVaultEdit(); VAULT.edit.uris.push({ uri: '' }); drawVaultDetail(); $$('[data-uri]').pop()?.focus(); }
  else if (act === 'uri-remove') { readVaultEdit(); VAULT.edit.uris.splice(i, 1); drawVaultDetail(); }
}

// ---------- adding and editing ----------
function editVaultLogin(l) {
  VAULT.mode = 'edit';
  VAULT.edit = l ? { ...l, uris: l.uris.map((u) => ({ ...u })) } : { name: '', username: '', password: '', uris: [{ uri: '' }], notes: '', folder: VAULT.filter.startsWith('folder:') && VAULT.filter !== 'folder:none' ? VAULT.filter.slice(7) : null, favorite: VAULT.filter === 'favorites' };
  drawVaultDetail();
  $(l ? '[data-e="password"]' : '[data-e="name"]')?.focus();
}

function vaultEditHtml(x) {
  return `<div class="vd-head"><div class="vd-title"><div class="vd-name">${x.id ? 'Edit login' : 'New login'}</div></div></div>
    <div class="vd-form">
      <label class="dlg-field"><span>Name</span><input class="field" data-e="name" spellcheck="false" value="${esc(x.name)}" placeholder="The site’s name"></label>
      <label class="dlg-field"><span>Username</span><input class="field" data-e="username" spellcheck="false" autocomplete="off" value="${esc(x.username)}"></label>
      <label class="dlg-field"><span>Password</span><span class="pw-field-row"><input class="field vd-pw-input" type="password" data-e="password" spellcheck="false" autocomplete="off" value="${esc(x.password)}">
        <button class="icon-btn" data-vact="edit-reveal" title="Show password">${icon('eye', 15)}</button>
        <button class="icon-btn" data-vact="edit-generate" title="Generate a password">${icon('dice', 15)}</button></span>
        <span data-e-meter>${strengthHtml(x.password)}</span></label>
      <div class="vd-gen-inline" id="vgen-inline" hidden></div>
      <div class="dlg-field"><span>Websites</span>${x.uris.map((u, i) => `<div class="vd-uri-row"><input class="field" data-uri="${i}" spellcheck="false" placeholder="example.com" value="${esc(u.uri)}">
          <select class="field" data-match="${i}" title="How it matches pages">${MATCH_LABELS.map(([v, label]) => `<option value="${v}" ${(u.match || '') === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
          <button class="icon-btn" data-vact="uri-remove" data-i="${i}" title="Remove">${icon('close', 14)}</button></div>`).join('')}
        <button class="btn vd-add" data-vact="uri-add">${icon('plus', 14)} Add website</button></div>
      <div class="vd-two"><label class="dlg-field"><span>Folder</span><select class="field" data-e="folder"><option value="">No folder</option>${VAULT.folders.map((f) => `<option value="${esc(f.id)}" ${x.folder === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
        <label class="pwg-check vd-fav"><input type="checkbox" data-e="favorite" ${x.favorite ? 'checked' : ''}> Favorite</label></div>
      <label class="dlg-field"><span>Notes</span><textarea class="field vd-notes-input" data-e="notes" spellcheck="false">${esc(x.notes)}</textarea></label>
      <div class="vd-foot"><span></span><span class="pw-offer-right"><button class="btn" data-vact="edit-cancel">Cancel</button><button class="btn primary" data-vact="edit-save">Save</button></span></div>
    </div>`;
}

// what the form says now, kept in VAULT.edit (so adding or removing a website row keeps what was typed)
function readVaultEdit() {
  const x = VAULT.edit;
  const val = (k) => $(`[data-e="${k}"]`)?.value ?? '';
  Object.assign(x, { name: val('name'), username: val('username'), password: val('password'), notes: val('notes'), folder: val('folder') || null, favorite: Boolean($('[data-e="favorite"]')?.checked) });
  x.uris = $$('[data-uri]').map((input) => ({ uri: input.value.trim(), match: $(`[data-match="${input.dataset.uri}"]`)?.value || undefined }));
  return x;
}

function vaultDetailInput(e) {
  if (e.target.dataset?.e === 'password') $('[data-e-meter]').innerHTML = strengthHtml(e.target.value);
}

async function saveVaultEdit() {
  const x = readVaultEdit();
  if (!x.password) { toast('Add a password first'); $('[data-e="password"]').focus(); return; }
  x.uris = x.uris.filter((u) => u.uri);
  const saved = await window.ultima.saveLogin({ id: x.id, name: x.name, username: x.username, password: x.password, notes: x.notes, uris: x.uris, folder: x.folder, favorite: x.favorite });
  VAULT.edit = null;
  await loadVault();
  openVaultLogin(saved.id);
  toast(x.id ? 'Login saved' : 'Login added');
}

// ---------- the generator ----------
function showVaultGenerator() {
  VAULT.mode = 'generator';
  VAULT.sel = null;
  $$('.vault-row.sel', $('#vlist')).forEach((r) => r.classList.remove('sel'));
  const el = $('#vdetail');
  el.innerHTML = `<div class="vd-head"><div class="vd-title"><div class="vd-name">Password generator</div><div class="vd-sub">Make a strong password or passphrase.</div></div></div>
    <div class="vd-card vd-gen">${generatorHtml()}</div>`;
  mountGenerator($('.vd-gen', el));
}

// ---------- more: import, export ----------
async function vaultMoreMenu() {
  const b = $('#vmore').getBoundingClientRect();
  const act = await showMenu([
    { id: 'import', label: 'Import passwords (CSV)…', icon: 'import' },
    { id: 'export', label: 'Export passwords (CSV)…', icon: 'download', enabled: VAULT.all.length > 0 },
    { type: 'separator' },
    { id: 'delete-all', label: 'Delete all passwords…', icon: 'trash', danger: true, enabled: VAULT.all.length > 0 },
  ], { x: b.left, y: b.bottom + 6 });
  if (act === 'import') {
    try {
      const r = await window.ultima.importPasswordsCsv();
      if (r) { toast(`Imported ${r.added} passwords`); await loadVault(); }
    } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  } else if (act === 'export') {
    if (!await confirmDialog('Anyone who opens the file can read every password in it. Delete it once you’re done with it.', { title: 'Export your passwords as plain text?', ok: 'Export' })) return;
    const file = await window.ultima.exportPasswords();
    if (file) toast('Passwords exported');
  } else if (act === 'delete-all') {
    const n = VAULT.all.length;
    if (!await confirmDialog(`All ${n} saved ${n === 1 ? 'login' : 'logins'} will be gone for good. Export them first if you might want them back.`, { title: 'Delete all passwords?', ok: 'Delete all', danger: true })) return;
    await window.ultima.deleteAllPasswords();
    VAULT.open = null;
    VAULT.sel = null;
    VAULT.mode = 'view';
    await loadVault();
    drawVaultDetail();
    toast('All passwords deleted');
  }
}

// ---------- options ----------
function drawVaultOptions() {
  const el = $('#voptions');
  if (!el) return;
  const never = B.settings.passwordsNeverSave || [];
  const sw = (key) => `<button class="switch ${B.settings[key] !== false ? 'on' : ''}" data-vswitch="${key}" role="switch" aria-checked="${B.settings[key] !== false}"></button>`;
  el.innerHTML = sGroup('Options', [
    sRow('Offer to save passwords', 'Ask to save or update a password after you sign in.', sw('offerToSavePasswords')),
    sRow('Show saved logins at login fields', 'A menu at the username or password field fills the one you pick.', sw('passwordFieldMenu')),
    sRow('Never saved', never.length ? 'Ultima won’t offer to save passwords on these sites.' : 'Sites you chose “Never for this site” on.',
      never.length ? `<div class="vault-never">${never.map((s) => `<span class="key-chip"><span>${esc(s)}</span><button data-never="${esc(s)}" title="Offer again">${icon('close', 12)}</button></span>`).join('')}</div>` : '<span class="s-value">None</span>'),
  ]);
  el.onclick = (e) => {
    const s = e.target.closest('[data-vswitch]');
    if (s) {
      const key = s.dataset.vswitch;
      B.settings[key] = B.settings[key] === false;
      window.ultima.setSettings({ [key]: B.settings[key] });
      drawVaultOptions();
    }
    const n = e.target.closest('[data-never]');
    if (n) {
      B.settings.passwordsNeverSave = never.filter((x) => x !== n.dataset.never);
      window.ultima.setSettings({ passwordsNeverSave: B.settings.passwordsNeverSave });
      drawVaultOptions();
    }
  };
}
