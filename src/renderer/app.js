// Boot, commands, toolbar state, find-in-page and theming.
B.downloads = new Map();

// Opens a built-in page, reusing one that is already open (e.g. Settings on any of its tabs).
// "settings#privacy" also switches that page to the given tab.
const openInternal = (name) => {
  const url = `ultima://${name}`;
  const base = name.split('#')[0];
  const existing = spaceTabs().find((t) => isInternal(t.url) && internalName(t.url) === base);
  if (existing) {
    if (name.includes('#') && existing.url !== url) existing.url = url;
    activateTab(existing.id);
    if (existing.id === B.activeId) renderInternal(existing);
    return;
  }
  const cur = activeTab();
  if (cur && cur.url === NEWTAB) navigate(cur, url);
  else createTab({ url });
};

function zoom(tab, delta) {
  if (!ready(tab)) return;
  tab.zoom = delta === 0 ? 0 : Math.max(-5, Math.min(5, tab.zoom + delta));
  tab.webview.setZoomLevel(baseZoomLevel() + tab.zoom); // on top of the default zoom (accessibility.js)
  updateChrome();
}

async function fillLogin(tab) {
  if (!ready(tab)) return toast('Open a website first');
  const logins = await window.ultima.passwordsFor(tab.url);
  if (!logins.length) return toast(`No saved login for ${hostname(tab.url)}`);
  let id = logins[0].id;
  if (logins.length > 1) {
    id = await showMenu(logins.map((l) => ({ id: l.id, label: l.username || '(no username)' })));
    if (!id) return;
  }
  const ok = await window.ultima.fillPassword({ webContentsId: tab.webview.getWebContentsId(), id });
  if (!ok) toast('Couldn’t find a login form on this page');
}

function runCommand(cmd) {
  const tab = activeTab();
  const wv = ready(tab) && !isInternal(tab.url) ? tab.webview : null;
  if (/^tab-\d$/.test(cmd)) {
    const n = Number(cmd.slice(4));
    const tabs = spaceTabs();
    const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (target) activateTab(target.id);
    return;
  }
  if (/^space-\d$/.test(cmd)) {
    const space = B.spaces[Number(cmd.slice(6)) - 1];
    if (space) switchSpace(space.id);
    return;
  }
  if (cmd.startsWith('go-space:')) return switchSpace(cmd.slice(9));
  if (cmd.startsWith('move-to-space:')) return moveTabToSpace(tab, cmd.slice(14));
  switch (cmd) {
    case 'palette': return $('#palette-backdrop').hidden ? openPalette('any') : closePalette();
    case 'new-tab': return openPalette('new');
    case 'new-window': return openNewWindow();
    case 'new-private-window': return openNewWindow(true);
    case 'new-private-tab': return newPrivateTab();
    case 'quit': return window.ultima.quit();
    case 'edit-url': return openPalette('current', tab && !(tab.url === NEWTAB) ? tab.url : '');
    case 'close-tab': if (GL.open) return closeGlance(); return windowIsEmpty() ? window.ultima.closeWindow() : tab && closeTab(tab.id);
    case 'reopen-tab': return reopenClosedTab();
    case 'duplicate-tab': return duplicateTab(tab);
    case 'pin-tab': return togglePin(tab);
    case 'essential-tab': return toggleEssential(tab);
    case 'caret-browsing': {
      const on = !B.settings.caretBrowsing;
      applySettings({ caretBrowsing: on });
      rerenderIfShowing('settings');
      return toast(on ? 'Caret browsing on: move through pages with the arrow keys' : 'Caret browsing off');
    }
    case 'unload-tab': return unloadTab(tab);
    case 'reset-tab': return resetToPinnedPage(tab);
    case 'edit-pinned-link': return tab && isKept(tab) ? editPinnedLink(tab) : toast('Only pinned tabs and Essentials have a pinned link');
    case 'replace-pinned-link':
      if (!tab || !isKept(tab)) return toast('Only pinned tabs and Essentials have a pinned link');
      return awayFromHome(tab) ? setPinnedPage(tab) : toast('This tab is on its pinned link already');
    case 'mute-tab': return toggleMute(tab);
    case 'close-others': return spaceTabs().filter((t) => t !== tab && t.zone === 'normal').forEach((t) => closeTab(t.id));
    case 'next-tab': return cycleTab(1);
    case 'prev-tab': return cycleTab(-1);
    case 'next-space': return cycleSpace(1);
    case 'prev-space': return cycleSpace(-1);
    case 'new-space': return createSpace();
    case 'rename-space': sidebarShowForCommand(); return startRenameSpace();
    case 'space-theme': return openThemeEditor();
    case 'toggle-loading-animation': {
      const on = B.settings.loadingIndicator === false;
      applySettings({ loadingIndicator: on });
      updateChrome();
      return toast(on ? 'Loading animation on' : 'Loading animation off');
    }
    case 'space-options': {
      // (with horizontal tabs the space's name row is hidden: the menu hangs from its icon in the tab strip)
      const r = (tabsAcross() ? $('#space-bar .space-chip.on') : $('#space-head')).getBoundingClientRect();
      return spaceMenu(activeSpace(), { x: r.left + 8, y: r.bottom + 4 });
    }
    case 'toggle-space-separate': return setSpaceSeparate(activeSpace(), !activeSpace().separate);
    case 'delete-space': return deleteSpace(activeSpace());
    case 'reload':
      if (wv) wv.reload(); else if (tab && isInternal(tab.url)) renderInternal(tab);
      return undefined;
    case 'hard-reload': return wv?.reloadIgnoringCache();
    case 'back':
      if (wv?.canGoBack()) wv.goBack();
      else if (tab && isInternal(tab.url) && tab.webview) navigate(tab, tab.webview.getURL());
      return undefined;
    case 'forward': return wv?.canGoForward() && wv.goForward();
    case 'home': return tab && navigate(tab, NEWTAB);
    case 'bookmark': return toggleBookmark();
    case 'copy-url':
      if (tab) copyText(tab.url, 'URL copied');
      return undefined;
    case 'find': return openFind();
    case 'fill-login': return fillLogin(tab);
    case 'zoom-in': return zoom(tab, 0.5);
    case 'zoom-out': return zoom(tab, -0.5);
    case 'zoom-reset': return zoom(tab, 0);
    case 'toggle-sidebar':
      if (tabsAcross()) return toast('The compact sidebar is for vertical tabs');
      return applySettings({ sidebarCollapsed: !B.settings.sidebarCollapsed });
    case 'toggle-tab-layout': return toggleTabLayout();
    case 'toggle-sidebar-hidden': return toggleSidebarHidden();
    case 'toggle-fullscreen': return window.ultima.toggleFullscreen();
    case 'open-import': return openInternal('settings#import');
    case 'make-default-browser': return makeDefaultBrowser();
    case 'open-extensions': return openInternal('settings#extensions');
    case 'url-menu': return openUrlMenu();
    case 'open-bookmarks': return openInternal('waypoints');
    case 'task-manager': return openTaskManager(); // its own window (taskwindow.js)
    case 'welcome': return startWelcome({ replay: true });
    case 'open-history': return openInternal('history');
    case 'tab-history': return toggleTabHistory();
    case 'open-downloads': return openInternal('downloads');
    case 'open-passwords': return openInternal('settings#passwords');
    case 'open-settings': return openInternal('settings');
    case 'open-shortcuts': return openInternal('settings#shortcuts');
    case 'customize-sidebar': return openInternal('settings#appearance/sidebar-buttons');
    case 'toggle-bookmarks-bar': return toggleBookmarksBar();
    case 'import-bookmarks-bar': return importChromeBookmarkBar();
    case 'rename-tab': sidebarShowForCommand(); return startRenameTab(activeTab());
    case 'split-tab': return splitActive();
    case 'unsplit-tab': return activeTab()?.splitId ? unsplitTab(activeTab()) : toast('This tab isn’t in split view');
    case 'split-move-left': return movePane(activeTab(), -1);
    case 'split-move-right': return movePane(activeTab(), 1);
    case 'split-focus-next': return focusNextPane(1);
    case 'split-focus-prev': return focusNextPane(-1);
    case 'tab-folder-new': return newTabFolder(activeTab());
    case 'tab-folder-remove': return activeTab()?.folderId ? removeTabFromFolder(activeTab()) : toast('This tab isn’t in a folder');
    case 'clear-data': return openInternal('settings#privacy');
    case 'theme-dark': return applySettings({ theme: 'dark' });
    case 'theme-light': return applySettings({ theme: 'light' });
    case 'theme-system': return applySettings({ theme: 'system' });
    case 'print': return wv?.print();
    case 'devtools':
      if (wv) { if (wv.isDevToolsOpened()) wv.closeDevTools(); else wv.openDevTools(); }
      return undefined;
    default: return undefined;
  }
}

async function toggleBookmark() {
  const tab = activeTab();
  if (!tab || isInternal(tab.url)) return;
  const added = await window.ultima.toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon });
  toast(added ? 'Added to the Waypoints bar' : 'Waypoint removed', added ? { label: 'Undo', run: () => window.ultima.toggleBookmark({ url: tab.url }).then(updateChrome) } : undefined);
  updateChrome();
}

// ---------- toolbar / URL bar ----------
// The gradient keeps moving while it fades out, so a finished load eases away instead of freezing.
// (the address bar and the line under the toolbar both carry it; Settings → Address bar picks which one shows)
function setUrlbarLoading(loading) {
  const els = [$('#urlbar'), $('#load-line')];
  const was = els[0].classList.contains('loading');
  for (const el of els) el.classList.toggle('loading', loading);
  if (was && !loading) {
    for (const el of els) el.classList.add('finishing');
    clearTimeout(setUrlbarLoading.timer);
    setUrlbarLoading.timer = setTimeout(() => { for (const el of els) el.classList.remove('finishing'); }, 600);
  }
}


const updateChrome = debounce(async () => {
  const tab = activeTab();
  if (!tab) return;
  const internal = isInternal(tab.url);
  const wv = ready(tab) && !internal ? tab.webview : null;
  const secure = tab.url.startsWith('https://');
  setUrlbarLoading(B.settings.loadingIndicator !== false && tab.loading && !internal);
  updateStoreButton();
  updateShield();
  $('.url-icon').innerHTML = icon(internal ? 'sparkle' : secure ? 'lock' : tab.url.startsWith('http://') ? 'unlock' : 'search', 14);
  $('.url-icon').classList.toggle('secure', secure);
  // (the whole address in a traditional address bar: Settings → Address bar)
  const shown = addressMode() === 'classic' ? tab.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : hostname(tab.url) || tab.url;
  $('.url-text').textContent = internal ? 'Search or enter address' : shown + (tab.url.startsWith('http://') ? ' — not secure' : '');
  if (tab.private && !B.private) $('.url-text').insertAdjacentHTML('afterbegin', '<span class="url-private">Private</span>'); // among normal tabs
  $('#page-title').textContent = internal ? '' : tab.title;
  $('#btn-back').disabled = !(wv?.canGoBack() || (internal && tab.webview));
  $('#btn-forward').disabled = !wv?.canGoForward();
  $('#btn-reload').innerHTML = icon(tab.loading ? 'stop' : 'reload', 16);
  $('#btn-star').hidden = internal;
  $('#btn-find').hidden = internal;
  const zoomPct = Math.round(1.2 ** (baseZoomLevel() + tab.zoom) * 100);
  $('#zoom-pill').hidden = !wv || tab.zoom === 0;
  $('#zoom-pill').textContent = `${zoomPct}%`;
  if (!internal) {
    const [marked, logins] = await Promise.all([window.ultima.isBookmarked(tab.url), window.ultima.passwordsFor(tab.url)]);
    if (activeTab() !== tab) return;
    $('#btn-star').classList.toggle('on', marked);
    $('#btn-star').innerHTML = icon('star', 16).replace('fill="none"', marked ? 'fill="currentColor"' : 'fill="none"');
    $('#btn-key').hidden = !logins.length;
  } else {
    $('#btn-key').hidden = true;
  }
}, 30);

// ---------- find in page ----------
function openFind() {
  const tab = activeTab();
  if (!ready(tab) || isInternal(tab.url)) return;
  $('#findbar').hidden = false;
  $('#find-input').focus();
  $('#find-input').select();
  if ($('#find-input').value) tab.webview.findInPage($('#find-input').value);
}

function closeFind() {
  if ($('#findbar').hidden) return;
  $('#findbar').hidden = true;
  $('#find-count').textContent = '';
  for (const t of B.tabs) if (ready(t)) t.webview.stopFindInPage('clearSelection');
  activeTab()?.webview?.focus();
}

function initFind() {
  const input = $('#find-input');
  const find = (forward = true, findNext = false) => {
    const tab = activeTab();
    if (!ready(tab)) return;
    if (!input.value) { tab.webview.stopFindInPage('clearSelection'); $('#find-count').textContent = ''; return; }
    tab.webview.findInPage(input.value, { forward, findNext });
  };
  input.addEventListener('input', () => find(true, false));
  input.addEventListener('keydown', (e) => {
    if (matchesKey(e, 'find.next')) { e.preventDefault(); find(true, true); }
    else if (matchesKey(e, 'find.prev')) { e.preventDefault(); find(false, true); }
    else if (matchesKey(e, 'find.close')) { e.preventDefault(); closeFind(); }
  });
  $('#find-prev').onclick = () => find(false, true);
  $('#find-next').onclick = () => find(true, true);
  $('#find-close').onclick = closeFind;
  $('#find-prev').innerHTML = icon('arrowUp', 15);
  $('#find-next').innerHTML = icon('arrowDown', 15);
  $('#find-close').innerHTML = icon('close', 15);
}

// ---------- right-click menus and questions from main ----------
// A web page was right-clicked: main sends the items (and keeps their actions); the UI draws the menu.
async function onPageMenu({ token, webContentsId, x, y, items }) {
  // Electron reports webview right-clicks in window coordinates already
  const tab = B.tabs.find((t) => ready(t) && t.webview.getWebContentsId() === webContentsId);
  const id = await showMenu(items, { x, y });
  if (!id) return;
  tab?.webview.focus(); // edit commands act on the page's focused text box
  await new Promise((done) => { setTimeout(done, 30); });
  window.ultima.choosePageMenu({ token, id });
}

async function onAsk({ id, kind, payload }) {
  let answer = null;
  if (kind === 'permission') {
    const r = await showDialog({
      icon: 'shield',
      title: `${payload.site} wants to ${payload.what}`,
      buttons: [{ id: 'block', label: 'Block' }, { id: 'allow', label: 'Allow', primary: true }],
      checkbox: { label: 'Remember my decision for this site', checked: true },
    });
    answer = { allow: r.id === 'allow', remember: r.checked && r.id !== null };
  } else if (kind === 'login') {
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
    answer = r.id === 'signin' && r.values.username ? { username: r.values.username, password: r.values.password } : null;
  }
  window.ultima.answerAsk({ id, answer });
}

// Right-clicks on Ultima's own UI (tabs and spaces handle theirs first and mark the event handled).
async function onUiContextMenu(e) {
  if (e.defaultPrevented) return;
  e.preventDefault();
  if (e.target.closest('.ctx-layer, .dd-layer, .dlg-backdrop')) return;
  const field = e.target.closest('textarea, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])');
  const selected = window.getSelection().toString().trim();
  const mod = KEYS.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const sep = { type: 'separator' };
  let menuButton = null; // a sidebar button right-clicked
  let items;
  if (field) {
    field.focus();
    const hasSel = field.selectionStart !== undefined ? field.selectionStart !== field.selectionEnd : Boolean(selected);
    items = [
      { id: 'edit:undo', label: 'Undo', hint: `${mod}+Z` },
      { id: 'edit:redo', label: 'Redo', hint: `${mod}+Y` },
      sep,
      { id: 'edit:cut', label: 'Cut', icon: 'cut', hint: `${mod}+X`, enabled: hasSel },
      { id: 'edit:copy', label: 'Copy', icon: 'copy', hint: `${mod}+C`, enabled: hasSel },
      { id: 'edit:paste', label: 'Paste', icon: 'paste', hint: `${mod}+V` },
      { id: 'edit:pasteAndMatchStyle', label: 'Paste as plain text', hint: `${mod}+Shift+V` },
      { id: 'edit:selectAll', label: 'Select all', hint: `${mod}+A` },
    ];
  } else if (selected) {
    items = [
      { id: 'edit:copy', label: 'Copy', icon: 'copy', hint: `${mod}+C` },
      { id: 'ui-search', label: `Search for “${selected.length > 28 ? `${selected.slice(0, 28)}…` : selected}”`, icon: 'search' },
    ];
  } else if (e.target.closest('#sidebar')) {
    // (the sidebar, or with horizontal tabs the tab strip and toolbar: tablayout.js)
    const sbb = e.target.closest('[data-sbb]')?.dataset.sbb;
    const across = tabsAcross();
    items = [
      ...(sbb ? [{ id: 'sbb-remove', label: `Remove “${SIDEBAR_BUTTONS[sbb].label}” from the ${across ? 'toolbar' : 'sidebar'}`, icon: 'minus' },
        { id: 'customize-sidebar', label: `Customize ${across ? 'toolbar' : 'sidebar'} buttons…`, icon: 'sidebar', shortcut: 'customize-sidebar' }, sep] : []),
      { id: 'new-tab', label: 'New tab', icon: 'plus', shortcut: 'new-tab' },
      { id: 'new-space', label: 'New space', icon: 'layers', shortcut: 'new-space' },
      { id: 'reopen-tab', label: 'Reopen closed tab', icon: 'history', shortcut: 'reopen-tab' },
      sep,
      { id: 'space-theme', label: `Edit ${activeSpace().name} theme…`, icon: 'palette', shortcut: 'space-theme' },
      // vertical tabs on (the sidebar) or off (a tab strip across the top)
      { id: 'toggle-tab-layout', label: 'Vertical tabs', type: 'checkbox', checked: !across, shortcut: 'toggle-tab-layout' },
      ...(across ? [] : [
        { id: 'toggle-sidebar', label: B.settings.sidebarCollapsed ? 'Expand sidebar' : 'Compact sidebar', icon: 'sidebar', shortcut: 'toggle-sidebar' },
        { id: 'toggle-sidebar-hidden', label: B.settings.sidebarHidden ? 'Keep sidebar open' : 'Hide sidebar', icon: 'sidebar', shortcut: 'toggle-sidebar-hidden' },
      ]),
      ...(sbb ? [] : [{ id: 'customize-sidebar', label: `Customize ${across ? 'toolbar' : 'sidebar'} buttons…`, icon: 'sidebar', shortcut: 'customize-sidebar' }]),
      { id: 'open-shortcuts', label: 'Keyboard shortcuts', icon: 'command', shortcut: 'open-shortcuts' },
      { id: 'open-settings', label: 'Settings', icon: 'settings', shortcut: 'open-settings' },
    ];
    if (sbb) menuButton = sbb;
  } else {
    items = [
      { id: 'palette', label: 'Control Palette', icon: 'command', shortcut: 'palette' },
      { id: 'new-tab', label: 'New tab', icon: 'plus', shortcut: 'new-tab' },
      { id: 'reload', label: 'Reload', icon: 'reload', shortcut: 'reload' },
      sep,
      { id: 'open-settings', label: 'Settings', icon: 'settings', shortcut: 'open-settings' },
    ];
  }
  const id = await showMenu(items, { x: e.clientX, y: e.clientY });
  if (!id) return;
  if (id.startsWith('edit:')) { field?.focus(); window.ultima.uiEdit(id.slice(5)); }
  else if (id === 'ui-search') createTab({ url: searchUrl(selected, B.settings.searchEngine) });
  else if (id === 'sbb-remove') removeSidebarButton(menuButton);
  else runCommand(id);
}

// ---------- keyboard shortcuts ----------
// Saves new overrides, re-arms the main-process listener and relabels every hint in the UI.
function applyKeybindings(overrides) {
  B.settings.keybindings = overrides;
  loadKeys(overrides);
  window.ultima.setSettings({ keybindings: overrides });
  refreshKeyHints();
  renderPaletteFoot();
  renderTabs();
  renderSpaces();
}

// ---------- theme & settings ----------
function applyTheme() {
  const s = B.settings;
  const dark = effectiveDark(); // the active space's theme can force light or dark
  const rootEl = document.documentElement;
  rootEl.dataset.theme = dark ? 'dark' : 'light';
  rootEl.style.setProperty('--accent', B.private ? PRIVATE_ACCENT : s.accent);
  rootEl.style.setProperty('--on-accent', inkOn(s.accent)); // the shield's checkmark
  applySpaceVars();
  applyAccessibility();
  window.ultima.setNativeTheme(themeMode());
  // Glass tint over the system blur: higher = smokier, so bright windows behind don't glare through.
  const tint = Math.max(0, Math.min(90, s.glassTint ?? 45)) / 100;
  rootEl.style.setProperty('--glass', dark ? `rgba(20, 20, 26, ${tint})` : `rgba(248, 248, 252, ${tint})`);
  rootEl.style.setProperty('--sidebar-w', `${s.sidebarWidth}px`);
  rootEl.style.setProperty('--ess-height', `${Math.max(36, Math.min(72, s.essentialsHeight ?? 44))}px`);
  applySidebarStyle(); // font, text size and tab height (sidebarstyle.js)
  applyTabLayout(); // vertical or horizontal tabs (tablayout.js)
  document.body.classList.toggle('loader-line', s.loadingStyle === 'line');
  document.body.classList.toggle('addr-classic', addressMode() === 'classic'); // a text cursor over the address bar // the loading animation as a line under the toolbar
  document.body.classList.toggle('collapsed', Boolean(s.sidebarCollapsed) && !tabsAcross()); // (a compact sidebar is a vertical-tabs thing)
  const wasHidden = document.body.classList.contains('sb-hidden');
  const wasPeeking = document.body.classList.contains('sb-peek');
  document.body.classList.toggle('sb-hidden', sidebarHidden());
  if (!sidebarHidden()) document.body.classList.remove('sb-peek');
  // kept open again: it slides in from the left edge (unless it was already out, peeking)
  if (wasHidden && !sidebarHidden() && !wasPeeking) slideSidebarIn();
  document.body.classList.toggle('acrylic', Boolean(B.backdrops) && s.windowMaterial === 'acrylic');
  if (document.body.classList.contains('bm-bar-center') !== Boolean(s.centerBookmarksBar)) {
    document.body.classList.toggle('bm-bar-center', Boolean(s.centerBookmarksBar));
    fitBookmarkBar();
  }
  if (document.body.classList.contains('bm-bar-on') !== bmShown()) {
    // drawn first and laid out while still shut, so its buttons ease in as it slides open
    renderBookmarkBar();
    void $('#bookmark-bar').offsetHeight;
    document.body.classList.toggle('bm-bar-on', bmShown());
  }
  const styles = getComputedStyle(rootEl);
  window.ultima.setOverlay({ color: styles.getPropertyValue('--chrome').trim(), symbolColor: styles.getPropertyValue('--text').trim() });
}

function applySettings(patch) {
  Object.assign(B.settings, patch);
  window.ultima.setSettings(patch);
  applyTheme();
}

// ---------- full screen ----------
// A page going full screen (a video) or coming back out cuts to black and fades up, like a film, so the window's jump
// in size is never seen. The window has already switched when Ultima hears of it (the <webview> becomes this
// document's full-screen element), so the black is a popover: shown after the page, it's in the top layer above it.
// It never takes the pointer, so the video's controls work during the fade.
const FS = { veil: null, timer: 0, fade: null };
function fullscreenFade() {
  if (document.body.classList.contains('reduce-motion')) return;
  if (!FS.veil) {
    FS.veil = h('<div class="fs-veil" popover="manual" aria-hidden="true"></div>');
    document.body.append(FS.veil);
  }
  const v = FS.veil;
  clearTimeout(FS.timer);
  FS.fade?.cancel();
  if (v.matches(':popover-open')) v.hidePopover();
  v.showPopover(); // (again: the newest in the top layer is the one on top)
  v.style.opacity = '1';
  // a moment for the page to lay itself out at its new size, then up out of black
  FS.timer = setTimeout(() => {
    FS.fade = v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    FS.fade.finished.then(() => { v.style.opacity = '0'; v.hidePopover(); }, () => {});
  }, 140);
}

// F11: Ultima's own full screen. The page fills the screen with no toolbar or Waypoints bar, and the sidebar tucks away,
// sliding in from the left edge (as when it's hidden: sidebarhide.js), all through the same fade as a video.
function onWindowFullscreen({ on, immersive }) {
  if (!on) document.body.classList.remove('fullscreen'); // a page's full screen ended with the window's
  const was = Boolean(B.immersive);
  B.immersive = Boolean(on && immersive);
  if (B.immersive === was) return;
  document.body.classList.toggle('immersive', B.immersive);
  fullscreenFade();
  applyTheme();
  const key = keyText('toggle-fullscreen');
  if (B.immersive) toast(key ? `Press ${key} to leave full screen` : 'Full screen');
}

// ---------- downloads ----------
function onDownload(d) {
  const prev = B.downloads.get(d.id);
  B.downloads.set(d.id, d);
  // every window lists it; only the window it started in announces it
  const here = !d.windowId || d.windowId === B.windowId;
  if (here && !prev) toast(`Downloading ${d.filename}`, { label: 'Show', run: () => runCommand('open-downloads') });
  else if (here && prev.state !== 'completed' && d.state === 'completed') toast(`${d.filename} downloaded`, { label: 'Open', run: () => window.ultima.openDownload(d.id) });
  else if (here && (d.state === 'interrupted' || d.state === 'cancelled')) toast(`${d.filename} failed to download`);
  $('.dl-badge').hidden = ![...B.downloads.values()].some((x) => x.state === 'progressing');
  rerenderIfShowing('downloads');
  if (WG.kind === 'downloads') renderWidget(); // the Downloads dropdown follows along (widgets.js)
}

// ---------- boot ----------
async function boot() {
  const state = await window.ultima.getState();
  initWindows(state); // private or not decides much of what follows
  B.settings = state.settings;
  B.versions = state.versions;
  B.dataFolder = state.dataFolder;
  B.systemDark = state.systemDark;
  B.backdrops = state.backdrops;
  B.hardwareAcceleration = state.hardwareAcceleration; // what this run started with (Settings → General → Performance)
  loadKeys(B.settings.keybindings, state.platform);
  for (const d of state.downloads) B.downloads.set(d.id, d);
  document.body.classList.toggle('mac', state.platform === 'darwin');
  // the mouse's back and forward buttons over Ultima itself (a built-in page) act on the tab in front; over the
  // vertical sidebar they switch to the previous or next space. Web pages pass theirs on themselves (webview-preload.js)
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    const back = e.button === 3;
    if (e.target.closest?.('#sidebar') && !tabsAcross() && !B.private && B.spaces.length > 1) runCommand(back ? 'prev-space' : 'next-space');
    else runCommand(back ? 'back' : 'forward');
  });
  document.body.classList.toggle('glass', state.glass);
  applyTheme();

  $('#brand').innerHTML = `${LOGO}<span>Ultima</span>${B.private ? `<span class="private-badge" title="Pages you visit here aren’t saved">${icon('incognito', 13)} Private</span>` : ''}`;
  // the sidebar's customizable buttons are set up in sidebarbuttons.js
  const buttons = {
    'btn-collapse': ['sidebar', 'toggle-sidebar'], 'btn-star': ['star', 'bookmark'], 'btn-find': ['find', 'find'], 'btn-key': ['key', 'fill-login'],
  };
  for (const [id, [ic, cmd]] of Object.entries(buttons)) {
    const b = document.getElementById(id);
    b.insertAdjacentHTML('afterbegin', icon(ic, 16));
    b.addEventListener('click', () => runCommand(cmd));
  }
  initSidebarButtons();
  initBookmarkBar();
  $('.nt-icon').innerHTML = icon('plus', 16);
  $('#btn-newtab').onclick = () => openPalette('new');
  $('#urlbar').onclick = (e) => runCommand(e.target.closest('#btn-url-menu') ? 'url-menu' : 'edit-url');
  $('#btn-url-menu').innerHTML = icon('sliders', 16);
  initExtensionsUi();
  initSiteSettings();
  initBlocking();
  initTabHistory();
  initWidgets();
  $('#zoom-pill').onclick = () => zoom(activeTab(), 0);

  initTabStrip();
  initPinRings();
  initTabFolderUi();
  initTabRename();
  initTabCardDrag();
  initTabDock();
  initSplitView();
  initGlance();
  initTaskManager();
  initDropdowns();
  initAccessibility();
  initSpaceUi();
  initResizer();
  initSidebarHide();
  initTabLayout();
  initPalette();
  initFind();
  refreshKeyHints();
  renderPaletteFoot();

  window.ultima.on('command', (cmd) => {
    if (cmd !== 'palette' && cmd !== 'new-tab' && cmd !== 'edit-url') closePalette();
    runCommand(cmd);
  });
  window.ultima.on('open-url', async ({ url, search, background, pickSpace, private: priv }) => {
    const target = search ? searchUrl(search, B.settings.searchEngine) : url;
    if (pickSpace) {
      const spaceId = await showMenu(B.spaces.map((s) => ({ id: s.id, label: `${s.icon}  ${s.name}`, enabled: s.id !== B.activeSpaceId })));
      if (spaceId) createTab({ url: target, spaceId });
      return;
    }
    createTab({ url: target, activate: !background, opener: activeTab() || undefined, private: priv });
  });
  window.ultima.on('page-menu', onPageMenu);
  window.ultima.on('ask', onAsk);
  document.addEventListener('contextmenu', onUiContextMenu);
  window.ultima.on('download', onDownload);
  window.ultima.on('system-theme', (dark) => { B.systemDark = dark; applyTheme(); });
  window.ultima.on('window-fullscreen', onWindowFullscreen);
  document.addEventListener('fullscreenchange', fullscreenFade);

  // Toolbar buttons shouldn't take focus from the page on click (that also triggered stray focus rings).
  document.addEventListener('mousedown', (e) => { if (e.target.closest('.icon-btn, .urlbar, .newtab-row')) e.preventDefault(); });

  // Tell main when a text box in the UI has focus, so single-key shortcuts don't fire while you type.
  let uiTyping = null;
  const reportUiTyping = () => {
    const el = document.activeElement;
    const now = Boolean(el) && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      || (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|reset|color|file)$/.test(el.type)));
    if (now !== uiTyping) { uiTyping = now; window.ultima.reportTyping(now); }
  };
  document.addEventListener('focusin', reportUiTyping);
  document.addEventListener('focusout', () => setTimeout(reportUiTyping, 0));

  // Closes overlays when the UI (not a page) has focus.
  window.addEventListener('keydown', (e) => {
    // inside the palette or find bar their own bindings decide, so remapping "Close palette" really takes Esc away
    if (e.defaultPrevented || e.target.closest?.('#palette, #findbar') || !matchesKey(e, 'ui.close')) return;
    if (!$('#palette-backdrop').hidden) closePalette(); else closeFind();
  });

  // restore the sidebar every window shares (spaces, then pinned tabs and Essentials, which come back on their pinned
  // link), then this window's own tabs (main leaves those out when "Restore tabs" is off); tabs from before spaces
  // existed land in the first space
  const own = state.window;
  const torn = state.tearOff; // a tab torn off another window (tabdrag.js): this window opens on it, in its space
  initSpaces(state.sidebar?.spaces, own?.activeSpaceId ?? torn?.spaceId);
  initTabFolders([...(own?.folders || []), ...(state.sidebar?.folders || []).map((f) => ({ ...f, zone: 'pinned' }))]);
  initSplits(own?.splits);
  const restored = withFoldersHeld(() => withSplitsHeld(() => {
    for (const k of state.sidebar?.kept || []) {
      createTab({ ...k, url: k.homeUrl, title: k.homeTitle || hostname(k.homeUrl) || k.homeUrl, favicon: k.homeFavicon || '', activate: false, lazy: true });
    }
    return (own?.tabs || []).map((t) => createTab({ ...t, zone: 'normal', activate: false, lazy: true }));
  }));
  const active = (own?.active?.key && B.tabs.find((t) => t.key === own.active.key)) || restored[own?.active?.normal] || null;
  const tornKept = keptCopy(torn?.key); // a pinned tab or Essential: this window's copy of it takes the page
  if (tornKept) {
    takeInto(tornKept, torn);
    tornKept.cameFrom = torn.cameFrom;
  } else if (torn) {
    const tab = createTab({ url: torn.url || NEWTAB, title: torn.title, name: torn.name, favicon: torn.favicon, spaceId: torn.spaceId, restore: torn.restore });
    Object.assign(tab, { zoom: torn.zoom || 0, muted: Boolean(torn.muted), cameFrom: torn.cameFrom }); // (its menu can send it back)
  } else if (state.launchUrl) createTab({ url: state.launchUrl });
  else if (active) activateTab(active.id);
  else if (restored.length) activateTab(restored[0].id);
  else createTab({ url: NEWTAB });
  markSidebarSaved();
  B.restored = true; // from now on the window saves its tabs (saveSession)
  // Settings shows whether Ultima is the default browser; that changes outside Ultima (in Windows Settings)
  window.addEventListener('focus', () => { if (B.defaultBrowser) refreshDefaultBrowser(); });
  if (shouldWelcome()) startWelcome(); // the first time: the welcome film, which sets Ultima up (welcome.js)
}

boot();
