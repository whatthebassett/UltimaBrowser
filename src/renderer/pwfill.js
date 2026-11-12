// Passwords in pages, the window's side (main's is passwords.js, the page's password-preload.js):
// - the menu at a login field: the saved logins for that site, picked with the mouse or the arrow keys (the page keeps
//   the focus and passes them on), and a strong password to use on sign-up and new-password fields
// - the generator popup (from that menu, or "Suggest strong password…" in a password field's right-click menu)
// - "Save password?" / "Update password?" under the key button after you sign in
// Saved passwords never come here: main fills them into the page's frame itself.
const PWF = { menu: null, gen: null, offer: null }; // menu: { el, page, items, sel, ... }

const pwPage = (webContentsId) => $$('webview').find((wv) => { try { return wv.getWebContentsId() === webContentsId; } catch { return false; } }) || null;
const pwGenOptions = () => PWGEN.options(B.settings.passwordGenerator);

function initPasswordFill() {
  window.ultima.on('pw-field', onLoginField);
  window.ultima.on('pw-field-blur', ({ webContentsId }) => {
    // the click that picks a login takes the focus from the page first: give it a moment
    if (PWF.menu?.page.webContentsId === webContentsId) setTimeout(() => { if (PWF.menu && !PWF.menu.pressing) closeLoginMenu(); }, 160);
  });
  window.ultima.on('pw-field-typed', ({ webContentsId, typed }) => {
    if (PWF.menu?.page.webContentsId === webContentsId) { PWF.menu.typed = typed; drawLoginMenu(); }
  });
  window.ultima.on('pw-field-key', ({ webContentsId, key }) => { if (PWF.menu?.page.webContentsId === webContentsId) loginMenuKey(key); });
  window.ultima.on('pw-field-move', ({ webContentsId, rect }) => {
    if (PWF.menu?.page.webContentsId === webContentsId && rect) { PWF.menu.rect = rect; placeLoginMenu(); }
  });
  window.ultima.on('pw-offer', onPasswordOffer);
  window.ultima.on('pw-generate', ({ webContentsId, frame, x, y }) => {
    const wv = pwPage(webContentsId);
    if (wv) openGenerator({ webContentsId, frame }, { x, y: y + 18 }); // under the field clicked
  });
  window.addEventListener('blur', () => closeLoginMenu());
  window.addEventListener('resize', () => closeLoginMenu());
}

// ---------- the menu at a login field ----------
// A frosted card under the field: the site's saved logins, then (on sign-up and new-password fields) a strong password.
// It never takes the focus: the page keeps typing, and passes the arrow keys, Enter and Esc on while it's open.
function onLoginField(d) {
  if (d.close) { if (PWF.menu?.page.webContentsId === d.webContentsId) closeLoginMenu(); return; }
  const wv = pwPage(d.webContentsId);
  // only for the page you're looking at (a background tab's autofocus opens nothing)
  if (!wv || !wv.getClientRects().length || wv.closest('[hidden]')) return;
  closeLoginMenu();
  const tab = B.tabs.find((t) => ready(t) && t.webview === wv);
  const el = h('<div class="pwf-menu" role="listbox" aria-label="Saved logins"></div>');
  PWF.menu = {
    el, wv, page: { webContentsId: d.webContentsId, frame: d.frame }, kind: d.kind, site: d.site, logins: d.logins, rect: d.rect,
    typed: d.typed || '', items: [], favicon: tab?.favicon || '', tabHost: tab ? hostname(tab.url) : '',
    // the password step of a two-step sign-in: the login picked on the step before is ready for Enter
    sel: d.picked ? 0 : -1,
    suggestion: d.kind === 'new-password' ? PWGEN.generate(pwGenOptions()) : '',
  };
  el.addEventListener('mousedown', (e) => {
    e.preventDefault(); // the page keeps the focus
    PWF.menu.pressing = true;
  });
  el.addEventListener('mouseup', () => { if (PWF.menu) PWF.menu.pressing = false; });
  el.addEventListener('mousemove', (e) => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i);
    if (Number.isInteger(i) && i !== PWF.menu.sel) selectLoginItem(i, false);
  });
  el.addEventListener('click', (e) => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i);
    if (Number.isInteger(i)) chooseLoginItem(i);
  });
  document.body.append(el);
  drawLoginMenu();
}

// a login's icon: the tab's own favicon for the tab's site, else its letter
function loginIcon(m, site) {
  const same = m.tabHost && site && (m.tabHost === site || m.tabHost.endsWith(`.${site}`) || site.endsWith(`.${m.tabHost}`));
  return favHtml(same ? m.favicon : '', `https://${site}`, site);
}

function drawLoginMenu() {
  const m = PWF.menu;
  if (!m) return;
  const typed = m.typed.toLowerCase();
  // a username being typed narrows the list to the logins it starts (and shows how much of each is typed)
  const logins = m.kind === 'username' && typed ? m.logins.filter((l) => l.username.toLowerCase().startsWith(typed)) : m.logins;
  const name = (u) => (u ? (typed && m.kind === 'username' ? `<mark>${esc(u.slice(0, typed.length))}</mark>${esc(u.slice(typed.length))}` : esc(u)) : '<i>No username</i>');
  const fill = '<span class="pwf-go">Fill<kbd>↵</kbd></span>';
  m.items = [
    ...logins.map((l) => ({
      act: 'fill', id: l.id,
      html: `<span class="pwf-ic">${loginIcon(m, l.site)}</span><span class="pwf-text"><b>${name(l.username)}</b><span>${esc(l.name && l.name !== l.site ? `${l.name} · ${l.site}` : l.site)}</span></span>${fill}`,
    })),
    ...(m.suggestion ? [
      { act: 'suggest', html: `<span class="pwf-ic pwf-accent">${icon('sparkle', 16)}</span><span class="pwf-text"><b>Use a strong password</b><span class="pwf-mono">${colorPassword(m.suggestion)}</span></span>${fill}` },
      { act: 'generator', html: `<span class="pwf-ic">${icon('tune', 15)}</span><span class="pwf-text"><b>Password options</b><span>Length, symbols, passphrases</span></span>` },
    ] : []),
  ];
  if (!m.items.length) { closeLoginMenu(); return; }
  m.sel = Math.min(m.sel, m.items.length - 1);
  const count = logins.length;
  m.el.innerHTML = `<div class="pwf-head"><span class="pwf-brand">${icon('key', 13)}${m.suggestion && !count ? 'New password' : count === 1 ? 'Saved login' : 'Saved logins'}</span><span class="pwf-site">${esc(m.site)}</span></div>
    <div class="pwf-list">${m.items.map((it, i) => `<div class="pwf-item ${i === m.sel ? 'sel' : ''} ${it.act === 'suggest' && count ? 'pwf-split' : ''}" data-i="${i}" role="option" aria-selected="${i === m.sel}">${it.html}</div>`).join('')}</div>
    <div class="pwf-foot"><span class="pwf-keys"><kbd>↑</kbd><kbd>↓</kbd>choose<kbd>↵</kbd>fill<kbd>esc</kbd>close</span><span class="pwf-manage ${m.sel === m.items.length ? 'sel' : ''}" data-i="${m.items.length}">Manage</span></div>`;
  m.items.push({ act: 'manage' });
  placeLoginMenu();
  scrollLoginItem();
  tellLoginMenu();
}

// under the field (above it when there's no room below), in the window's coordinates
function placeLoginMenu() {
  const m = PWF.menu;
  if (!m) return;
  const page = m.wv.getBoundingClientRect();
  const f = m.rect;
  // a field scrolled out of the page closes it
  if (f.y + f.height < 0 || f.y > page.height) { closeLoginMenu(); return; }
  const width = Math.max(288, Math.min(380, f.width));
  m.el.style.width = `${width}px`;
  const height = m.el.offsetHeight;
  const below = page.top + f.y + f.height + 6;
  const up = below + height > innerHeight - 8 && page.top + f.y - height - 6 > 8;
  m.el.classList.toggle('up', up);
  m.el.style.left = `${Math.max(8, Math.min(page.left + f.x, innerWidth - width - 8))}px`;
  m.el.style.top = `${Math.max(8, up ? page.top + f.y - height - 6 : below)}px`;
}

// the page passes on the arrow keys and Enter only while there's a menu, and Enter only once something is picked
function tellLoginMenu() {
  const m = PWF.menu;
  if (m) window.ultima.setLoginMenu({ ...m.page, open: true, selected: m.sel >= 0 });
}

function scrollLoginItem() {
  const m = PWF.menu;
  $(`.pwf-item[data-i="${m?.sel}"]`, m?.el)?.scrollIntoView({ block: 'nearest' });
}

function selectLoginItem(i, scroll = true) {
  const m = PWF.menu;
  m.sel = i;
  $$('.pwf-item, .pwf-manage', m.el).forEach((x) => {
    const on = Number(x.dataset.i) === i;
    x.classList.toggle('sel', on);
    x.setAttribute('aria-selected', on);
  });
  if (scroll) scrollLoginItem();
  tellLoginMenu();
}

function loginMenuKey(key) {
  const m = PWF.menu;
  if (!m) return;
  const n = m.items.length;
  if (key === 'ArrowDown') selectLoginItem((m.sel + 1) % n);
  else if (key === 'ArrowUp') selectLoginItem(m.sel <= 0 ? n - 1 : m.sel - 1);
  else if (key === 'Enter' && m.sel >= 0) chooseLoginItem(m.sel);
  else if (key === 'Escape') closeLoginMenu();
}

async function chooseLoginItem(i) {
  const m = PWF.menu;
  const it = m?.items[i];
  if (!it) return;
  const { page, wv, suggestion, rect } = m;
  closeLoginMenu();
  if (it.act === 'manage') { runCommand('open-passwords'); return; }
  if (it.act === 'generator') {
    const r = wv.getBoundingClientRect();
    openGenerator(page, { x: r.left + rect.x, y: r.top + rect.y + rect.height + 4 }, { field: true });
    return;
  }
  wv.focus();
  if (it.act === 'suggest') await useGeneratedPassword(page, suggestion);
  else if (!await window.ultima.fillLoginField({ ...page, id: it.id })) toast('Couldn’t fill this login here');
}

// A new password goes into the page's new-password fields, and on the clipboard in case the site asks for it again.
async function useGeneratedPassword(page, password) {
  const ok = await window.ultima.fillGeneratedPassword({ ...page, password });
  await window.ultima.copyText(password).catch(() => {});
  toast(ok ? 'Strong password filled in and copied' : 'Password copied');
}

function closeLoginMenu() {
  const m = PWF.menu;
  if (!m) return;
  PWF.menu = null;
  m.el.classList.add('out');
  m.el.style.pointerEvents = 'none';
  setTimeout(() => m.el.remove(), 110);
  window.ultima.setLoginMenu({ ...m.page, open: false, selected: false }).catch(() => {});
}

// ---------- the generator ----------
// The generator's controls (the popup's, and the vault's Generator): `onChange(password)` hears each new password.
function generatorHtml() {
  const o = pwGenOptions();
  const check = (k, label) => `<label class="pwg-check"><input type="checkbox" data-g="${k}" ${o[k] ? 'checked' : ''}> ${label}</label>`;
  return `<div class="pwg">
    <div class="pwg-out"><div class="pwg-pw" data-g-out></div>
      <button class="icon-btn" data-g-act="again" title="New password">${icon('dice', 15)}</button>
      <button class="icon-btn" data-g-act="copy" title="Copy">${icon('copy', 15)}</button></div>
    <div class="pwg-meter" data-g-meter><i></i><span></span></div>
    <div class="pwg-seg" role="radiogroup"><button data-g-type="password" class="${o.type === 'password' ? 'on' : ''}">Password</button><button data-g-type="passphrase" class="${o.type === 'passphrase' ? 'on' : ''}">Passphrase</button></div>
    <div class="pwg-opts" data-g-for="password" ${o.type === 'password' ? '' : 'hidden'}>
      <label class="pwg-range"><span>Length</span><input type="range" min="5" max="64" value="${Math.min(64, o.length)}" data-g="length"><b data-g-show="length">${o.length}</b></label>
      <div class="pwg-checks">${check('upper', 'A–Z')}${check('lower', 'a–z')}${check('digits', '0–9')}${check('symbols', '!@#$%^&amp;*')}</div>
      ${check('avoidAmbiguous', 'Avoid look-alike characters')}
    </div>
    <div class="pwg-opts" data-g-for="passphrase" ${o.type === 'passphrase' ? '' : 'hidden'}>
      <label class="pwg-range"><span>Words</span><input type="range" min="3" max="12" value="${Math.min(12, o.words)}" data-g="words"><b data-g-show="words">${o.words}</b></label>
      <label class="pwg-sep"><span>Separator</span><input class="field" maxlength="3" value="${esc(o.separator)}" data-g="separator" spellcheck="false"></label>
      <div class="pwg-checks">${check('capitalize', 'Capitalize')}${check('number', 'Add a number')}</div>
    </div>
  </div>`;
}

function mountGenerator(root, onChange) {
  let password = '';
  const make = () => {
    const o = pwGenOptions();
    password = PWGEN.generate(o);
    $('[data-g-out]', root).innerHTML = colorPassword(password);
    const r = PWGEN.rated(PWGEN.generatedBits(o));
    $('[data-g-meter]', root).dataset.score = r.score;
    $('[data-g-meter] span', root).textContent = r.label;
    onChange?.(password);
  };
  const save = (patch) => {
    B.settings.passwordGenerator = { ...pwGenOptions(), ...patch };
    window.ultima.setSettings({ passwordGenerator: B.settings.passwordGenerator });
  };
  root.addEventListener('input', (e) => {
    const k = e.target.dataset.g;
    if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    const show = $(`[data-g-show="${k}"]`, root);
    if (show) show.textContent = v;
    save({ [k]: v });
    // one kind of character always stays on
    if (e.target.type === 'checkbox' && !['upper', 'lower', 'digits', 'symbols'].some((x) => pwGenOptions()[x])) { e.target.checked = true; save({ [k]: true }); }
    make();
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-g-type], [data-g-act]');
    if (!t) return;
    if (t.dataset.gType) {
      save({ type: t.dataset.gType });
      $$('[data-g-type]', root).forEach((b) => b.classList.toggle('on', b === t));
      $$('[data-g-for]', root).forEach((x) => { x.hidden = x.dataset.gFor !== t.dataset.gType; });
      make();
    } else if (t.dataset.gAct === 'again') make();
    else if (t.dataset.gAct === 'copy') copyText(password, 'Password copied');
  });
  make();
  return () => password;
}

// digits and symbols in color, as Bitwarden shows them, so a password is easy to read out
function colorPassword(pw) {
  return [...pw].map((c) => (/\d/.test(c) ? `<span class="pw-d">${esc(c)}</span>` : /[^a-zA-Z]/.test(c) ? `<span class="pw-s">${esc(c)}</span>` : esc(c))).join('');
}

// The popup: at a field (`page` is the page and frame to fill), or for any use (copy only) when `page` is null.
function openGenerator(page, pos) {
  closeGenerator();
  const el = h(`<div class="pwg-pop" role="dialog" aria-label="Password generator">
    <div class="wp-head"><span class="wp-star">${icon('sparkle', 16)}</span>Strong password</div>
    ${generatorHtml()}
    <div class="wp-buttons"><button class="btn" data-act="cancel">Cancel</button>${page ? '<button class="btn primary" data-act="use">Use password</button>' : ''}</div>
  </div>`);
  document.body.append(el);
  const current = mountGenerator(el);
  PWF.gen = { el };
  const w = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(pos.x, innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(pos.y, innerHeight - el.offsetHeight - 8))}px`;
  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    closeGenerator();
    if (act === 'use') { pwPage(page.webContentsId)?.focus(); await useGeneratedPassword(page, current()); }
  });
  el.addEventListener('keydown', (e) => { if (matchesKey(e, 'dialog.cancel')) { e.preventDefault(); closeGenerator(); } });
  el.addEventListener('focusout', () => setTimeout(() => { if (PWF.gen?.el === el && !el.contains(document.activeElement)) closeGenerator(); }));
  $('[data-act="use"], [data-act="cancel"]', el).focus();
}

function closeGenerator() {
  PWF.gen?.el.remove();
  PWF.gen = null;
}

// ---------- "Save password?" ----------
// Kept on the tab until it's answered or the tab moves on to another site, so the key button can bring it back.
function onPasswordOffer(o) {
  const tab = B.tabs.find((t) => ready(t) && t.webview.getWebContentsId() === o.webContentsId);
  if (!tab) return;
  tab.pwOffer = { ...o, host: hostname(tab.url) };
  updateChrome();
  if (tab === activeTab()) openPasswordOffer(tab);
}

function openPasswordOffer(tab) {
  const o = tab.pwOffer;
  closePasswordOffer();
  if (!o) return;
  const update = o.kind === 'update';
  const el = h(`<div class="wp-pop pw-offer" role="dialog" aria-label="${update ? 'Update password?' : 'Save password?'}">
    <div class="wp-head"><span class="wp-star">${icon('key', 16)}</span>${update ? 'Update password?' : 'Save password?'}</div>
    <div class="pw-offer-site">${favHtml(tab.favicon, `https://${o.site}`, o.site)}<span>${esc(update && o.name ? o.name : o.site)}</span></div>
    <label class="dlg-field"><span>Username</span><input class="field" data-f="username" spellcheck="false" autocomplete="off"></label>
    <label class="dlg-field"><span>Password</span><span class="pw-field-row"><input class="field" type="password" data-f="password" spellcheck="false" autocomplete="off">
      <button class="icon-btn" data-act="reveal" title="Show password">${icon('eye', 15)}</button></span></label>
    ${!update && o.folders.length ? `<label class="dlg-field"><span>Folder</span><select class="field" data-f="folder"><option value="">No folder</option>${o.folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label>` : ''}
    <div class="wp-buttons">${update ? '<span></span>' : '<button class="btn" data-act="never">Never for this site</button>'}
      <span class="pw-offer-right"><button class="btn" data-act="later">Not now</button><button class="btn primary" data-act="save">${update ? 'Update' : 'Save'}</button></span></div>
  </div>`);
  $('[data-f="username"]', el).value = o.username || '';
  $('[data-f="password"]', el).value = o.password || '';
  document.body.append(el);
  PWF.offer = { el, tab };
  placeOfferPopup(el);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reveal') {
      const input = $('[data-f="password"]', el);
      input.type = input.type === 'password' ? 'text' : 'password';
      e.target.closest('[data-act]').innerHTML = icon(input.type === 'password' ? 'eye' : 'eyeOff', 15);
    } else if (act) answerPasswordOffer(act);
  });
  el.addEventListener('keydown', (e) => {
    if (DD.open) return;
    if (matchesKey(e, 'dialog.cancel')) { e.preventDefault(); e.stopPropagation(); answerPasswordOffer('later'); }
    else if (matchesKey(e, 'dialog.confirm') && e.target.tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); answerPasswordOffer('save'); }
  });
  $('.btn.primary', el).focus();
}

// under the key button (as the Waypoint popup sits under the star)
function placeOfferPopup(el) {
  const key = $('#btn-key');
  const a = key && !key.hidden && key.getClientRects().length ? key.getBoundingClientRect() : null;
  const vp = $('#viewport').getBoundingClientRect();
  const w = el.offsetWidth;
  const x = a ? (a.left + a.width / 2 < innerWidth / 2 ? a.left - 10 : a.right - w + 10) : vp.right - w - 12;
  const y = a ? a.bottom + 8 : vp.top + 12;
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8))}px`;
}

async function answerPasswordOffer(act) {
  const p = PWF.offer;
  if (!p) return;
  const { el, tab } = p;
  const o = tab.pwOffer;
  const val = (f) => $(`[data-f="${f}"]`, el)?.value ?? '';
  closePasswordOffer();
  if (act === 'later') return; // stays on the key button
  tab.pwOffer = null;
  updateChrome();
  if (act === 'save' && !val('password')) return;
  await window.ultima.answerPasswordOffer({ token: o.token, action: act === 'never' ? 'never' : 'save', username: val('username'), password: val('password'), folder: val('folder') || null });
  if (act === 'save') toast(o.kind === 'update' ? 'Password updated' : 'Password saved', { label: 'View', run: () => runCommand('open-passwords') });
  else toast(`Ultima won’t offer to save passwords for ${o.site}`);
  rerenderIfShowing('passwords');
}

function closePasswordOffer() {
  const p = PWF.offer;
  if (!p) return;
  PWF.offer = null;
  p.el.classList.add('out');
  setTimeout(() => p.el.remove(), 140);
}

// A tab's offer ends when it goes to another site; switching tabs puts the popup away (the key button brings it back).
function passwordOfferOnNavigate(tab) {
  if (tab.pwOffer && hostname(tab.url) !== tab.pwOffer.host) { tab.pwOffer = null; if (PWF.offer?.tab === tab) closePasswordOffer(); }
}
