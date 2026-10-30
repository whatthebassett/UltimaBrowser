// Ultima's own context menus, dialogs and tooltips, used instead of the native ones so everything
// matches the UI (glass, Inter, your keybindings).
//
// Menu items: { id, label, icon?, leadHtml? (e.g. a site icon), shortcut? (command id), hint? (literal key text), note? (plain
//               text on the right, e.g. an address), enabled?,
//               type?: 'separator' | 'checkbox', checked?, danger?, submenu?: [items] }
// or a row of icon buttons: { type: 'actions', buttons: [{ id, label, icon, enabled?, on?, shortcut?, hint? }] }

const OV = { pointer: { x: 0, y: 0 }, menu: null, dialog: null, queue: Promise.resolve() };

// One dialog at a time: a question that comes while another is open waits its turn (it never answers the open one,
// as a site's second permission request or a page's alert() during "Clear all history?" would otherwise)
function dialogTurn(open) {
  const turn = OV.queue.then(open);
  OV.queue = turn.then(() => {}, () => {});
  return turn;
}

// remember where the pointer was, so menus opened by a click or right-click appear there
document.addEventListener('mousedown', (e) => { OV.pointer = { x: e.clientX, y: e.clientY }; }, true);
document.addEventListener('contextmenu', (e) => { OV.pointer = { x: e.clientX, y: e.clientY }; }, true);

// ---------- context menu ----------
function showMenu(items, pos = OV.pointer) {
  closeMenu(null);
  return new Promise((resolve) => {
    const layer = h('<div class="ctx-layer"></div>');
    document.body.append(layer);
    const restoreFocus = document.activeElement;
    OV.menu = { layer, resolve, levels: [], restoreFocus };
    layer.addEventListener('mousedown', (e) => { if (e.target === layer) closeMenu(null); });
    layer.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === layer) closeMenu(null); });
    openLevel(items, pos, null);
    layer.tabIndex = -1;
    layer.focus();
    layer.addEventListener('keydown', onMenuKey);
  });
}

function closeMenu(result) {
  const m = OV.menu;
  if (!m) return;
  OV.menu = null;
  m.layer.remove();
  if (m.restoreFocus && m.restoreFocus !== document.body && document.contains(m.restoreFocus)) m.restoreFocus.focus();
  m.resolve(result);
}

function menuItemHtml(it, i) {
  if (it.type === 'separator') return '<div class="ctx-sep"></div>';
  if (it.type === 'actions') {
    // the label (with its keys) is the button's tooltip
    return `<div class="ctx-actions" data-i="${i}">${it.buttons.map((b, n) => {
      const keys = (b.shortcut && keyText(b.shortcut)) || b.hint || '';
      return `<button class="ctx-act ${b.on ? 'on' : ''}" data-act="${n}" ${b.enabled === false ? 'disabled' : ''} data-tip="${esc(keys ? `${b.label} (${keys})` : b.label)}" aria-label="${esc(b.label)}">${icon(b.icon, 16)}</button>`;
    }).join('')}</div>`;
  }
  const keys = it.shortcut && keysFor(it.shortcut)[0] ? kbdHtml(keysFor(it.shortcut)[0])
    : it.hint ? it.hint.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('')
      : it.note ? `<span class="ctx-note">${esc(it.note)}</span>` : '';
  const tick = it.type === 'checkbox' && it.checked ? icon('check', 14) : '';
  let lead;
  if (it.leadHtml) lead = `<span class="ctx-icon ctx-fav">${it.leadHtml}</span>`;
  else if (it.swatch) lead = `<span class="ctx-icon"><span class="ctx-swatch" style="background:${esc(it.swatch)}"></span></span>`;
  else if (it.type === 'checkbox') lead = `<span class="ctx-icon ctx-check">${tick}</span>`;
  else lead = `<span class="ctx-icon">${it.icon ? icon(it.icon, 15) : ''}</span>`;
  const right = it.submenu ? icon('forward', 13) : it.swatch ? tick : keys;
  return `<div class="ctx-item ${it.enabled === false ? 'disabled' : ''} ${it.danger ? 'danger' : ''} ${it.submenu ? 'has-sub' : ''}" data-i="${i}" role="menuitem">
    ${lead}<span class="ctx-label">${esc(it.label)}</span>
    <span class="ctx-keys">${right}</span></div>`;
}

// One menu panel. Nested submenus open beside their parent item.
function openLevel(items, pos, parentItemEl) {
  const m = OV.menu;
  const depth = parentItemEl ? m.levels.findIndex((l) => l.el.contains(parentItemEl)) + 1 : 0;
  for (const l of m.levels.splice(depth)) l.el.remove();
  const el = h(`<div class="ctx-menu" role="menu">${items.map(menuItemHtml).join('')}</div>`);
  m.layer.append(el);
  const level = { el, items, sel: -1 };
  m.levels.push(level);

  // place it inside the window, flipping left/up when there is no room
  const r = el.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  let x = pos?.x ?? 0;
  let y = pos?.y ?? 0;
  if (parentItemEl) {
    const pr = parentItemEl.getBoundingClientRect();
    x = pr.right + 2;
    y = pr.top - 5;
    if (x + r.width > W - 6) x = pr.left - r.width - 2;
  } else if (x + r.width > W - 6) x = Math.max(6, x - r.width);
  if (y + r.height > H - 6) y = Math.max(6, H - r.height - 6);
  el.style.left = `${Math.max(6, x)}px`;
  el.style.top = `${y}px`;

  let hoverTimer;
  el.addEventListener('mousemove', (e) => {
    const itemEl = e.target.closest('.ctx-item');
    if (!itemEl) return;
    const i = Number(itemEl.dataset.i);
    if (level.sel === i) return;
    selectItem(level, i);
    clearTimeout(hoverTimer);
    // hovering a different item closes deeper menus; hovering a submenu item opens it after a beat
    hoverTimer = setTimeout(() => {
      if (!OV.menu) return;
      const d = m.levels.indexOf(level);
      if (items[i].submenu && items[i].enabled !== false) openLevel(items[i].submenu, null, itemEl);
      else for (const l of m.levels.splice(d + 1)) l.el.remove();
    }, 160);
  });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('.ctx-act');
    if (act) {
      const b = items[Number(act.closest('.ctx-actions').dataset.i)].buttons[Number(act.dataset.act)];
      if (b.enabled !== false) closeMenu(b.id);
      return;
    }
    const itemEl = e.target.closest('.ctx-item');
    if (itemEl) activateItem(level, Number(itemEl.dataset.i), itemEl);
  });
  // middle-click: an item's `middle` choice, when it has one (a Waypoint: in a new tab)
  el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener('auxclick', (e) => {
    const itemEl = e.button === 1 && e.target.closest('.ctx-item');
    const it = itemEl && items[Number(itemEl.dataset.i)];
    if (it?.middle && it.enabled !== false) closeMenu(it.middle);
  });
  return level;
}

function selectItem(level, i) {
  level.sel = i;
  $$('.ctx-item', level.el).forEach((x) => x.classList.toggle('sel', Number(x.dataset.i) === i));
}

function activateItem(level, i, itemEl) {
  const it = level.items[i];
  if (!it || it.type === 'separator' || it.type === 'actions' || it.enabled === false) return;
  if (it.submenu) {
    const sub = openLevel(it.submenu, null, itemEl || $(`.ctx-item[data-i="${i}"]`, level.el));
    moveSel(sub, 1);
    return;
  }
  closeMenu(it.id);
}

function moveSel(level, dir) {
  const n = level.items.length;
  let i = level.sel;
  for (let step = 0; step < n; step += 1) {
    i = (i + dir + n) % n;
    const it = level.items[i];
    if (it.type !== 'separator' && it.type !== 'actions' && it.enabled !== false) { selectItem(level, i); return; }
  }
}

function onMenuKey(e) {
  const m = OV.menu;
  if (!m) return;
  const level = m.levels[m.levels.length - 1];
  const act = ['menu.next', 'menu.prev', 'menu.choose', 'menu.open-submenu', 'menu.close-submenu', 'menu.close']
    .find((id) => matchesKey(e, id));
  if (!act) return;
  e.preventDefault();
  e.stopPropagation();
  if (act === 'menu.next') moveSel(level, 1);
  else if (act === 'menu.prev') moveSel(level, -1);
  else if (act === 'menu.choose') { if (level.sel >= 0) activateItem(level, level.sel); }
  else if (act === 'menu.open-submenu') { if (level.items[level.sel]?.submenu) activateItem(level, level.sel); }
  else if (act === 'menu.close-submenu') { if (m.levels.length > 1) m.levels.pop().el.remove(); }
  else closeMenu(null);
}

window.addEventListener('blur', () => closeMenu(null));
window.addEventListener('resize', () => closeMenu(null));

// ---------- dialogs ----------
// showDialog({ title, message, buttons: [{ id, label, primary?, danger? }], checkbox?: { label, checked },
//              fields?: [{ id, label, value }] })
//   -> Promise<{ id, checked, values }>   (id is null when dismissed)
function showDialog({ title, message, buttons, checkbox, fields, icon: ic }) {
  return dialogTurn(() => new Promise((resolve) => {
    const el = h(`<div class="dlg-backdrop"><div class="dlg" role="dialog" aria-modal="true">
      ${ic ? `<div class="dlg-icon">${icon(ic, 22)}</div>` : ''}
      <div class="dlg-title">${esc(title)}</div>
      ${message ? `<div class="dlg-msg">${esc(message)}</div>` : ''}
      ${checkbox ? `<label class="dlg-check"><input type="checkbox" ${checkbox.checked ? 'checked' : ''}> ${esc(checkbox.label)}</label>` : ''}
      ${(fields || []).map((f) => `<label class="dlg-field"><span>${esc(f.label)}</span><input class="field" type="${f.type === 'password' ? 'password' : 'text'}" data-field="${esc(f.id)}" value="${esc(f.value ?? '')}" spellcheck="false" autocomplete="off"></label>`).join('')}
      <div class="dlg-buttons">${buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger-fill' : ''}" data-id="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div>
    </div></div>`);
    const restoreFocus = document.activeElement;
    const finish = (id) => {
      if (!OV.dialog) return;
      OV.dialog = null;
      el.remove();
      if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
      resolve({ id, checked: Boolean($('.dlg-check input', el)?.checked), values: Object.fromEntries($$('[data-field]', el).map((i) => [i.dataset.field, i.value])) });
    };
    OV.dialog = { finish };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (b) finish(b.dataset.id);
      else if (e.target === el) finish(null);
    });
    el.addEventListener('keydown', (e) => {
      if (matchesKey(e, 'dialog.cancel')) { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (matchesKey(e, 'dialog.confirm')) {
        // presses the focused button (Tab moves between them), otherwise the highlighted one
        e.preventDefault();
        e.stopPropagation();
        finish(e.target.dataset?.id || (buttons.find((b) => b.primary) || buttons[0]).id);
      }
    });
    document.body.append(el);
    const first = el.querySelector('[data-field]');
    if (first) { first.focus(); first.select(); } else (el.querySelector('.btn.primary') || el.querySelector('.btn')).focus();
  }));
}

// A question from main (main.js askUi), asked in a dialog; resolves the answer main expects. Used by Ultima's windows
// and its pop-up windows (popup.js). Screen sharing has its own picker (sitesettings.js).
async function askDialog(kind, payload) {
  if (kind === 'permission') {
    const r = await showDialog({
      icon: 'shield',
      title: `${payload.site} wants to ${payload.what}`,
      buttons: [{ id: 'block', label: 'Block' }, { id: 'allow', label: 'Allow', primary: true }],
      checkbox: { label: 'Remember my decision for this site', checked: true },
    });
    return { allow: r.id === 'allow', remember: r.checked && r.id !== null };
  }
  if (kind === 'login') {
    // a server or proxy asking for a username and password (see the app 'login' handler in main.js)
    const r = await showDialog({
      icon: 'key',
      title: payload.proxy ? `The proxy ${payload.host} needs you to sign in` : `${payload.host} needs you to sign in`,
      message: [
        payload.retry && 'That username or password didn’t work. Try again.',
        payload.realm && `It says: “${payload.realm}”`,
        payload.insecure && 'Your sign-in will be sent over a connection that isn’t private.',
      ].filter(Boolean).join(' '),
      fields: [{ id: 'username', label: 'Username' }, { id: 'password', label: 'Password', type: 'password' }],
      buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'signin', label: 'Sign in', primary: true }],
    });
    return r.id === 'signin' && r.values.username ? { username: r.values.username, password: r.values.password } : null;
  }
  if (kind === 'page-dialog') {
    // a page's alert(), confirm() or prompt() (see dialog-preload.js)
    const { type, message, value, from } = payload;
    const r = await showDialog({
      title: from ? `${from} says` : 'This page says',
      message,
      fields: type === 'prompt' ? [{ id: 'value', label: '', value }] : undefined,
      buttons: type === 'alert' ? [{ id: 'ok', label: 'OK', primary: true }] : [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'OK', primary: true }],
    });
    if (type === 'prompt') return r.id === 'ok' ? r.values.value : null;
    return type === 'confirm' ? r.id === 'ok' : null;
  }
  return null;
}

// Drop-in replacement for window.confirm(): resolves true/false.
async function confirmDialog(message, { title, ok = 'OK', danger = false } = {}) {
  const r = await showDialog({
    title: title || message,
    message: title ? message : '',
    icon: danger ? 'trash' : undefined,
    buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: ok, primary: !danger, danger }],
  });
  return r.id === 'ok';
}

// Asks for some text (a name, an address): resolves the values by field id, or null when canceled.
async function editDialog({ title, fields, ok = 'Save' }) {
  const r = await showDialog({ title, fields, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: ok, primary: true }] });
  return r.id === 'ok' ? r.values : null;
}

// ---------- tooltips ----------
// Native tooltips use the system font, so `title` attributes are shown by Ultima instead.
(() => {
  let tipEl = null;
  let timer = null;
  let current = null;
  const hide = () => { clearTimeout(timer); tipEl?.remove(); tipEl = null; current = null; };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (el === current) return;
    hide();
    if (!el) return;
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
    if (!el.dataset.tip) return;
    current = el;
    timer = setTimeout(() => {
      if (!document.contains(el)) return;
      tipEl = h(`<div class="tooltip">${esc(el.dataset.tip).replace(/\n/g, '<br>')}</div>`);
      document.body.append(tipEl);
      const r = el.getBoundingClientRect();
      const t = tipEl.getBoundingClientRect();
      let x = r.left + r.width / 2 - t.width / 2;
      let y = r.bottom + 6;
      if (y + t.height > window.innerHeight - 4) y = r.top - t.height - 6;
      x = Math.max(4, Math.min(x, window.innerWidth - t.width - 4));
      tipEl.style.left = `${x}px`;
      tipEl.style.top = `${y}px`;
    }, 550);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
})();
