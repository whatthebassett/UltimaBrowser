// Several windows. Normal windows share the sidebar (spaces, pinned tabs and Essentials) and each has its own regular
// tabs: a change to the sidebar in one window goes to the others (main.js passes it on), and settings changed in one
// apply in all. Private windows and private tabs browse in memory only and leave nothing behind: no history, nothing
// saved for next time, no extensions; their cookies and data are deleted when the last private page closes.
const PRIVATE_PARTITION = 'ultima-private';
const newTabKey = () => Math.random().toString(36).slice(2, 12);

// Private windows are black with a neutral gray accent (white text on it stays readable), whatever your own accent.
const PRIVATE_ACCENT = '#71717a';
const PRIVATE_LOADER = ['#3f3f46', '#d4d4d8', '#71717a']; // the address bar's loading animation, in grays

// A private window's one space: black, and never saved.
function privateSpace() {
  return { id: 'private', name: 'Private', icon: '🕶️', color: '#000000', separate: false, theme: { colors: [hexToHsl('#000000'), hexToHsl('#000000')], intensity: 95, grain: 0, mode: 'dark' } }; // black top to bottom
}

// ---------- the shared sidebar ----------
// What every window's sidebar has in common: spaces, pinned folders, pinned tabs and Essentials. A pinned tab or
// Essential is described by where it belongs (its pinned link), not where it has wandered to in one window, so
// browsing in one window doesn't move it in the others.
function sharedSidebar() {
  return {
    spaces: B.spaces,
    folders: B.folders.filter((f) => f.zone === 'pinned'),
    kept: B.tabs.filter(isKept).map((t) => ({
      key: t.key, zone: t.zone, name: t.name, spaceId: t.zone === 'pinned' ? t.spaceId : undefined, folderId: t.zone === 'pinned' ? t.folderId : undefined,
      essentialsOf: t.zone === 'essential' ? t.essentialsOf : undefined,
      homeUrl: t.homeUrl, homeTitle: t.homeTitle, homeFavicon: t.homeFavicon,
    })),
  };
}

let lastSidebar = null; // as this window last sent or received it, so it only sends changes it made itself
function sharedSidebarIfChanged() {
  const s = sharedSidebar();
  const json = JSON.stringify(s);
  if (json === lastSidebar) return undefined;
  lastSidebar = json;
  return s;
}
const markSidebarSaved = () => { lastSidebar = JSON.stringify(sharedSidebar()); };

// Another window changed the sidebar: take its spaces, pinned tabs and Essentials, keeping this window's pages open.
function applySharedSidebar(s) {
  if (B.private || !s?.spaces?.length) return;
  // spaces are updated in place, so whatever holds one (the theme editor) keeps working on it
  const before = new Map(B.spaces.map((sp) => [sp.id, sp]));
  B.spaces = s.spaces.map((incoming) => {
    const sp = before.get(incoming.id);
    if (!sp) return { ...incoming };
    before.delete(incoming.id);
    for (const k of Object.keys(sp)) if (!(k in incoming)) delete sp[k];
    return Object.assign(sp, incoming);
  });
  // a space deleted elsewhere: this window's tabs there move to the first space instead of closing unasked
  for (const t of B.tabs) {
    if (t.zone === 'normal' && before.has(t.spaceId)) Object.assign(t, { spaceId: B.spaces[0].id, folderId: undefined, splitId: undefined });
  }
  if (!spaceById(B.activeSpaceId)) B.activeSpaceId = B.spaces[0].id;

  // pinned folders, like spaces, are updated in place; this window's folders of regular tabs stay as they are
  const pinnedFolders = new Map(B.folders.filter((f) => f.zone === 'pinned').map((f) => [f.id, f]));
  B.folders = [...B.folders.filter((f) => f.zone !== 'pinned'),
    ...(s.folders || []).map((f) => Object.assign(pinnedFolders.get(f.id) || {}, cleanFolder({ ...f, zone: 'pinned' })))];
  const mine = new Map(B.tabs.filter(isKept).map((t) => [t.key, t]));
  const kept = withFoldersHeld(() => (s.kept || []).map((k) => {
    const spaceId = k.zone === 'pinned' ? (spaceById(k.spaceId) ? k.spaceId : B.spaces[0].id) : undefined;
    const home = { homeUrl: k.homeUrl, homeTitle: k.homeTitle, homeFavicon: k.homeFavicon };
    const folderId = k.zone === 'pinned' ? k.folderId : undefined;
    const essentialsOf = k.zone === 'essential' ? essentialsSpace(k.essentialsOf) : undefined; // one of a space's own
    let t = mine.get(k.key);
    if (!t) return createTab({ ...home, url: k.homeUrl, title: k.homeTitle, favicon: k.homeFavicon, name: k.name, zone: k.zone, spaceId, folderId, essentialsOf, key: k.key, lazy: true, activate: false });
    mine.delete(k.key);
    Object.assign(t, { ...home, zone: k.zone, name: k.name, folderId, essentialsOf });
    if (spaceId || essentialsOf) t.spaceId = spaceId || essentialsOf;
    // one that isn't open here shows its (maybe new) pinned link; an open one stays on its page
    if (!t.webview && t.id !== B.activeId) Object.assign(t, { url: t.homeUrl, title: t.homeTitle || hostname(t.homeUrl) || t.homeUrl, favicon: t.homeFavicon || '' });
    return t;
  }));
  // unpinned or removed elsewhere: gone here too, unless it's open here, where it stays as a regular tab
  for (const t of mine.values()) {
    if (t.webview || t.id === B.activeId) {
      Object.assign(t, { zone: 'normal', key: undefined, homeUrl: undefined, homeTitle: undefined, homeFavicon: undefined, folderId: undefined });
      if (!spaceById(t.spaceId)) t.spaceId = B.activeSpaceId;
    } else {
      B.tabs = B.tabs.filter((x) => x !== t);
    }
  }
  B.tabs = [...kept.filter((t) => isKept(t) && B.tabs.includes(t)), ...B.tabs.filter((t) => !isKept(t))];
  sortZones();
  // pages whose sign-ins changed (an Essential pinned to a space, a space given its own) reload into the right ones
  for (const t of B.tabs) {
    if (!t.webview || t.webview.getAttribute('partition') === tabPartition(t)) continue;
    dropWebview(t);
    if (t.id === B.activeId) { ensureWebview(t); showContent(t); }
  }
  applySpaceTheme();
  renderSpaces();
  renderTabs();
  updateChrome();
  markSidebarSaved();
  saveSession(); // this window's own tabs may have moved; the sidebar matches now, so it isn't sent back
}

// Settings changed in another window
function applySettingsFromElsewhere(patch) {
  Object.assign(B.settings, patch);
  if (patch.keybindings) { loadKeys(B.settings.keybindings); refreshKeyHints(); }
  if (patch.sidebarButtons) renderSidebarButtons();
  applyTheme();
  renderTabs();
  updateChrome();
  rerenderIfShowing('settings');
}

function openNewWindow(priv = false) { window.ultima.newWindow({ private: priv }); }

// A private tab in this window (in a private window, every new tab already is one)
function newPrivateTab(url = NEWTAB) {
  if (B.private) return openPalette('new');
  return createTab({ url, private: true });
}

function initWindows(state) {
  B.private = Boolean(state.private);
  B.windowId = state.windowId;
  document.body.classList.toggle('private-window', B.private);
  window.ultima.on('sidebar-changed', applySharedSidebar);
  window.ultima.on('settings-changed', applySettingsFromElsewhere);
}
