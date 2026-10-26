// Extensions in the UI: pinned toolbar buttons, popups, the address bar menu and installing from the Chrome Web Store.
const EXT = { list: [], popup: null, menu: null };
const STORE_DETAIL = /^https:\/\/(?:chromewebstore\.google\.com\/detail|chrome\.google\.com\/webstore\/detail)\/(?:[^/]+\/)?([a-p]{32})/i;
const STORE_HOME = 'https://chromewebstore.google.com/category/extensions';

const storeIdOf = (url) => (url || '').match(STORE_DETAIL)?.[1]?.toLowerCase() || null;
const extIcon = (ext, size = 18) => (ext.icon
  ? `<img class="ext-icon" src="${esc(ext.icon)}" width="${size}" height="${size}" alt="">`
  : `<span class="ext-icon ext-icon-blank" style="width:${size}px;height:${size}px">${icon('puzzle', size - 4)}</span>`);

async function refreshExtensions() {
  EXT.list = await window.ultima.listExtensions();
  renderExtActions();
  rerenderIfShowing('settings');
  if (EXT.menu) renderUrlMenu();
}

// ---------- toolbar ----------
function renderExtActions() {
  const box = $('#ext-actions');
  if (!box) return;
  box.innerHTML = EXT.list.filter((e) => e.enabled && e.pinned && !e.error).map((e) => `
    <button class="icon-btn ext-btn" data-ext="${esc(e.id)}" title="${esc(e.name)}">${extIcon(e, 18)}</button>`).join('');
  updateStoreButton();
}

// "Add to Ultima" appears while you're on an extension's Chrome Web Store page
function updateStoreButton() {
  const btn = $('#btn-cws');
  const id = storeIdOf(activeTab()?.url);
  const installed = id && EXT.list.some((e) => e.id === id);
  btn.hidden = !id;
  btn.disabled = Boolean(installed) || btn.classList.contains('busy');
  if (!btn.classList.contains('busy')) btn.innerHTML = `${icon(installed ? 'check' : 'plus', 14)}${installed ? 'Added to Ultima' : 'Add to Ultima'}`;
}

async function installFromStore(input) {
  const btn = $('#btn-cws');
  btn.classList.add('busy');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Adding…';
  try {
    const ext = await window.ultima.installExtensionFromStore(input);
    toast(ext.error ? `${ext.name} was added but couldn’t start: ${ext.error}` : `Added ${ext.name}`, { label: 'Manage', run: () => runCommand('open-extensions') });
    return ext;
  } catch (err) {
    toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return null;
  } finally {
    btn.classList.remove('busy');
    await refreshExtensions();
  }
}

// ---------- popups ----------
// fromPage: a page took focus. A popout that has only just opened stays: it was opened from a click in the page
// (Bitwarden's "Unlock account"), and that page may take focus back a moment later.
function closeExtensionPopup({ fromPage = false } = {}) {
  if (fromPage && EXT.popup?.dataset.popout && Date.now() - Number(EXT.popup.dataset.openedAt) < 1500) return;
  EXT.popup?.remove();
  EXT.popup = null;
}

// `popout` ({ path, width, height }): one of the extension's own pages it asked to open in a popup window (e.g.
// Bitwarden's unlock screen), shown here at the size it asked for instead of its usual popup page.
async function openExtension(ext, anchor, popout = null) {
  closeUrlMenu();
  const tab = activeTab();
  const partition = tab ? tabPartition(tab) : SHARED_PARTITION;
  const runtimeId = await window.ultima.extensionRuntimeId({ id: ext.id, partition });
  if (!runtimeId) return toast(`${ext.name} isn’t running${ext.error ? `: ${ext.error}` : ''}`);
  if (!ext.popup && !popout) {
    if (ext.optionsPage) return createTab({ url: `chrome-extension://${runtimeId}/${ext.optionsPage.replace(/^\//, '')}` });
    return toast(`${ext.name} works on pages by itself and has no popup`);
  }
  if (EXT.popup?.dataset.ext === ext.id && !popout) return closeExtensionPopup(); // second click closes it
  closeExtensionPopup();
  const page = (popout ? popout.path : ext.popup).replace(/^\//, '');
  const wrap = h(`<div class="ext-popup" data-ext="${esc(ext.id)}"><webview partition="${esc(partition)}"
      src="chrome-extension://${esc(runtimeId)}/${esc(page)}"></webview></div>`);
  document.body.append(wrap);
  EXT.popup = wrap;
  const wv = $('webview', wrap);
  if (popout) {
    // a window's worth of page, at the size the extension asked for (within the window), focused for typing
    wrap.dataset.popout = '1';
    wrap.dataset.openedAt = String(Date.now());
    wv.style.width = `${Math.min(780, window.innerWidth - 12, Math.max(320, popout.width || 380))}px`;
    wv.style.height = `${Math.min(600, window.innerHeight - 12, Math.max(300, popout.height || 600))}px`;
    wv.addEventListener('dom-ready', () => window.ultima.popoutShown(wv.getWebContentsId()), { once: true });
  } else {
    // Like Chrome, start small and grow to the popup's content (max 780×600), following it as it changes.
    wv.style.width = '120px';
    wv.style.height = '40px';
  }
  const fit = async () => {
    if (EXT.popup !== wrap || popout) return;
    try {
      const [w, hgt] = await wv.executeJavaScript(`(() => { const d = document.documentElement, b = document.body;
        return [Math.max(d.scrollWidth, b ? b.scrollWidth : 0), Math.max(d.scrollHeight, b ? b.scrollHeight : 0)]; })()`);
      const width = `${Math.min(780, Math.max(120, Math.ceil(w)))}px`;
      const height = `${Math.min(600, Math.max(40, Math.ceil(hgt)))}px`;
      if (wv.style.width !== width || wv.style.height !== height) { wv.style.width = width; wv.style.height = height; place(); }
    } catch { /* page still loading */ }
    setTimeout(fit, 250);
  };
  wv.addEventListener('dom-ready', fit, { once: true });
  // Like Chrome, an open popup has the keyboard straight away, so you can type into the field it focuses itself
  // (Bitwarden's PIN) without clicking first. The web page behind keeps the keyboard otherwise, and only real input
  // moves it (see ultima:focus-guest in main), so once the popup has put its cursor in a field, that field gets a
  // click of its own — only where the field itself is the element under the point, so nothing else is pressed.
  // Retried until the popup has the keyboard, for up to 2 s; stops if you've moved on to something else meanwhile.
  const focusedField = `(() => {
    const el = document.activeElement;
    if (!el || !el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable="true"]')) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(12, r.width / 2), y = r.top + r.height / 2; // near the start, clear of icons at the end
    return document.elementFromPoint(x, y) === el ? [x, y] : null;
  })()`;
  let lastBox = '';
  const giveFocus = async (tries) => {
    if (EXT.popup !== wrap || tries <= 0) return;
    const at = document.activeElement;
    if (at && at !== document.body && at !== wv && at.tagName !== 'WEBVIEW') return; // you're in Ultima's own UI
    let has = false;
    try { has = await wv.executeJavaScript('document.hasFocus()'); } catch { /* page not ready yet */ }
    if (has) return;
    // the popup grows to fit its page as it opens: click only once it has stopped moving, so the click lands on the field
    const box = wv.getBoundingClientRect();
    const key = `${box.left},${box.top},${box.width},${box.height}`;
    const settled = key === lastBox;
    lastBox = key;
    if (settled) {
      let field = null;
      try { field = await wv.executeJavaScript(focusedField); } catch { /* page not ready yet */ }
      const point = field && { x: box.left + field[0], y: box.top + field[1] };
      const inside = point && point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
      wv.focus();
      try { window.ultima.focusGuest(wv.getWebContentsId(), inside ? point : null); } catch { /* not attached yet */ }
    }
    setTimeout(() => giveFocus(tries - 1), 100);
  };
  wv.addEventListener('dom-ready', () => giveFocus(20), { once: true });
  wv.addEventListener('close', closeExtensionPopup); // window.close() from the popup
  wrap.dataset.runtime = runtimeId;
  wv.addEventListener('did-finish-load', () => { wrap.dataset.loadedAt = String(Date.now()); });
  wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) { closeExtensionPopup(); toast(`${ext.name}’s popup couldn’t open`); } });
  function place() {
    const a = anchor.getBoundingClientRect();
    const r = wrap.getBoundingClientRect();
    // anchors on the left (the address bar) open rightwards; toolbar buttons open leftwards
    const left = a.left < window.innerWidth / 2 ? a.left : a.right - r.width;
    wrap.style.left = `${Math.max(6, Math.min(left, window.innerWidth - r.width - 6))}px`;
    wrap.style.top = `${Math.max(6, Math.min(a.bottom + 6, window.innerHeight - r.height - 6))}px`;
  }
  place();
  return undefined;
}

// ---------- address bar menu ----------
function closeUrlMenu() {
  EXT.menu?.remove();
  EXT.menu = null;
  closeSitePanel();
}

function openUrlMenu() {
  if (EXT.menu) return closeUrlMenu();
  closeExtensionPopup();
  closeSitePanel(); // always opens on the menu itself
  const el = h('<div class="url-menu" role="dialog" aria-label="Address bar menu" tabindex="-1"></div>');
  document.body.append(el);
  EXT.menu = el;
  renderUrlMenu();
  const r = $('#urlbar').getBoundingClientRect();
  el.style.left = `${r.left}px`;
  el.style.top = `${r.bottom + 6}px`;
  el.style.minWidth = `${Math.max(280, r.width)}px`;
  el.focus();
  el.addEventListener('keydown', (e) => {
    if (matchesKey(e, 'popover.close')) { e.preventDefault(); e.stopPropagation(); closeUrlMenu(); }
  });
  el.addEventListener('click', onUrlMenuClick);
  el.addEventListener('change', (e) => { if (e.target.dataset.siteKey) onSitePanelChange(e.target); });
  return undefined;
}

function renderUrlMenu() {
  const el = EXT.menu;
  if (!el) return;
  el.classList.toggle('site-view', Boolean(SITE.panel));
  if (SITE.panel) { el.innerHTML = sitePanelHtml(); return; } // the current site's settings (sitesettings.js)
  const downloading = [...B.downloads.values()].filter((d) => d.state === 'progressing').length;
  const tile = (act, ic, label, cmd, extra = '') => `<button class="um-tile" data-act="${act}" title="${esc(withKey(label, cmd))}">${icon(ic, 20)}<span>${label}</span>${extra}</button>`;
  const storeId = storeIdOf(activeTab()?.url);
  const exts = EXT.list.filter((e) => e.enabled);
  el.innerHTML = `
    ${urlMenuSiteRow()}
    <div class="um-tiles">
      ${tile('history', 'history', 'History', 'open-history')}
      ${tile('downloads', 'download', 'Downloads', 'open-downloads', downloading ? `<span class="um-badge">${downloading}</span>` : '')}
      ${tile('extensions', 'puzzle', 'Extensions', 'open-extensions')}
    </div>
    ${storeId && !EXT.list.some((e) => e.id === storeId) ? `<button class="um-install" data-act="install">${icon('plus', 15)} Add this extension to Ultima</button>` : ''}
    ${exts.length ? `<div class="um-head">Extensions</div><div class="um-list">${exts.map((e) => `
      <div class="um-ext ${e.error ? 'broken' : ''}" data-ext="${esc(e.id)}" title="${esc(e.error || e.name)}">
        ${extIcon(e, 18)}<span class="um-name">${esc(e.name)}</span>
        <button class="icon-btn um-pin ${e.pinned ? 'on' : ''}" data-pin="${esc(e.id)}" title="${e.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}">${icon('pin', 14)}</button>
      </div>`).join('')}</div>` : ''}
    <button class="um-link" data-act="store">${icon('external', 14)} Get extensions from the Chrome Web Store</button>`;
}

async function onUrlMenuClick(e) {
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    const ext = EXT.list.find((x) => x.id === pin.dataset.pin);
    await window.ultima.setExtensionPinned({ id: ext.id, pinned: !ext.pinned });
    return;
  }
  const row = e.target.closest('.um-ext');
  if (row) { openExtension(EXT.list.find((x) => x.id === row.dataset.ext), $('#urlbar')); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'site') { openSitePanel(); return; }
  if (act.startsWith('site-')) { onSitePanelAction(act); return; }
  closeUrlMenu();
  if (act === 'history') runCommand('open-history');
  else if (act === 'downloads') runCommand('open-downloads');
  else if (act === 'extensions') runCommand('open-extensions');
  else if (act === 'store') createTab({ url: STORE_HOME });
  else if (act === 'install') installFromStore(activeTab().url);
}

function initExtensionsUi() {
  $('#ext-actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    if (b) openExtension(EXT.list.find((x) => x.id === b.dataset.ext), b);
  });
  $('#ext-actions').addEventListener('contextmenu', async (e) => {
    const b = e.target.closest('[data-ext]');
    if (!b) return;
    e.preventDefault();
    const ext = EXT.list.find((x) => x.id === b.dataset.ext);
    const choice = await showMenu([
      { id: 'open', label: ext.popup ? 'Open' : 'Options', icon: 'external', enabled: Boolean(ext.popup || ext.optionsPage) },
      { id: 'unpin', label: 'Unpin from toolbar', icon: 'pin' },
      { id: 'manage', label: 'Manage extensions', icon: 'puzzle', shortcut: 'open-extensions' },
    ]);
    if (choice === 'open') openExtension(ext, b);
    else if (choice === 'unpin') window.ultima.setExtensionPinned({ id: ext.id, pinned: false });
    else if (choice === 'manage') runCommand('open-extensions');
  });
  $('#btn-cws').addEventListener('click', () => installFromStore(activeTab().url));
  // clicks anywhere else close the menu and popup
  document.addEventListener('mousedown', (e) => {
    if (EXT.menu && !EXT.menu.contains(e.target) && !e.target.closest('#btn-url-menu, .ctx-layer, .dlg-backdrop')) closeUrlMenu();
    if (EXT.popup && !EXT.popup.contains(e.target) && !e.target.closest('.ext-btn, .um-ext')) closeExtensionPopup();
  }, true);
  window.ultima.on('extensions-changed', refreshExtensions);
  // The extension's background restarted under an open popup (Bitwarden does this, e.g. on lock): the popup's
  // connections died with it, so reload the popup to reconnect, as Chrome would. A start caused by the popup
  // opening itself doesn't count.
  window.ultima.on('ext-worker-started', (runtimeId) => {
    const popup = EXT.popup;
    if (!popup || popup.dataset.runtime !== runtimeId || !popup.dataset.loadedAt) return;
    if (Date.now() - Number(popup.dataset.loadedAt) < 1500) return;
    delete popup.dataset.loadedAt;
    try { $('webview', popup).reload(); } catch { closeExtensionPopup(); }
  });
  // chrome.tabs.remove from an extension: tab ids are the pages' webContents ids (a popout counts as a tab too)
  window.ultima.on('ext-close-tabs', (ids) => {
    for (const t of [...B.tabs]) if (ready(t) && ids.includes(t.webview.getWebContentsId())) closeTab(t.id, { remove: true });
    const pop = EXT.popup?.dataset.popout && $('webview', EXT.popup);
    try { if (pop && ids.includes(pop.getWebContentsId())) closeExtensionPopup(); } catch { /* not attached yet */ }
  });
  // an extension opening one of its pages in a popup window, or closing that window (see openPopoutForExtension)
  window.ultima.on('ext-open-popout', ({ id, path, width, height }) => {
    const ext = EXT.list.find((x) => x.id === id);
    if (!ext) return;
    const anchor = $(`#ext-actions [data-ext="${CSS.escape(id)}"]`) || $('#urlbar');
    openExtension(ext, anchor, { path, width, height });
  });
  window.ultima.on('ext-close-popout', () => { if (EXT.popup?.dataset.popout) closeExtensionPopup(); });
  refreshExtensions();
}
