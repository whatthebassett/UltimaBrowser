// Tab model, <webview> lifecycle and the vertical tab sidebar.
const B = {
  tabs: [],
  activeId: null,
  settings: {},
  closed: [],
  nextId: 1,
  dragId: null,
  selected: new Set(), // ids of the tabs chosen with Ctrl / Shift+click (tabselect.js)
  private: false, // a private window (windows.js)
  windowId: null,
};

const NEWTAB = 'ultima://newtab';
const isInternal = (url) => typeof url === 'string' && url.startsWith('ultima://');
const activeTab = () => B.tabs.find((t) => t.id === B.activeId) || null;
const tabById = (id) => B.tabs.find((t) => t.id === id) || null;
const ready = (tab) => tab?.webview && tab.ready;
// what a tab is called in Ultima: the name you gave it, else its page's title
const tabLabel = (tab) => tab?.name || tab?.title || '';

// Sidebar zones, top to bottom. Essentials are shared by every space; pinned and normal tabs belong to one space.
// Essentials and pinned tabs stay in the sidebar: closing them only unloads the page.
const ZONES = ['essential', 'pinned', 'normal'];
const isKept = (tab) => tab.zone !== 'normal';
// A pinned tab or Essential belongs to its pinned link (homeUrl, with homeTitle/homeFavicon to show while unloaded).
// It can wander off, but closing it (which unloads it), unloading it or restarting Ultima puts it back there.
const awayFromHome = (tab) => isKept(tab) && Boolean(tab.homeUrl) && tab.url !== tab.homeUrl;
const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
// on another site than its pinned link (landing elsewhere on the same site, like after a redirect, doesn't count)
const offSite = (tab) => awayFromHome(tab) && siteOf(tab.url) !== siteOf(tab.homeUrl);
const isUnloaded = (tab) => !tab.webview && !isInternal(tab.url);
const sortZones = () => { B.tabs = ZONES.flatMap((z) => B.tabs.filter((t) => t.zone === z)); };

const INTERNAL_TITLES = {
  newtab: 'New Tab', settings: 'Settings', history: 'History', waypoints: 'Waypoints',
  import: 'Import browser data', passwords: 'Passwords', downloads: 'Downloads', shortcuts: 'Keyboard shortcuts', tasks: 'Task manager',
};
const internalName = (url) => {
  const name = url.replace('ultima://', '').split(/[/?#]/)[0];
  return name === 'bookmarks' ? 'waypoints' : name; // the Waypoints page's address before they were renamed
};

function createTab({
  url = NEWTAB, title, name, favicon = '', zone, pinned = false, homeUrl, homeTitle, homeFavicon, activate = true, lazy = false, index, opener, spaceId, folderId, splitId,
  key, private: priv = false, essentialsOf, restore,
} = {}) {
  // a private window's tabs are all private (windows.js); private tabs are regular tabs, never pinned
  const isPriv = B.private || Boolean(priv);
  // `pinned` is the pre-Essentials session format, where pinned tabs were the icon grid
  const z = isPriv ? 'normal' : ZONES.includes(zone) ? zone : pinned ? 'essential' : 'normal';
  const tab = {
    id: B.nextId++,
    private: isPriv || undefined,
    key: z === 'normal' ? undefined : key || newTabKey(), // names a pinned tab or Essential in every window
    spaceId: spaceById(spaceId) ? spaceId : opener?.spaceId || B.activeSpaceId,
    url,
    title: (isInternal(url) && INTERNAL_TITLES[internalName(url)]) || title || (isInternal(url) ? 'Ultima' : url),
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    favicon,
    zone: z,
    homeUrl: z === 'normal' ? undefined : homeUrl || url,
    loading: false,
    webview: null,
    ready: false,
    zoom: 0,
    audible: false,
    muted: false,
    error: null,
  };
  // one of a space's own Essentials belongs to that space (spaces.js)
  if (z === 'essential' && essentialsSpace(essentialsOf)) Object.assign(tab, { essentialsOf, spaceId: essentialsOf });
  if (z !== 'normal') {
    tab.homeTitle = homeTitle || (tab.url === tab.homeUrl ? tab.title : hostname(tab.homeUrl) || tab.homeUrl);
    tab.homeFavicon = homeFavicon ?? (tab.url === tab.homeUrl ? favicon : '');
  }
  // a tab opened from a tab in a folder joins that folder, as in Chrome (pinned folders hold only pinned tabs)
  if (z !== 'essential') tab.folderId = folderById(folderId)?.zone === z ? folderId : z === 'normal' && opener?.zone === 'normal' ? opener.folderId : undefined;
  if (z === 'normal' && splitById(splitId)) tab.splitId = splitId; // restoring a session
  if (restore) tab.restore = restore; // a tab torn off another window: its page comes with its history (tabdrag.js)
  let at = index ?? B.tabs.length;
  if (index === undefined && opener) {
    // open next to the tab that spawned it, after its other children
    const oi = B.tabs.indexOf(opener);
    at = oi + 1;
    while (B.tabs[at] && B.tabs[at].openerId === opener.id) at += 1;
    tab.openerId = opener.id;
  }
  B.tabs.splice(at, 0, tab);
  sortZones();
  if (!lazy && !isInternal(url)) ensureWebview(tab);
  if (activate) activateTab(tab.id);
  else renderTabs();
  saveSession();
  return tab;
}

// `adopt`: a page already open in #viewport (a glance becoming a tab) instead of a new one
function ensureWebview(tab, adopt = null) {
  if (tab.webview) return tab.webview;
  const wv = adopt || document.createElement('webview');
  if (!adopt) {
    wv.setAttribute('partition', tabPartition(tab));
    wv.setAttribute('allowpopups', '');
    wv.className = 'hidden';
    wv.src = isInternal(tab.url) ? 'about:blank' : tab.restore ? `about:blank?ultima-restore=${tab.restore}` : tab.url;
    tab.restore = undefined;
  }
  tab.webview = wv;
  tab.ready = Boolean(adopt);

  const isActive = () => B.activeId === tab.id;
  const changed = () => { renderTabs(); if (isActive()) updateChrome(); saveSession(); };
  const addHistory = (entry) => { if (!tab.private) window.ultima.addHistory(entry); }; // private pages leave no history

  wv.addEventListener('dom-ready', () => {
    const first = !tab.ready;
    tab.ready = true;
    pageReady(wv, tab); // its zoom and accessibility style sheet, for each new document (accessibility.js)
    if (first && tab.muted) wv.setAudioMuted(true);
    if (first) applySiteSound(tab); // a site whose sound is blocked (sitesettings.js)
    if (first && isActive()) notifyActiveTab(tab); // the page is attached now, so it has an id to report
    if (isActive()) updateChrome();
  });
  wv.addEventListener('did-start-loading', () => { tab.loading = true; tab.error = null; renderError(); changed(); });
  wv.addEventListener('did-stop-loading', () => { tab.loading = false; changed(); });
  // (a kept tab on its pinned site remembers how it looks there, for when it goes back unloaded)
  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.url;
    if (isKept(tab) && !offSite(tab)) tab.homeTitle = tab.title;
    if (tab.folderId) refreshGroupName(folderById(tab.folderId)); // an automatic group named from its tabs' titles
    addHistory({ url: tab.url, title: tab.title, visit: false });
    changed();
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    tab.favicon = e.favicons?.[0] || '';
    if (isKept(tab) && !offSite(tab)) tab.homeFavicon = tab.favicon;
    changed();
  });
  wv.addEventListener('did-navigate', (e) => {
    if (hostname(e.url) !== hostname(tab.url)) tab.favicon = '';
    const otherSite = siteOrigin(e.url) !== siteOrigin(tab.url);
    tab.url = e.url;
    passwordOfferOnNavigate(tab); // "Save password?" is for the site it came from (pwfill.js)
    if (otherSite) applySiteSound(tab);
    if (isActive()) showContent(tab);
    addHistory({ url: e.url, visit: true });
    autoGroupTab(tab); // into its app's or site's folder (autogroup.js)
    changed();
  });
  wv.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    addHistory({ url: e.url, title: tab.title, visit: true });
    autoGroupTab(tab);
    changed();
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return; // -3 = aborted (e.g. user navigated away)
    tab.error = { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL };
    tab.loading = false;
    if (isActive()) renderError();
    changed();
  });
  wv.addEventListener('render-process-gone', () => {
    if (endedByTaskManager(wv)) { unloadTab(tab); return; } // ended in the task manager: it loads again when opened
    tab.error = { code: 'crashed', desc: 'The page crashed', url: tab.url };
    if (isActive()) renderError();
  });
  wv.addEventListener('media-started-playing', () => { tab.audible = true; renderTabs(); });
  wv.addEventListener('media-paused', () => { tab.audible = false; renderTabs(); });
  wv.addEventListener('update-target-url', (e) => {
    if (!isActive()) return;
    const s = $('#status');
    s.textContent = e.url;
    s.hidden = !e.url;
  });
  wv.addEventListener('found-in-page', (e) => {
    if (isActive()) $('#find-count').textContent = e.result.matches ? `${e.result.activeMatchOrdinal}/${e.result.matches}` : '0/0';
  });
  wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('fullscreen'));
  wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('fullscreen'));
  // clicks inside a page never reach this document, so a page taking focus is what closes open menus and popups
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'ultima:pane-top') setPaneHover(tab, Boolean(e.args[0]));
    else if (e.channel === 'ultima:swipe') onPageSwipe(tab, e.args[0] || {}); // swipe.js
    else if (e.channel === 'ultima:page-press') clearTabSelection(); // a click in the page is a click away from the tabs you chose (tabselect.js)
  });
  wv.addEventListener('focus', () => {
    focusPane(tab); // in split view, the pane you click into becomes the active tab
    if (!$('#palette-backdrop').hidden) closePalette();
    closeMenu(null);
    closeUrlMenu();
    closeTabHistory();
    closeWidget();
    closeExtensionPopup({ fromPage: true });
  });

  if (adopt) applySiteSound(tab); // what dom-ready does for a new page
  else $('#viewport').prepend(wv);
  return wv;
}

// Drops the page (freeing its memory) but keeps the tab; it loads again when activated.
function dropWebview(tab) {
  tab.webview?.remove();
  tab.webview = null;
  tab.ready = false;
  tab.loading = false;
  tab.audible = false;
  tab.error = null;
}

function activateTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  if (GL.open && GL.open.source !== tab) closeGlance({ instant: true }); // a glance belongs to the page it came from
  if (id !== B.activeId) { closeLoginMenu(); closePasswordOffer(); } // (pwfill.js; the key button brings an offer back)
  B.activeId = id;
  tab.lastActive = Date.now();
  // shared Essentials don't change the space you are in, unless it has Essentials of its own (then it's one that doesn't)
  const home = homeSpaceOf(tab) || (essentialsSpace() ? B.spaces.find((s) => !s.ownEssentials)?.id : undefined);
  if (home && home !== B.activeSpaceId) {
    B.activeSpaceId = home;
    applySpaceTheme();
    renderSpaces();
  }
  if (!isInternal(tab.url)) ensureWebview(tab);
  showContent(tab);
  notifyActiveTab(tab);
  closeFind();
  $('#status').hidden = true;
  renderTabs();
  updateChrome();
  saveSession();
  requestAnimationFrame(() => {
    const el = $(`[data-tab="${id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  });
}

// Tells main which page is showing (extensions get chrome.tabs.onActivated). Tab ids are the pages' webContents ids.
function notifyActiveTab(tab) {
  updateSidePanel(); // a side panel set for one tab shows only while that tab is in front
  if (!tab?.webview || isInternal(tab.url)) { window.ultima.setActiveTab(null); return; }
  try { window.ultima.setActiveTab(tab.webview.getWebContentsId()); } catch { /* not attached yet: dom-ready reports it */ }
}

// Shows either the tab's webview (with the other panes of its split view) or its internal page. With no tab (a space
// with nothing open in it), the new tab page shows, without a tab of its own: what you open from it gets one.
function showContent(tab) {
  if (!tab) { showNoTab(); return; }
  // (a split's panes can be Ultima's own pages too: split.js draws those in the panes)
  const panes = tab.splitId ? splitTabs(tab.splitId) : [tab];
  for (const t of B.tabs) t.webview?.classList.toggle('hidden', !(panes.includes(t) && !isInternal(t.url)));
  layoutPanes(isInternal(tab.url) && !tab.splitId ? null : tab);
  const internal = $('#internal');
  window.ultima.setKeyRecording(false); // leaving the shortcut recorder, however it happens, re-arms shortcuts
  if (tab.splitId) {
    internal.hidden = true;
    internal.innerHTML = '';
    if ($('#palette-backdrop').hidden) setTimeout(() => { if (!B.renaming) focusPaneContent(tab); }, 0);
  } else if (isInternal(tab.url)) {
    // keystrokes must not keep going to a page that is now hidden
    if (document.activeElement?.tagName === 'WEBVIEW') document.activeElement.blur();
    internal.hidden = false;
    renderInternal(tab);
  } else {
    internal.hidden = true;
    internal.innerHTML = '';
    // (not while a tab's name is being typed: a double-click opens the tab with its first click)
    if ($('#palette-backdrop').hidden) setTimeout(() => { if (!B.renaming) tab.webview?.focus(); }, 0);
  }
  renderError();
}

function showNoTab() {
  for (const t of B.tabs) t.webview?.classList.add('hidden');
  layoutPanes(null);
  window.ultima.setKeyRecording(false);
  if (document.activeElement?.tagName === 'WEBVIEW') document.activeElement.blur();
  const internal = $('#internal');
  internal.hidden = false;
  renderInternal(null);
  renderError();
}

// The tab you were on went away and nothing else in its space can take its place: no tab is made for it, the space
// just has nothing open (showContent). When that was the last thing the window had open and you closed it (rather than
// unloading or moving it), the window closes too, as in Chrome.
function leaveEmpty({ closing = false } = {}) {
  B.activeId = null;
  closeGlance({ instant: true }); // (a glance belongs to the tab that's gone, not to the empty space)
  if (closing && windowHasNothingOpen()) { closeEmptyWindow(); return; }
  showContent(null);
  notifyActiveTab(null);
  updateChrome();
}

// No regular tab open in any space (a new tab page left behind doesn't count) and no pinned tab or Essential loaded.
const windowHasNothingOpen = () => B.tabs.every((t) => (t.zone === 'normal' ? t.url === NEWTAB : !t.webview));

function closeEmptyWindow() {
  B.closing = true; // (nothing more to draw or save once it's going)
  saveSessionNow(); // what comes back next time is what's left, not the tab you just closed
  window.ultima.closeWindow();
}

function renderError() {
  $('#viewport .error-page')?.remove();
  const tab = activeTab();
  if (!tab?.error || isInternal(tab.url)) return;
  const e = tab.error;
  const friendly = {
    '-105': 'The server’s address couldn’t be found.', '-106': 'You appear to be offline.',
    '-102': 'The site refused to connect.', '-118': 'The site took too long to respond.',
    '-501': 'Insecure response.', '-200': 'The site’s security certificate isn’t valid.',
  }[e.code] || e.desc || 'Something went wrong.';
  const page = h(`<div class="error-page">${icon('globe', 40)}<h2>Can’t reach this page</h2>
    <p>${esc(hostname(e.url) || e.url)} — ${esc(friendly)}</p><code>${esc(e.desc || e.code)}</code>
    <div style="margin-top:10px"><button class="btn primary">${icon('reload')} Try again</button></div></div>`);
  page.querySelector('button').onclick = () => { tab.error = null; renderError(); tab.webview?.loadURL(e.url); };
  $('#viewport').append(page);
}

function navigate(tab, url) {
  if (!tab || !url) return;
  tab.error = null;
  if (isInternal(url)) {
    tab.url = url;
    tab.title = INTERNAL_TITLES[internalName(url)] || 'Ultima';
    tab.favicon = '';
  } else if (!tab.webview) {
    tab.url = url;
    ensureWebview(tab);
  } else {
    tab.url = url;
    tab.webview.loadURL(url).catch(() => {});
  }
  if (tab.id === B.activeId) showContent(tab);
  else if (tab.splitId && tab.splitId === activeTab()?.splitId) showContent(activeTab());
  renderTabs();
  updateChrome();
  saveSession();
}

// Which tab can take over when the one you're on goes: any regular tab, asleep or not (it loads as it opens), but a
// pinned tab or Essential only while it's open. One you've closed stays closed, so closing them all closes the window.
const canTakeOver = (t) => t.zone === 'normal' || !isUnloaded(t);
const mostRecent = (tabs) => [...tabs].sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];

// Where to go when `tab` stops being the active one (with `gone`, the other tabs going with it), in the current space:
// regular tabs first, then open pinned tabs, then open Essentials. Among the tabs of its own kind: in a folder, the
// tab above it there (below, if it was the top one); otherwise its opener, then its neighbor in the sidebar, then the
// most recently used. In the next kind along, the most recently used. None left: null.
function pickNextTab(tab, gone = [tab]) {
  const ok = (t) => !gone.includes(t) && canTakeOver(t);
  const all = spaceTabs();
  if (tab.folderId) {
    const folder = all.filter((t) => t.folderId === tab.folderId && (t === tab || ok(t)));
    const i = folder.indexOf(tab);
    const sibling = i >= 0 && (folder[i - 1] || folder[i + 1]);
    if (sibling) return sibling;
  }
  for (const zone of ['normal', 'pinned', 'essential']) {
    const list = all.filter((t) => t.zone === zone && (t === tab || ok(t)));
    const visible = list.filter((t) => t !== tab);
    if (!visible.length) continue;
    if (zone !== tab.zone) return mostRecent(visible);
    const i = list.indexOf(tab);
    const opener = visible.find((t) => t.id === tab.openerId);
    return opener || list[i + 1] || list[i - 1] || mostRecent(visible);
  }
  return null;
}

// Closing a tab: its row slides up and fades away while the rows below glide up into its place. The list is redrawn
// at once (the next tab is open straight away), so the row that leaves is a copy laid over the sidebar, and the
// rows that move are animated from where they were (FLIP). Call before the tab goes; run what it returns after.
// `ids`: one tab's id, or several closing together.
function animateTabClose(ids) {
  const rows = [].concat(ids).map((id) => $(`#sidebar [data-tab="${id}"]`)).filter((row) => row?.getClientRects().length);
  if (!rows.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  if (sidebarHidden() && !sidebarPeeking()) return null; // nothing to see
  const keyOf = (el) => (el.dataset.tab ? `t${el.dataset.tab}` : el.dataset.folderHead ? `f${el.dataset.folderHead}` : el);
  const movers = () => $$('#sidebar [data-tab], #sidebar [data-folder-head], #btn-newtab, #space-head, #sidebar .zone-sep');
  const before = new Map(movers().map((el) => [keyOf(el), el.getBoundingClientRect()]));
  const ghosts = rows.map((row) => {
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('tab-ghost');
    ghost.classList.remove('selected');
    ghost.removeAttribute('data-tab');
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    return ghost;
  });
  return () => {
    for (const ghost of ghosts) {
      document.body.append(ghost);
      ghost.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-60%)', opacity: 0 }],
        { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () => ghost.remove();
    }
    for (const el of movers()) {
      const a = before.get(keyOf(el));
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 220, delay: 50, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' });
    }
  };
}

// Essentials and pinned tabs: close = unload. Pass { remove: true } to take them out of the sidebar.
// (`animate: false` when the caller slides several rows away together)
function closeTab(id, { remove = false, animate = true } = {}) {
  const tab = tabById(id);
  if (!tab) return;
  if (isKept(tab) && !remove) { unloadTab(tab, { closing: true }); return; }
  const slide = TD.drag || !animate ? null : animateTabClose(id);
  const idx = B.tabs.indexOf(tab);
  // a closed private tab can come back only inside a private window
  if (!tab.private || B.private) B.closed.push({ url: tab.url, title: tab.title, name: tab.name, favicon: tab.favicon, zone: tab.zone, homeUrl: tab.homeUrl, homeTitle: tab.homeTitle, homeFavicon: tab.homeFavicon, index: idx, spaceId: tab.spaceId, folderId: tab.folderId, essentialsOf: tab.essentialsOf });
  if (B.closed.length > 25) B.closed.shift();
  const next = B.activeId === id ? pickNextTab(tab) : undefined;
  if (next) activateTab(next.id);
  dropWebview(tab);
  B.tabs = B.tabs.filter((t) => t !== tab);
  // nothing left to open in its space (or nothing was open: several closing together)
  if (next === null || !B.activeId) { leaveEmpty({ closing: true }); if (B.closing) return; }
  renderTabs();
  slide?.();
  saveSession();
}

// Nothing open but a new tab page (or nothing at all): no other tab in any space (other than new tab pages), no
// pinned tab or Essential loaded. Closing then closes the window.
const windowIsEmpty = () => {
  const tab = activeTab();
  const blank = (t) => t.zone === 'normal' && t.url === NEWTAB;
  return (!tab || blank(tab)) && B.tabs.every((t) => t === tab || blank(t) || (isKept(t) && !t.webview));
};

// (`closing`: its × or Ctrl+W, which closes the window when it was all the window had open)
function unloadTab(tab, { closing = false } = {}) {
  if (!tab) return;
  const next = B.activeId === tab.id ? pickNextTab(tab) : undefined;
  if (next) activateTab(next.id);
  dropWebview(tab);
  if (tab.splitId) tab.splitId = undefined; // out of its split view (its pane would stay blank)
  sendHome(tab);
  if (next === null || !B.activeId) { leaveEmpty({ closing }); if (B.closing) return; }
  renderTabs();
  saveSession();
}

// Puts a kept tab back on its pinned link without loading it (it loads there when opened).
function sendHome(tab) {
  if (!awayFromHome(tab)) return;
  tab.url = tab.homeUrl;
  tab.title = tab.homeTitle || hostname(tab.homeUrl) || tab.homeUrl;
  tab.favicon = tab.homeFavicon || '';
}

function reopenClosedTab() {
  const c = B.closed.pop();
  if (!c) return toast('No recently closed tabs');
  createTab({ url: c.url, title: c.title, name: c.name, favicon: c.favicon, zone: c.zone, homeUrl: c.homeUrl, homeTitle: c.homeTitle, homeFavicon: c.homeFavicon, index: c.index, spaceId: c.spaceId, folderId: c.folderId, essentialsOf: c.essentialsOf });
}

// Moves a tab into a zone. Shared Essentials use the shared sign-ins, so crossing that line may reload the page.
function applyZone(tab, zone) {
  if (tab.zone === zone) return;
  const before = tabPartition(tab);
  if (tab.zone === 'essential') Object.assign(tab, { spaceId: B.activeSpaceId, essentialsOf: undefined }); // an essential leaving lands in the space you are in
  // one joining goes to its space's own Essentials, if it has them, or the shared ones
  if (zone === 'essential') tab.essentialsOf = essentialsSpace(tab.spaceId);
  if (tab.zone === 'normal') Object.assign(tab, { homeUrl: tab.url, homeTitle: tab.title, homeFavicon: tab.favicon }); // pinned where it is
  if (zone === 'normal') Object.assign(tab, { homeUrl: undefined, homeTitle: undefined, homeFavicon: undefined, key: undefined });
  else { tab.splitId = undefined; tab.key ??= newTabKey(); } // split views hold regular tabs only
  if (folderById(tab.folderId)?.zone !== zone) tab.folderId = undefined; // and a folder holds regular or pinned tabs
  tab.zone = zone;
  if (tab.webview && tabPartition(tab) !== before) {
    dropWebview(tab);
    if (tab.id === B.activeId) { ensureWebview(tab); showContent(tab); }
  }
}

function moveTab(id, toIndex, zone) {
  const tab = tabById(id);
  if (!tab) return;
  // pinned tabs and Essentials are in every window's sidebar, so a private page can't become one
  if (tab.private && zone !== 'normal') { toast('Private tabs can’t be pinned or added to Essentials'); renderTabs(); return; }
  const from = B.tabs.indexOf(tab);
  B.tabs.splice(from, 1);
  if (from < toIndex) toIndex -= 1;
  applyZone(tab, zone);
  B.tabs.splice(Math.max(0, Math.min(toIndex, B.tabs.length)), 0, tab);
  sortZones();
  renderTabs();
  saveSession();
}

const setZone = (tab, zone) => { if (tab && tab.zone !== zone) moveTab(tab.id, B.tabs.length, zone); };
const togglePin = (tab) => setZone(tab, tab?.zone === 'pinned' ? 'normal' : 'pinned');
const toggleEssential = (tab) => setZone(tab, tab?.zone === 'essential' ? 'normal' : 'essential');

function resetToPinnedPage(tab) {
  if (!tab?.homeUrl || tab.url === tab.homeUrl) return;
  navigate(tab, tab.homeUrl);
}

function setPinnedPage(tab) {
  if (!tab || !isKept(tab)) return;
  Object.assign(tab, { homeUrl: tab.url, homeTitle: tab.title, homeFavicon: tab.favicon });
  renderTabs();
  saveSession();
  toast(`Pinned link replaced with ${hostname(tab.url) || 'this page'}`);
}

// Changes where a pinned tab or Essential belongs, at any time. A loaded tab goes there now; an unloaded one opens there.
async function editPinnedLink(tab) {
  if (!tab || !isKept(tab)) return;
  const v = await editDialog({
    title: tab.zone === 'essential' ? 'Edit Essential link' : 'Edit pinned link',
    fields: [{ id: 'url', label: 'The tab goes back to this link when you close it', value: tab.homeUrl || tab.url }],
    ok: 'Save',
  });
  const text = v?.url.trim();
  if (!text) return;
  const url = isInternal(text) || looksLikeUrl(text) ? resolveInput(text, B.settings.searchEngine) : null;
  if (!url) { toast('That isn’t a web address'); return; }
  if (url === tab.homeUrl) return;
  Object.assign(tab, { homeUrl: url, homeTitle: hostname(url) || url, homeFavicon: '' });
  if (tab.webview || tab.id === B.activeId) navigate(tab, url);
  else { sendHome(tab); renderTabs(); saveSession(); }
}

function duplicateTab(tab, { activate = true } = {}) {
  if (tab) createTab({ url: tab.url, title: tab.title, favicon: tab.favicon, opener: tab.zone === 'normal' ? tab : undefined, private: tab.private, activate });
}

function toggleMute(tab) {
  if (!tab) return;
  tab.muted = !tab.muted;
  if (ready(tab)) tab.webview.setAudioMuted(Boolean(tab.muted || tab.siteMuted));
  renderTabs();
}

function cycleTab(dir) {
  const tabs = spaceTabs();
  if (!tabs.length) return;
  const i = tabs.findIndex((t) => t.id === B.activeId);
  activateTab(tabs[(i + dir + tabs.length) % tabs.length].id);
}

// Saves this window's own regular tabs (private ones never) and, when it changed, the sidebar every window shares:
// spaces, pinned tabs and Essentials (windows.js). A private window saves nothing.
// Nothing is saved until the window has restored what it had (B.restored, set at startup in app.js): a window whose
// startup failed part-way must not write its empty sidebar over yours.
function saveSessionNow() {
  if (B.private || !B.restored) return;
  const own = B.tabs.filter((t) => t.zone === 'normal' && !t.private);
  const tabs = own.map((t) => ({ url: t.url, title: t.title, name: t.name, favicon: t.favicon, spaceId: t.spaceId, folderId: t.folderId, splitId: t.splitId }));
  const cur = activeTab();
  const active = !cur ? null : isKept(cur) ? { key: cur.key } : own.includes(cur) ? { normal: own.indexOf(cur) } : null;
  window.ultima.saveSession({
    window: { folders: B.folders.filter((f) => f.zone !== 'pinned'), splits: B.splits, activeSpaceId: B.activeSpaceId, tabs, active },
    sidebar: sharedSidebarIfChanged(),
  });
}
const saveSession = debounce(() => { if (!B.closing) saveSessionNow(); }, 300);

// ---------- sidebar rendering ----------
function tabIcon(tab) {
  if (tab.loading) return '<span class="spinner"></span>';
  if (isInternal(tab.url)) {
    const map = { newtab: 'sparkle', settings: 'settings', history: 'history', waypoints: 'bookmark', import: 'import', passwords: 'key', downloads: 'download', shortcuts: 'command', tasks: 'activity' };
    return `<span class="fav" style="color:var(--accent)">${icon(map[internalName(tab.url)] || 'sparkle')}</span>`;
  }
  // (a private page's icon isn't fetched: the sidebar would load it outside private browsing)
  if (tab.private) return `<span class="fav private-fav" title="Private">${icon('incognito')}</span>`;
  return favHtml(tab.favicon, tab.url, tab.title);
}

// What a tab shows where its icon goes in the sidebar: the icon, or while it plays sound, moving sound bars; while
// it's muted, a muted speaker. Either way it's a button that mutes / unmutes the tab.
function tabFace(t) {
  if (t.muted) return `<button class="tab-sound muted" data-act="mute" title="Unmute tab">${icon('mute', 14)}</button>`;
  if (t.audible) {
    return `<button class="tab-sound playing" data-act="mute" title="Mute tab">
      <span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="sound-hover">${icon('mute', 14)}</span></button>`;
  }
  return tabIcon(t);
}

function tabRow(t) {
  const kept = isKept(t);
  // a kept tab's × unloads it, so only offer it while there is something to unload
  const close = !kept || t.webview || t.id === B.activeId
    ? `<button class="tab-close" data-act="close" title="${esc(withKey(kept ? 'Unload tab' : 'Close tab', 'close-tab'))}">${icon(kept ? 'unload' : 'close', 14)}</button>`
    : '';
  const renaming = B.renaming?.id === t.id;
  const home = offSite(t) ? `<button class="tab-home" data-act="home" title="${esc(`Back to the pinned link\n${t.homeUrl}`)}">${icon('home', 14)}</button>` : '';
  return `<div class="tab ${kept ? 'pinned-row' : ''} ${t.id === B.activeId ? 'active' : ''} ${B.selected.has(t.id) ? 'selected' : ''} ${isUnloaded(t) ? 'unloaded' : ''} ${t.private && !B.private ? 'private' : ''}" data-tab="${t.id}" draggable="false" ${renaming ? '' : `title="${esc(tabTip(t))}"`}>
      ${tabFace(t)}
      ${renaming ? `<input class="tab-rename" maxlength="80" spellcheck="false" aria-label="Tab name" placeholder="${esc(t.title)}">` : `<span class="title">${esc(tabLabel(t))}</span>`}
      ${home}${close}
    </div>`;
}

// a renamed tab's tooltip still says what the page is
const tabTip = (t) => `${tabLabel(t)}${t.name ? `\n${t.title}` : ''}\n${t.url}${isUnloaded(t) ? '\n(unloaded — click to load)' : ''}${t.private && !B.private ? '\nPrivate tab' : ''}`;

// Essentials fill the sidebar's width in balanced rows, as in Zen: up to 4 share one row (a lone one is full width),
// then 5–6 go 3 a row, 7–8 go 4, 9 is 3×3 and more go 4 a row. A narrow sidebar fits fewer a row (styles.css).
// Counts what is showing, so a tab being dragged in or out re-flows the grid as it goes.
function layoutEssentials() {
  const box = $('#essentials');
  const n = $$(':scope > :not(.drag-source)', box).length;
  box.style.setProperty('--ess-cols', n <= 4 ? Math.max(n, 1) : n <= 6 || n === 9 ? 3 : 4);
}

function renderTabs() {
  if (TD.drag) { TD.dirty = true; return; } // not mid-drag (it would pull the gap away); redrawn when the card lands
  if (B.closing) return;
  settleEssentials();
  tidyAutoGroups();
  normalizeSplits();
  normalizeTabFolders();
  const visible = spaceTabs();
  $('#essentials').innerHTML = visible.filter((t) => t.zone === 'essential').map((t) => `
    <div class="pin ${t.id === B.activeId ? 'active' : ''} ${B.selected.has(t.id) ? 'selected' : ''} ${isUnloaded(t) ? 'unloaded' : ''}" data-tab="${t.id}" draggable="false"
      title="${esc(tabTip(t))}" ${pinRingStyle(t)}>${tabFace(t)}</div>`).join('');
  layoutEssentials();
  $('#pinned-list').innerHTML = tabListHtml(visible.filter((t) => t.zone === 'pinned'));
  $('#tabs').innerHTML = tabListHtml(visible.filter((t) => t.zone === 'normal'));
  sizeStripFolders();
  document.title = `${tabLabel(activeTab()) || 'Ultima'} — Ultima Browser`;
  restoreTabRename();
  pruneTabSelection();
  syncPanes();
}

// ---------- renaming tabs ----------
// Rows rename in place; the sidebar redraws often (pages load, titles change), so the name being typed and the
// caret are kept in B.renaming and put back after each redraw. Essentials (icons only) and the compact sidebar,
// which show no names, use a dialog.
function startRenameTab(tab) {
  if (!tab) return;
  // no room to type where the name is: Essentials and split views show only icons, as does the compact sidebar
  if (tab.zone === 'essential' || tab.splitId || document.body.classList.contains('collapsed') || tab.spaceId !== B.activeSpaceId) {
    renameTabDialog(tab);
    return;
  }
  const draft = tabLabel(tab);
  B.renaming = { id: tab.id, draft, start: 0, end: draft.length };
  renderTabs();
  $(`.tab[data-tab="${tab.id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function restoreTabRename() {
  const r = B.renaming;
  if (!r) return;
  const input = $(`.tab[data-tab="${r.id}"] .tab-rename`);
  if (!input) { B.renaming = null; return; } // the tab went away
  input.value = r.draft;
  input.focus();
  input.setSelectionRange(r.start, r.end);
}

// An empty name gives the tab back its page's title.
function finishRenameTab(save) {
  const r = B.renaming;
  if (!r) return;
  B.renaming = null;
  const tab = tabById(r.id);
  if (tab && save) tab.name = r.draft.trim() && r.draft.trim() !== tab.title ? r.draft.trim() : undefined;
  renderTabs();
  if (tab?.id === B.activeId) updateChrome();
  saveSession();
}

async function renameTabDialog(tab) {
  const v = await editDialog({ title: 'Rename tab', fields: [{ id: 'name', label: `Name (leave empty for “${tab.title}”)`, value: tabLabel(tab) }], ok: 'Rename' });
  if (!v) return;
  tab.name = v.name.trim() && v.name.trim() !== tab.title ? v.name.trim() : undefined;
  renderTabs();
  saveSession();
}

function resetTabName(tab) {
  if (!tab?.name) return;
  tab.name = undefined;
  renderTabs();
  saveSession();
}

function initTabRename() {
  const side = $('#sidebar');
  side.addEventListener('input', (e) => {
    if (!e.target.classList.contains('tab-rename') || !B.renaming) return;
    Object.assign(B.renaming, { draft: e.target.value, start: e.target.selectionStart, end: e.target.selectionEnd });
  });
  // the caret moves without typing too (arrows, clicks)
  for (const type of ['keyup', 'mouseup', 'select']) {
    side.addEventListener(type, (e) => {
      if (e.target.classList?.contains('tab-rename') && B.renaming) Object.assign(B.renaming, { start: e.target.selectionStart, end: e.target.selectionEnd });
    });
  }
  side.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('tab-rename')) return;
    if (matchesKey(e, 'field.submit')) { e.preventDefault(); finishRenameTab(true); }
    else if (matchesKey(e, 'field.cancel')) { e.preventDefault(); finishRenameTab(false); }
    e.stopPropagation(); // typing a name never triggers the sidebar's own keys
  });
  // clicking elsewhere keeps the name (a redraw re-focuses the box straight away, so only a real move away counts)
  side.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('tab-rename')) return;
    setTimeout(() => { if (B.renaming && !document.activeElement?.classList.contains('tab-rename')) finishRenameTab(true); });
  });
  // Double-click renames. Not a 'dblclick' listener: the first click redraws the sidebar (it opens the tab), and
  // Chromium only sends dblclick when both clicks hit the same element, so the second click (detail 2) is used.
  side.addEventListener('click', (e) => {
    if (e.detail !== 2 || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return; // (those choose tabs: tabselect.js)
    const el = e.target.closest('.tab[data-tab], .pin[data-tab]');
    if (el && !e.target.closest('[data-act], .tab-rename')) startRenameTab(tabById(Number(el.dataset.tab)));
  });
}

async function tabContextMenu(tab) {
  const kept = isKept(tab);
  const drifted = awayFromHome(tab);
  // a tab torn off another window can go back there, while that's open (tabdrag.js)
  const back = Boolean(tab.cameFrom) && await window.ultima.windowIsOpen(tab.cameFrom.windowId).catch(() => false);
  const choice = await showMenu([
    { id: 'reload', icon: 'reload', label: isUnloaded(tab) ? 'Load' : 'Reload', shortcut: 'reload' },
    { id: 'unload', icon: 'unload', label: 'Unload tab', enabled: Boolean(tab.webview), shortcut: 'unload-tab' },
    { id: 'duplicate', icon: 'duplicate', label: 'Duplicate', shortcut: 'duplicate-tab' },
    { id: 'rename', icon: 'edit', label: 'Rename tab…', shortcut: 'rename-tab' },
    ...(tab.name ? [{ id: 'rename-reset', label: `Use the page’s title (“${tab.title.length > 30 ? `${tab.title.slice(0, 30)}…` : tab.title}”)` }] : []),
    { type: 'separator' },
    { id: 'essential', icon: 'star', label: tab.zone === 'essential' ? 'Remove from Essentials' : 'Add to Essentials', shortcut: 'essential-tab' },
    { id: 'pin', icon: 'pin', label: tab.zone === 'pinned' ? 'Unpin tab' : 'Pin tab', shortcut: 'pin-tab' },
    ...tabFolderMenuItems(tab),
    ...tabSplitMenuItems(tab),
    ...(kept ? [{
      label: tab.zone === 'essential' ? 'Essential link' : 'Pinned link',
      icon: 'link',
      submenu: [
        { id: 'edit-home', icon: 'edit', label: 'Edit link…', shortcut: 'edit-pinned-link' },
        // only once it has gone somewhere else: on its pinned link already, there's nothing to replace it with
        { id: 'set-home', icon: 'pin', label: 'Replace with current link', enabled: drifted, shortcut: 'replace-pinned-link' },
      ],
    }] : []),
    ...(drifted ? [{ id: 'reset', icon: 'home', label: 'Back to pinned link', shortcut: 'reset-tab' }] : []),
    { type: 'separator' },
    { id: 'mute', icon: tab.muted ? 'volume' : 'mute', label: tab.muted ? 'Unmute tab' : 'Mute tab', shortcut: 'mute-tab' },
    { id: 'copy', icon: 'link', label: 'Copy link', shortcut: 'copy-url' },
    ...(tab.zone === 'essential' ? [] : [{
      label: 'Move to space',
      icon: 'layers',
      submenu: [
        ...B.spaces.map((s) => ({ id: `space:${s.id}`, label: `${s.icon}  ${s.name}`, enabled: s.id !== tab.spaceId })),
        { type: 'separator' },
        { id: 'space-new', label: 'New space' },
      ],
    }]),
    ...(back ? [{ id: 'back', icon: 'window', label: 'Move back to its old window' }] : []),
    { type: 'separator' },
    kept
      ? { id: 'remove', icon: 'trash', danger: true, label: tab.zone === 'essential' ? 'Remove from sidebar' : 'Unpin and close' }
      : { id: 'close', icon: 'close', label: 'Close tab', shortcut: 'close-tab' },
    { id: 'close-others', label: 'Close other tabs', shortcut: 'close-others' },
    ...(kept ? [] : [{ id: 'close-below', label: 'Close tabs below' }]),
  ]);
  const regular = spaceTabs().filter((t) => t.zone === 'normal');
  if (runTabFolderChoice(tab, choice) || runTabSplitChoice(tab, choice)) return undefined;
  if (choice?.startsWith('space:')) return moveTabToSpace(tab, choice.slice(6));
  if (choice === 'space-new') {
    const s = createSpace(false);
    if (!s?.id) return undefined; // (a private window has no spaces: it said so)
    moveTabToSpace(tab, s.id);
    switchSpace(s.id, tab);
    return startRenameSpace();
  }
  switch (choice) {
    case 'reload': if (ready(tab)) tab.webview.reload(); else activateTab(tab.id); break;
    case 'unload': unloadTab(tab); break;
    case 'duplicate': duplicateTab(tab); break;
    case 'rename': startRenameTab(tab); break;
    case 'rename-reset': resetTabName(tab); break;
    case 'essential': toggleEssential(tab); break;
    case 'pin': togglePin(tab); break;
    case 'reset': resetToPinnedPage(tab); break;
    case 'set-home': setPinnedPage(tab); break;
    case 'edit-home': editPinnedLink(tab); break;
    case 'mute': toggleMute(tab); break;
    case 'copy': copyText(tab.url, 'Link copied'); break;
    case 'back': sendTabBack(tab); break;
    case 'close': closeTab(tab.id); break;
    case 'remove': closeTab(tab.id, { remove: true }); break;
    case 'close-others': regular.filter((t) => t !== tab).forEach((t) => closeTab(t.id)); break;
    case 'close-below': regular.slice(regular.indexOf(tab) + 1).forEach((t) => closeTab(t.id)); break;
    default: break;
  }
  return undefined;
}

function endTabDrag() {
  B.dragId = null;
  document.body.classList.remove('tab-dragging');
  $$('.drop-before, .drop-after, .drop-target, .drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-target', 'drop-into'));
  $$('.dragging').forEach((x) => x.classList.remove('dragging'));
}

function initTabStrip() {
  const zoneOf = { essentials: 'essential', 'pinned-list': 'pinned', tabs: 'normal' };
  const clearDropMarks = () => $$('.drop-before, .drop-after, .drop-target, .drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-target', 'drop-into'));
  for (const container of [$('#essentials'), $('#pinned-list'), $('#tabs')]) {
    const zone = zoneOf[container.id];
    container.addEventListener('mousedown', (e) => {
      const el = e.target.closest('[data-tab]');
      if (!el || e.button !== 1) return;
      e.preventDefault();
      // a pinned tab that's already closed: out of the sidebar
      const tab = tabById(Number(el.dataset.tab));
      closeTab(tab.id, { remove: tab.zone === 'pinned' && isUnloaded(tab) });
    });
    container.addEventListener('click', (e) => {
      const el = e.target.closest('[data-tab]');
      if (!el) return;
      const tab = tabById(Number(el.dataset.tab));
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') closeTab(tab.id);
      else if (act === 'mute') toggleMute(tab);
      else if (act === 'home') { activateTab(tab.id); resetToPinnedPage(tab); }
      else if (!selectTabsByClick(tab, e)) activateTab(tab.id); // Ctrl or Shift: chooses tabs instead (tabselect.js)
    });
    container.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tab-rename')) return; // the text box gets the usual cut/copy/paste menu
      const el = e.target.closest('[data-tab]');
      if (el) { e.preventDefault(); openTabMenu(tabById(Number(el.dataset.tab))); } // (or the menu for the tabs you chose: tabselect.js)
    });
    container.addEventListener('dragstart', (e) => {
      const el = e.target.closest('[data-tab]');
      if (!el) return;
      B.dragId = Number(el.dataset.tab);
      el.classList.add('dragging');
      document.body.classList.add('tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/uri-list', tabById(B.dragId).url);
    });
    container.addEventListener('dragend', endTabDrag);
    container.addEventListener('dragover', (e) => {
      if (B.dragId === null) return;
      e.preventDefault();
      clearDropMarks();
      const head = zone !== 'essential' && e.target.closest('[data-folder-head]'); // onto a folder: into it
      if (head) { head.classList.add('drop-into'); return; }
      const el = e.target.closest('[data-tab]');
      if (zone === 'essential' || !el) { (el || container).classList.add('drop-target'); return; }
      const r = el.getBoundingClientRect();
      el.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    container.addEventListener('drop', (e) => {
      if (B.dragId === null) return;
      e.preventDefault();
      const dragId = B.dragId;
      // the drop redraws the sidebar, taking the dragged row (and its dragend) with it, so finish the drag here
      endTabDrag();
      B.dragId = dragId;
      const head = zone !== 'essential' && e.target.closest('[data-folder-head]');
      if (head) { addTabToFolder(tabById(B.dragId), head.dataset.folderHead); B.dragId = null; return; }
      const el = e.target.closest('[data-tab]');
      const target = el && tabById(Number(el.dataset.tab));
      let index = B.tabs.length; // end of the zone (sortZones keeps zones grouped)
      if (target) index = B.tabs.indexOf(target) + (zone !== 'essential' && el.classList.contains('drop-after') ? 1 : 0);
      const dragged = tabById(B.dragId);
      // among a folder's tabs it joins that folder; anywhere else it is on its own
      if (dragged && zone !== 'essential') dragged.folderId = target?.folderId;
      moveTab(B.dragId, index, zone);
      B.dragId = null;
    });
  }
}

// ---------- sidebar width ----------
function initResizer() {
  const r = $('#sb-resizer');
  r.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.style.cursor = 'ew-resize';
    document.body.classList.add('sb-resizing'); // follows the pointer exactly, without the width animation
    $$('webview').forEach((w) => { w.style.pointerEvents = 'none'; });
    const move = (ev) => {
      const w = Math.min(480, Math.max(200, ev.clientX));
      document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
      B.settings.sidebarWidth = w;
    };
    const up = () => {
      document.body.style.cursor = '';
      document.body.classList.remove('sb-resizing');
      $$('webview').forEach((w) => { w.style.pointerEvents = ''; });
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.ultima.setSettings({ sidebarWidth: B.settings.sidebarWidth });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
