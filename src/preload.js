const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ultima', {
  getState: invoke('state:get'),
  saveSession: invoke('session:save'),
  setSettings: invoke('settings:set'),
  resetPermissions: invoke('permissions:reset'),
  setKeyRecording: invoke('keys:recording'),
  reportTyping: (on) => ipcRenderer.send('ultima:typing', Boolean(on)),
  setOverlay: invoke('overlay:set'),
  setNativeTheme: invoke('theme:native'),
  faviconData: invoke('favicon:data'),
  tabHistory: invoke('tab:history'),
  tabHistoryGo: invoke('tab:history-go'),
  defaultBrowserStatus: invoke('default-browser:get'),
  makeDefaultBrowser: invoke('default-browser:set'),

  addHistory: invoke('history:add'),
  listHistory: invoke('history:list'),
  deleteHistory: invoke('history:delete'),
  clearHistory: invoke('history:clear'),
  topSites: invoke('topsites'),
  search: invoke('search'),

  listBookmarks: invoke('bookmarks:list'),
  bookmarkTree: invoke('bookmarks:tree'),
  addBookmark: invoke('bookmarks:add'),
  addBookmarkFolder: invoke('bookmarks:add-folder'),
  updateBookmark: invoke('bookmarks:update'),
  moveBookmark: invoke('bookmarks:move'),
  bookmarkBarSources: invoke('bookmarks:bar-sources'),
  importBookmarkBar: invoke('bookmarks:import-bar'),
  isBookmarked: invoke('bookmarks:has'),
  toggleBookmark: invoke('bookmarks:toggle'),
  removeBookmark: invoke('bookmarks:remove'),

  detectBrowsers: invoke('import:detect'),
  runImport: invoke('import:run'),
  importPasswordsCsv: invoke('import:passwords-csv'),
  importBookmarksHtml: invoke('import:bookmarks-html'),

  listPasswords: invoke('passwords:list'),
  passwordsFor: invoke('passwords:for'),
  copyPassword: invoke('passwords:copy'),
  fillPassword: invoke('passwords:fill'),
  deletePassword: invoke('passwords:delete'),

  clearData: invoke('data:clear'),
  openDownload: invoke('download:open'),
  showDownload: invoke('download:show'),
  clearDownloads: invoke('download:clear'),
  choosePageMenu: invoke('page-menu:choose'),
  uiEdit: invoke('ui:edit'),
  answerAsk: invoke('ask:answer'),

  listExtensions: invoke('ext:list'),
  installExtensionFromStore: invoke('ext:install-webstore'),
  installUnpackedExtension: invoke('ext:install-unpacked'),
  setExtensionEnabled: invoke('ext:set-enabled'),
  setExtensionPinned: invoke('ext:set-pinned'),
  removeExtension: invoke('ext:remove'),
  extensionRuntimeId: invoke('ext:runtime-id'),
  popoutShown: (webContentsId) => ipcRenderer.send('ultima:popout-shown', Number(webContentsId)),
  focusGuest: (webContentsId, point) => ipcRenderer.send('ultima:focus-guest', Number(webContentsId), point && { x: Number(point.x), y: Number(point.y) }),
  openExtensionLog: invoke('ext:open-log'),
  setActiveTab: invoke('tabs:active'),

  on(channel, cb) {
    const allowed = ['command', 'open-url', 'download', 'window-fullscreen', 'system-theme', 'page-menu', 'ask', 'extensions-changed', 'ext-close-tabs', 'ext-worker-started', 'ext-open-popout', 'ext-close-popout', 'bookmarks-changed'];
    if (!allowed.includes(channel)) throw new Error(`Unknown channel ${channel}`);
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
