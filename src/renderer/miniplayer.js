// The mini player: what a tab you're not looking at is playing (a song, a video, a podcast) and its controls, so you
// can pause it, skip a track or seek without going back to it. It's a window of its own, above every other window,
// that you can drag onto any screen (player.js draws it; main.js keeps it). A video plays in it, with the same
// controls, and a page's own picture-in-picture button opens it too, even on the tab you're on.
// Pages say what they play (media-preload.js, through main.js): any player, in the page or in a frame of it. A tab
// playing sound that says nothing (a player Ultima can't see into) still shows, with its title and a mute button.
// A tab shows once it has played, until it closes or you close its player (it comes back when it plays again).
// This window only says which of its tabs it would show; with several windows, main.js picks one.
// Dragged into the sidebar, the player docks there, under the tabs (this window draws it then: player.js); dragged
// out, it floats again. It can't dock in a hidden or compact sidebar, or in tabs across the top.
// Settings → General → Mini player turns it off.
const MP = {
  media: new Map(), // webContents id → what its page plays (with `got`: when it arrived)
  played: new Set(), // tabs that have played
  closed: new Set(), // tabs whose player you closed
  wasPlaying: new Map(), // tab id → playing at the last look
  since: new Map(), // tab id → when it last started or stopped
  sig: '',
  zone: '',
  docked: null, // the player, docked in this sidebar
};

const wcIdOf = (t) => { try { return ready(t) ? t.webview.getWebContentsId() : null; } catch { return null; } };
const mediaOfTab = (t) => MP.media.get(wcIdOf(t)) || null;
// does rank a come before rank b (first difference decides)
const ahead = (a, b) => { const i = a.findIndex((v, n) => v !== b[n]); return i >= 0 && a[i] > b[i]; };

// The tab to show: a page's picture in picture first, then not one you're looking at; one playing before one
// paused, the latest first.
function miniPlayerTab() {
  const cur = activeTab();
  const shown = cur?.splitId ? splitTabs(cur.splitId) : cur ? [cur] : [];
  const now = Date.now();
  let best = null;
  for (const t of B.tabs) {
    const m = mediaOfTab(t);
    const playing = m ? m.playing : Boolean(t.audible);
    if (playing !== Boolean(MP.wasPlaying.get(t.id))) {
      MP.since.set(t.id, now);
      if (playing) { MP.played.add(t.id); MP.closed.delete(t.id); } // playing again brings a closed player back
    }
    MP.wasPlaying.set(t.id, playing);
    const popped = Boolean(m?.popout);
    if (popped) MP.played.add(t.id);
    if ((shown.includes(t) && !popped) || !MP.played.has(t.id) || (MP.closed.has(t.id) && !popped) || (!m && !t.audible)) continue;
    const rank = [popped ? 1 : 0, playing ? 1 : 0, MP.since.get(t.id) || 0];
    if (!best || ahead(rank, best.rank)) best = { t, rank };
  }
  return best?.t || null;
}

function renderMiniPlayer() {
  if (!window.ultima?.playerWant) return;
  // forget what's gone: closed tabs and dropped pages
  const ids = new Set(B.tabs.map((t) => t.id));
  for (const map of [MP.wasPlaying, MP.since]) for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  for (const set of [MP.played, MP.closed]) for (const id of set) if (!ids.has(id)) set.delete(id);
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
  MP.docked = createPlayer($('#mp-dock'), { docked: true, sidebar: $('#sidebar') });
  window.ultima.on('player-state', MP.docked.state);
  window.ultima.on('player-signal', MP.docked.signal);
  // a player dragged over the sidebar: it would dock here
  window.ultima.on('player-dock-hover', (on) => { $('#mp-dock-hint').hidden = !on; });
  new ResizeObserver(reportDockZone).observe($('#sidebar'));
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
    else if (act === 'close') MP.closed.add(tab.id);
    else if (act === 'mute') toggleMute(tab);
    renderMiniPlayer();
  });
}
