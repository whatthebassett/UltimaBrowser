// The mini player: a video you sent there, with its controls, so you can watch it, pause it or seek while you use
// other tabs. It's a window of its own, above every other window, that you can drag onto any screen (player.js draws
// it; main.js keeps it). It opens only when you ask: Ultima's button over a video, "Open in mini player" in a video's
// menu, or a page's own picture-in-picture button. Closing it, or going back to the page from it, puts it away.
// Pages say what they play (media-preload.js, through main.js): any player, in the page or in a frame of it.
// This window only says which of its tabs it would show; with several windows, main.js picks one.
// Dragged into the sidebar, the player docks there, under the tabs (this window draws it then: player.js); dragged
// out, it floats again. It can't dock in a hidden or compact sidebar, or in tabs across the top.
// Settings → General → Mini player turns it off.
const MP = {
  media: new Map(), // webContents id → what its page plays (with `got`: when it arrived)
  sent: new Map(), // tab id → when its video was sent to the player
  sig: '',
  zone: '',
  docked: null, // the player, docked in this sidebar
};

const wcIdOf = (t) => { try { return ready(t) ? t.webview.getWebContentsId() : null; } catch { return null; } };
const mediaOfTab = (t) => MP.media.get(wcIdOf(t)) || null;
// does rank a come before rank b (first difference decides)
const ahead = (a, b) => { const i = a.findIndex((v, n) => v !== b[n]); return i >= 0 && a[i] > b[i]; };

// The tab to show: only a video you sent to the player (it never opens by itself); one playing before one paused,
// the latest sent first.
function miniPlayerTab() {
  let best = null;
  for (const t of B.tabs) {
    const m = mediaOfTab(t);
    if (!m?.popout) continue;
    if (!MP.sent.has(t.id)) MP.sent.set(t.id, Date.now());
    const rank = [m.playing ? 1 : 0, MP.sent.get(t.id)];
    if (!best || ahead(rank, best.rank)) best = { t, rank };
  }
  for (const id of MP.sent.keys()) if (!mediaOfTab(tabById(id))?.popout) MP.sent.delete(id);
  return best?.t || null;
}

function renderMiniPlayer() {
  if (!window.ultima?.playerWant) return;
  // forget dropped pages
  const live = new Set(B.tabs.map(wcIdOf));
  for (const id of MP.media.keys()) if (!live.has(id)) MP.media.delete(id);

  const tab = B.settings.miniPlayer === false || B.closing ? null : miniPlayerTab();
  const m = tab && mediaOfTab(tab);
  const id = tab && wcIdOf(tab);
  const site = tab ? hostname(tab.url).replace(/^www\./, '') : '';
  const want = tab && id != null ? {
    tabId: tab.id,
    webContentsId: id,
    title: m?.title || tabLabel(tab) || site,
    site,
    url: tab.url,
    favicon: tab.favicon || '',
    muted: Boolean(tab.muted),
    playing: m ? m.playing : Boolean(tab.audible),
    state: m,
  } : null;
  reportDockZone();
  const sig = JSON.stringify(want);
  if (sig === MP.sig) return;
  MP.sig = sig;
  window.ultima.playerWant(want);
}

// where the player can dock: the sidebar, while it's out (main.js checks a dragged player against it)
function reportDockZone() {
  const cls = document.body.classList;
  const can = B.settings.miniPlayer !== false && !cls.contains('collapsed') && !cls.contains('sb-hidden') && !tabsAcross();
  const r = can ? $('#sidebar').getBoundingClientRect() : null;
  const zone = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  const sig = JSON.stringify(zone);
  if (sig === MP.zone) return;
  MP.zone = sig;
  window.ultima.playerZone(zone);
}

function initMiniPlayer() {
  MP.docked = createPlayer($('#mp-dock'), {
    docked: true,
    sidebar: $('#sidebar'),
    // how tall a docked video is at most (its handle sets it), so the tabs keep their room
    dockHeight: () => Number(B.settings.miniPlayerDockHeight) || 240,
    onDockHeight: (h) => { B.settings.miniPlayerDockHeight = h; window.ultima.setSettings({ miniPlayerDockHeight: h }); },
  });
  window.ultima.on('player-state', MP.docked.state);
  window.ultima.on('player-signal', MP.docked.signal);
  // a player dragged over the sidebar: it would dock here
  window.ultima.on('player-dock-hover', (on) => { $('#mp-dock-hint').hidden = !on; });
  new ResizeObserver(() => { reportDockZone(); MP.docked.refit(); }).observe($('#sidebar'));
  window.ultima.on('media-state', ({ webContentsId, state }) => {
    if (state) MP.media.set(webContentsId, { ...state, got: Date.now() });
    else MP.media.delete(webContentsId);
    renderMiniPlayer();
  });
  // the player's buttons that are about the tab, not its page
  window.ultima.on('player-tab', ({ tabId, act }) => {
    const tab = tabById(tabId);
    if (!tab) return;
    if (act === 'open') activateTab(tab.id);
    else if (act === 'mute') toggleMute(tab);
    renderMiniPlayer();
  });
}
