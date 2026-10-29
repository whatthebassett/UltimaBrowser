// Tearing a tab off into a window of its own (tabdrag.js drives it). While the tab is dragged out of its window (or
// onto the middle of its page), a picture of the window it will become follows the pointer. A window can't draw
// outside itself, so the picture is drawn on a clear, click-through window over the whole screen ("the ghost").
// Letting go opens the new window there: the picture grows to its size and fades into it. The page comes along with
// its Back/Forward history, scroll position and form contents (navigationHistory.restore), not just its address.
// Over another Ultima window's tabs, the picture gives way to that window showing where the tab would land (main
// tells it where the pointer is: the window the drag started in keeps the pointer), and letting go moves it in there.
const { BrowserWindow, screen, webContents } = require('electron');
const path = require('path');

let ghost = null; // the see-through window, kept (hidden) for the next drag
let ghostReady = null; // resolves once it has loaded
let drag = null; // { from, timer, display, out, shown, last, info, windows, dock: { w, over } }
const restores = new Map(); // token -> { entries, index, url }: a torn-off page's history, until its new window takes it
let privateMoves = 0; // private tabs on their way to a new window: private browsing isn't over while one is
const RESTORE_SRC = 'about:blank?ultima-restore=';

function ghostWindow() {
  if (ghost && !ghost.isDestroyed()) return ghost;
  ghost = new BrowserWindow({
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, roundedCorners: false, thickFrame: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, '..', 'tearoff-preload.js'), contextIsolation: true, sandbox: true },
  });
  ghost.setAlwaysOnTop(true, 'pop-up-menu');
  ghost.setIgnoreMouseEvents(true);
  ghost.webContents.on('will-navigate', (e) => e.preventDefault());
  ghost.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ghostReady = new Promise((resolve) => ghost.webContents.once('did-finish-load', resolve));
  ghost.loadFile(path.join(__dirname, '..', 'renderer', 'tearoff.html'));
  ghost.on('closed', () => { ghost = null; });
  return ghost;
}
const toGhost = (msg) => { if (ghost && !ghost.isDestroyed()) ghost.webContents.send('ghost', msg); };

// the ghost covers the screen the pointer is on (moving to another screen with it)
function followPointer() {
  if (!drag || !ghost || ghost.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  if (d.id !== drag.display?.id) {
    drag.display = d;
    ghost.setBounds(d.bounds);
  }
  const x = p.x - d.bounds.x;
  const y = p.y - d.bounds.y;
  if (drag.last && drag.last.x === x && drag.last.y === y) return;
  drag.last = { x, y };
  toGhost({ type: 'pos', x, y });
  aimDock(p);
}

const toWindow = (w, msg) => { if (w && !w.win.isDestroyed()) w.win.webContents.send('dock', msg); };
const inside = (b, p) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;

// Outside the window it came from and over another one (the one used last, where they overlap): that window hears
// where the pointer is, and says whether it's over its tabs (over()). A private window takes only private tabs.
function aimDock(p) {
  const to = inside(drag.from.win.getBounds(), p) ? null : drag.windows()
    .filter((w) => w !== drag.from && w.win.isVisible() && !w.win.isMinimized() && (!w.private || drag.info.private) && inside(w.win.getBounds(), p))
    .sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0))[0] || null;
  if (to !== (drag.dock?.w || null)) {
    if (drag.dock) toWindow(drag.dock.w, { type: 'leave' });
    drag.dock = to && { w: to, over: false };
    if (to) toWindow(to, { type: 'enter', tab: drag.info });
    showGhost();
  }
  if (!to) return;
  const c = to.win.getContentBounds();
  const z = to.win.webContents.getZoomFactor() || 1;
  toWindow(to, { type: 'move', x: (p.x - c.x) / z, y: (p.y - c.y) / z });
}

// The window under the pointer is (or isn't) showing the tab among its own: the picture tucks away meanwhile.
function over(w, on) {
  if (!drag?.dock || drag.dock.w !== w) return;
  drag.dock.over = Boolean(on);
  showGhost();
}

// A drag that may tear off has started: the ghost gets ready, with a picture of the page if it's showing (`rect`,
// where it is in the window). `windows()` lists the Ultima windows it could be dragged into.
async function begin(from, { rect, title, favicon, url, private: priv, key, look, grip, ratio, inset }, { windows }) {
  end();
  const win = ghostWindow();
  const info = { title: String(title || ''), favicon: String(favicon || ''), url: String(url || ''), private: Boolean(priv), key: key ? String(key) : undefined,
    grip: { x: Number(grip?.x) || 0, y: Number(grip?.y) || 0 } };
  drag = { from, out: false, shown: false, display: null, last: null, info, windows, dock: null };
  const mine = drag;
  drag.timer = setInterval(followPointer, 8);
  followPointer();
  // the picture comes when it's ready, and isn't waited for
  const picture = Promise.race([capture(from, rect).catch(() => ''), new Promise((resolve) => setTimeout(() => resolve(''), 1000))]);
  await ghostReady;
  if (drag !== mine || win.isDestroyed()) return;
  toGhost({ type: 'setup', title: String(title || ''), favicon: String(favicon || ''), look, grip, inset, ratio: Number(ratio) || 0.62 });
  const pic = await picture;
  if (pic && drag === mine) toGhost({ type: 'picture', picture: pic });
}

// The page as it looks, from the window showing it (a page or one of Ultima's own). A tab that isn't showing has no
// picture (its page draws nothing while hidden, so asking it never answers): the ghost shows its icon instead.
async function capture(from, rect) {
  if (!rect || !(rect.width > 20 && rect.height > 20)) return '';
  const img = await from.win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
  if (!img || img.isEmpty()) return '';
  const small = img.getSize().width > 900 ? img.resize({ width: 900, quality: 'good' }) : img;
  return `data:image/jpeg;base64,${small.toJPEG(84).toString('base64')}`;
}

// The pointer left the window (or came back): the picture pops up at the pointer, or tucks away.
function out(on) {
  if (!drag) return;
  drag.out = Boolean(on);
  showGhost();
}

// The picture shows while the tab is out of its window, except over another window's tabs (which show it there).
function showGhost() {
  const on = drag.out && !drag.dock?.over;
  if (on === drag.shown) return;
  drag.shown = on;
  const win = ghostWindow();
  if (on && !win.isVisible()) {
    followPointer();
    win.showInactive(); // the window you're dragging from keeps the pointer and the keyboard (Esc)
    win.setAlwaysOnTop(true, 'pop-up-menu');
  }
  toGhost({ type: 'out', on });
}

// The drag ended without a new window.
function cancel() {
  if (!drag) return;
  toGhost({ type: 'cancel' });
  end();
}

function end() {
  if (drag?.timer) clearInterval(drag.timer);
  if (drag?.dock) toWindow(drag.dock.w, { type: 'leave' });
  drag = null;
}

// What a moved tab takes along, and its page's history (a page that has one: an unloaded tab or one of Ultima's own
// pages has none), kept under a token until the window it moves to asks for it.
function tabInfo(from, tab) {
  let restore;
  const wc = tab.webContentsId && webContents.fromId(Number(tab.webContentsId));
  if (wc && !wc.isDestroyed() && wc.hostWebContents === from.win.webContents) {
    const entries = wc.navigationHistory.getAllEntries().filter((e) => e.url);
    const index = wc.navigationHistory.getActiveIndex();
    if (entries.length && index >= 0 && index < entries.length) {
      restore = Math.random().toString(36).slice(2, 12);
      restores.set(restore, { entries, index, url: entries[index].url });
      setTimeout(() => restores.delete(restore), 60000); // never claimed (the window didn't open)
    }
  }
  return {
    url: String(tab.url || ''), title: String(tab.title || ''), favicon: String(tab.favicon || ''), name: tab.name ? String(tab.name) : undefined,
    spaceId: tab.spaceId ? String(tab.spaceId) : undefined, zoom: Number(tab.zoom) || 0, muted: Boolean(tab.muted), private: Boolean(tab.private), restore,
    key: tab.key ? String(tab.key) : undefined, // a pinned tab or Essential: the other window's copy of it takes the page
  };
}

// The tab's page closes where it was before its new place's page starts: if it was the last private page, that would
// end private browsing (and sign you out) in between, so it waits. Returns what to call once the new page has started.
function holdPrivate(tab, privateDone) {
  let moving = Boolean(tab.private);
  if (moving) privateMoves += 1;
  const moved = () => { if (!moving) return; moving = false; privateMoves -= 1; privateDone?.(); };
  setTimeout(moved, 15000);
  return moved;
}

// Moves a tab into another open window (`to`), which comes to the front with it: dropped on its tabs (`dropped`,
// where it showed it), or sent back to where it was (`home`, from its menu).
function moveTo(from, tab, to, { privateDone, dropped = false, home = null } = {}) {
  if (!to || to === from || to.win.isDestroyed() || (to.private && !tab.private)) return false;
  const moved = holdPrivate(tab, privateDone);
  const h = home && typeof home === 'object' ? {
    before: Number(home.before) || undefined, folderId: home.folderId ? String(home.folderId) : undefined, spaceId: home.spaceId ? String(home.spaceId) : undefined,
  } : null;
  toWindow(to, { type: dropped ? 'drop' : 'arrive', tab: tabInfo(from, tab), home: h });
  if (to.win.isMinimized()) to.win.restore();
  to.win.focus();
  // (and again if the window it left closes now, which hands the focus to whatever was behind it)
  const refocus = () => { if (!to.win.isDestroyed()) to.win.focus(); };
  from.win.once('closed', refocus);
  setTimeout(() => { if (!from.win.isDestroyed()) from.win.removeListener('closed', refocus); }, 2000);
  setTimeout(moved, 3000);
  return true;
}

// Let go: the new window opens where the tab was dropped, the size of the one it came from (on that screen). `hold`
// is where the dragged tab sits in its window, so in the new one the tab lands under the pointer. Over another
// window's tabs, it moves in there instead.
// openWindow({ at, private, tearOff, reveal }) opens it; `reveal` shows it once the picture has grown to its size.
function drop(from, tab, { openWindow, normalSize, privateDone }) {
  if (!drag) return false;
  followPointer();
  clearInterval(drag.timer);
  if (drag.dock?.over) {
    const to = drag.dock.w;
    drag.dock = null;
    toGhost({ type: 'cancel' });
    end();
    return moveTo(from, tab, to, { privateDone, dropped: true });
  }
  const p = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(p);
  const area = display.workArea;
  const size = from.win.isMaximized() || from.win.isFullScreen() ? normalSize() : from.win.getBounds();
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const hold = { x: Math.max(0, Number(tab.hold?.x) || 0), y: Math.max(0, Number(tab.hold?.y) || 0) };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const at = {
    x: Math.round(clamp(p.x - hold.x, area.x, area.x + area.width - width)),
    y: Math.round(clamp(p.y - hold.y, area.y, area.y + area.height - height)),
    width, height, maximized: false,
  };
  const info = tabInfo(from, tab);
  const moved = holdPrivate(tab, privateDone);
  const mine = drag;
  drag = null;
  const rect = { x: at.x - display.bounds.x, y: at.y - display.bounds.y, width: at.width, height: at.height };
  if (ghost && !ghost.isDestroyed() && mine.display?.id !== display.id) ghost.setBounds(display.bounds);
  // the picture grows into the window's place; the window shows when it's there and ready, and the picture fades
  const grown = new Promise((resolve) => { toGhost({ type: 'open', rect }); setTimeout(resolve, 260); });
  openWindow({
    at,
    private: info.private,
    // (it remembers where it was, so its menu can send it back)
    tearOff: { ...info, cameFrom: {
      windowId: from.win.id, before: Number(tab.home?.before) || undefined,
      folderId: tab.home?.folderId ? String(tab.home.folderId) : undefined, spaceId: info.spaceId,
    } },
    reveal: (win) => {
      let shown = false;
      const show = () => {
        if (shown || win.isDestroyed()) return;
        shown = true;
        win.show();
        setTimeout(() => toGhost({ type: 'reveal' }), 40);
        setTimeout(moved, 3000);
      };
      grown.then(show);
      setTimeout(show, 3000);
    },
  });
  return true;
}

// The ghost finished its last animation: out of the way until the next drag.
function settled() {
  if (!drag && ghost && !ghost.isDestroyed()) ghost.hide();
}

// A new window's <webview> asks for a torn-off page (RESTORE_SRC + token): its history, once.
function claim(src) {
  if (typeof src !== 'string' || !src.startsWith(RESTORE_SRC)) return null;
  const token = src.slice(RESTORE_SRC.length);
  const r = restores.get(token) || null;
  restores.delete(token);
  return r || { entries: [], index: -1, url: 'about:blank' };
}

function restoreInto(guest, r) {
  try {
    if (!r.entries.length) throw new Error('nothing to restore');
    guest.navigationHistory.restore({ index: r.index, entries: r.entries }).catch(() => {});
  } catch {
    if (r.url && r.url !== 'about:blank') guest.loadURL(r.url).catch(() => {});
  }
}

function destroy() {
  end();
  if (ghost && !ghost.isDestroyed()) ghost.destroy();
  ghost = null;
}

const movingPrivate = () => privateMoves > 0;

module.exports = { begin, out, over, cancel, drop, moveTo, settled, claim, restoreInto, destroy, movingPrivate };
