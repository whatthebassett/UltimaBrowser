// The mini player (main.js picks what it shows; miniplayer.js in each Ultima window says what it would): a song as a
// card of smoky glass tinted by its artwork, a video as the video itself, both with the same liquid glass controls.
// It floats in a window of its own (player.html), above every other window, that you drag anywhere, onto any screen;
// a video's corner grip resizes it. Dragged into a sidebar, it docks there (miniplayer.js draws it then, with this
// same code), and dragged out again, it floats.
// The video's picture comes from its page over a connection inside this computer (WebRTC): the page offers it
// (media-preload.js) and this answers. Its sound stays with the page.
const PLAYER_MARGIN = 14; // room around the floating card for its shadow (body.player's padding)
const PLAYER_CARD_WIDTH = 320;

const PL_ICONS = {
  play: '<path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.93l10-6.4a1.1 1.1 0 0 0 0-1.86l-10-6.4A1.1 1.1 0 0 0 8 5.6z"/>',
  pause: '<rect x="6.2" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.6" y="5" width="4.2" height="14" rx="1.3"/>',
  next: '<path d="M4.5 6.3v11.4a1 1 0 0 0 1.55.83l8.6-5.7a1 1 0 0 0 0-1.66l-8.6-5.7A1 1 0 0 0 4.5 6.3z"/><rect x="16.4" y="5" width="2.9" height="14" rx="1.2"/>',
  prev: '<path d="M19.5 6.3v11.4a1 1 0 0 1-1.55.83l-8.6-5.7a1 1 0 0 1 0-1.66l8.6-5.7a1 1 0 0 1 1.55.83z"/><rect x="4.7" y="5" width="2.9" height="14" rx="1.2"/>',
  back: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.6 9.2A7.2 7.2 0 1 1 5 13.4"/><path d="M5.2 4.6v4.8H10"/></g><text x="12.6" y="15.6" text-anchor="middle" font-size="7.2" font-weight="700">10</text>',
  ahead: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="matrix(-1 0 0 1 24 0)"><path d="M5.6 9.2A7.2 7.2 0 1 1 5 13.4"/><path d="M5.2 4.6v4.8H10"/></g><text x="11.4" y="15.6" text-anchor="middle" font-size="7.2" font-weight="700">10</text>',
  open: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></g>',
};
const plIcon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PL_ICONS[name]}</svg>`;

// Where it is now (it counts on from the page's last report while playing).
function playerPosition(m) {
  if (!m) return 0;
  const pos = m.position + (m.playing ? ((Date.now() - (m.got || Date.now())) / 1000) * (m.rate || 1) : 0);
  return m.duration ? Math.max(0, Math.min(m.duration, pos)) : Math.max(0, pos);
}
function playerClock(s) {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// A player in `card`: floating (its own window) or `docked` (in a sidebar, `sidebar`). Returns what main.js tells it.
// Docked, a video is as tall as `dockHeight()` at most (narrower and centred when that's what holds it), and the
// handle along its top sets that height (`onDockHeight` keeps it).
function createPlayer(card, { docked = false, sidebar = null, dockHeight = () => 240, onDockHeight = () => {} } = {}) {
  const PL = { want: null, video: false, pc: null, streamFor: null, timer: 0, size: '', html: '', videoSize: 0 };
  card.innerHTML = '<div class="mp-bg"></div><video class="mpv" autoplay muted playsinline></video><div class="mp-ui"></div><div class="mpv-grip" aria-hidden="true"></div>'
    + (docked ? '<div class="mp-dock-grip" title="Drag to resize" aria-hidden="true"></div>' : '');
  const ui = $('.mp-ui', card);
  const video = $('.mpv', card);

  function uiHtml(want) {
    const m = want.state;
    const sub = m?.artist ? `${m.artist} · ${want.site}` : want.site;
    const btn = (act, name, label, cls = '') => `<button class="mp-btn ${cls}" data-mp="${act}" aria-label="${esc(label)}">${plIcon(name)}</button>`;
    let controls;
    if (!m) {
      controls = `<button class="mp-btn" data-mp="mute" aria-label="${want.muted ? 'Unmute tab' : 'Mute tab'}">${icon(want.muted ? 'mute' : 'volume', 16)}</button>`;
    } else {
      const before = m.prev ? btn('prev', 'prev', 'Previous') : m.seek && m.duration ? btn('back', 'back', 'Back 10 seconds') : '';
      const after = m.next ? btn('next', 'next', 'Next') : m.seek && m.duration ? btn('ahead', 'ahead', 'Ahead 10 seconds') : '';
      controls = `${before}${btn('toggle', m.playing ? 'pause' : 'play', m.playing ? 'Pause' : 'Play', 'mp-main')}${after}`;
    }
    const seek = m?.duration && m.seek ? `
      <div class="mp-seek" data-mp="seek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="${Math.round(m.duration)}"><i class="mp-fill"></i></div>
      <div class="mp-times"><span class="mp-at"></span><span class="mp-left"></span></div>` : '';
    const art = m?.artwork ? `<img src="${esc(m.artwork)}" alt="">` : favHtml(want.favicon, want.url, want.title);
    const head = `
      <div class="mp-head">
        ${PL.video ? '' : `<button class="mp-cover" data-mp="open" aria-label="Go to tab">${art}</button>`}
        <button class="mp-text" data-mp="open" aria-label="Go to tab"><span class="mp-title">${esc(want.title)}</span><span class="mp-sub">${esc(sub)}</span></button>
        ${PL.video ? `<button class="mp-icon" data-mp="open" aria-label="Back to the tab">${plIcon('open')}</button>` : ''}
        <button class="mp-icon" data-mp="close" aria-label="Close player">${icon('close', 13)}</button>
      </div>`;
    return PL.video
      ? `${head}<div class="mp-controls">${controls}</div><div class="mpv-foot">${seek}</div>`
      : `${head}${seek}<div class="mp-controls">${controls}</div>`;
  }

  function render() {
    const want = PL.want;
    if (!want) {
      card.hidden = true;
      clearInterval(PL.timer);
      stopVideo();
      return;
    }
    const m = want.state;
    card.hidden = false;
    card.classList.toggle('mp-video', PL.video);
    card.classList.toggle('mp-art', Boolean(m?.artwork));
    card.classList.toggle('paused', !want.playing);
    const bg = $('.mp-bg', card);
    bg.style.backgroundImage = m?.artwork ? `url('${m.artwork.replace(/'/g, '%27')}')` : '';
    const html = uiHtml(want);
    if (html !== PL.html) { PL.html = html; ui.innerHTML = html; }
    tick();
    clearInterval(PL.timer);
    PL.timer = m?.playing && m.duration ? setInterval(tick, 500) : 0;
    if (PL.video) startVideo(); else stopVideo();
    fit();
  }

  function tick() {
    const m = PL.want?.state;
    if (!m?.duration) return;
    const pos = playerPosition(m);
    const fill = $('.mp-fill', ui);
    if (fill) fill.style.width = `${(pos / m.duration) * 100}%`;
    const at = $('.mp-at', ui);
    if (at) at.textContent = playerClock(pos);
    const left = $('.mp-left', ui);
    if (left) left.textContent = `-${playerClock(m.duration - pos)}`;
  }

  // Its size: the card's, or the video's at the size you gave it (docked: the sidebar's width). Floating, its window
  // takes that size. The size you give a video is its longer side, its width or a portrait video's height, so a video
  // of either shape comes out about as big; and it's never bigger than the screen it's on, so its corner grip stays
  // where you can reach it.
  function ratio() {
    const m = PL.want?.state;
    return Math.max(0.3, Math.min(2, m?.width && m?.height ? m.height / m.width : 9 / 16));
  }
  // the video's width for a longer side of `long`, kept to the screen (and at least wide enough for its controls)
  function videoWidth(long) {
    const r = ratio();
    const room = { w: screen.availWidth - PLAYER_MARGIN * 2 - 24, h: screen.availHeight - PLAYER_MARGIN * 2 - 24 };
    let w = Math.max(240, Math.min(1200, long)) / Math.max(1, r);
    w = Math.min(w, room.w, room.h / r);
    return Math.round(Math.max(240, w));
  }
  const longSide = (w) => Math.round(w * Math.max(1, ratio()));
  // docked: as wide as the sidebar, unless that would make it taller than its height (then narrower, centred)
  const dockLimits = () => ({ min: 140, max: Math.max(140, Math.round((sidebar || card.parentElement).clientHeight * 0.7)) });
  function fitDocked(height = dockHeight()) {
    if (!PL.video) { card.style.width = ''; card.style.height = ''; return; }
    const box = card.parentElement;
    const cs = getComputedStyle(box);
    const full = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const { min, max } = dockLimits();
    const h = Math.min(Math.max(min, Math.min(max, height)), full * ratio());
    card.style.width = `${Math.round(h / ratio())}px`;
    card.style.height = `${Math.round(h)}px`;
  }
  function fit({ keep = false, user = false, width } = {}) {
    if (docked) { fitDocked(); return; }
    let w;
    let h;
    if (PL.video) {
      w = width ? videoWidth(longSide(width)) : videoWidth(PL.videoSize || PL.want?.videoWidth || 400);
      PL.videoSize = longSide(w);
      h = Math.round(w * ratio());
      card.style.width = `${w}px`;
      card.style.height = `${h}px`;
    } else {
      w = PLAYER_CARD_WIDTH;
      card.style.width = `${PLAYER_CARD_WIDTH}px`;
      card.style.height = '';
      h = Math.ceil(card.getBoundingClientRect().height);
    }
    const size = `${w}x${h}`;
    if (size === PL.size && !keep) return;
    PL.size = size;
    window.ultima.playerFit({ width: w + PLAYER_MARGIN * 2, height: h + PLAYER_MARGIN * 2, keep, user: user && PL.video ? PL.videoSize : 0 });
  }

  // ---- the video's picture ----
  function stopVideo() {
    if (PL.pc) { try { PL.pc.close(); } catch { /* closed */ } }
    PL.pc = null;
    if (PL.streamFor != null && PL.want) window.ultima.playerAction('stream-stop');
    PL.streamFor = null;
    video.srcObject = null;
  }
  function startVideo() {
    const id = PL.want.webContentsId;
    if (PL.streamFor === id) return;
    stopVideo();
    PL.streamFor = id;
    window.ultima.playerAction('stream');
  }
  const gathered = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve(); });
    setTimeout(resolve, 2500);
  });
  async function onSignal(json) {
    let msg = null;
    try { msg = JSON.parse(json); } catch { return; }
    if (!msg || !PL.video || !PL.want) return;
    if (msg.failed) { window.ultima.playerAction('video-failed'); return; }
    if (!msg.offer) return;
    if (PL.pc) { try { PL.pc.close(); } catch { /* closed */ } }
    const pc = new RTCPeerConnection();
    PL.pc = pc;
    pc.ontrack = (e) => {
      video.srcObject = e.streams[0] || new MediaStream([e.track]);
      video.play().catch(() => {});
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    if (PL.pc === pc) window.ultima.playerAction('answer', pc.localDescription.sdp);
  }
  video.addEventListener('playing', () => card.classList.add('live'));
  video.addEventListener('emptied', () => card.classList.remove('live'));

  // ---- buttons, dragging and resizing ----
  ui.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mp]');
    const act = el?.dataset.mp;
    const m = PL.want?.state;
    if (!act || !PL.want) return;
    if (act === 'seek' && m?.duration) {
      const r = el.getBoundingClientRect();
      const to = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.duration;
      Object.assign(m, { position: to, got: Date.now() }); // shows there now; the page confirms
      tick();
      window.ultima.playerAction('seek', to);
    } else if (act === 'back' || act === 'ahead') window.ultima.playerAction('skip', act === 'back' ? -10 : 10);
    else window.ultima.playerAction(act);
  });

  // It drags from anywhere on it, its buttons and seek bar too: a press that moves is a drag (and not a click).
  // Floating, dragging moves its window as the pointer goes (not the system's own dragging, which would stop the
  // hover effects); let go over a sidebar, it docks there. Docked, it stays put until it's dragged out of the
  // sidebar: then it floats, under the pointer, and this window drags it on (its pointer is caught here).
  // A video clicked without dragging (not on a button) plays or pauses.
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (docked && e.target.closest('.mp-dock-grip')) { resizeDocked(e); return; }
    const grip = !docked && e.target.closest('.mpv-grip');
    const onControl = Boolean(e.target.closest('button, .mp-seek'));
    const start = { x: e.screenX, y: e.screenY, wx: window.screenX, wy: window.screenY, w: card.getBoundingClientRect().width, moved: false, out: false };
    const catcher = docked ? document.body : card; // (docked, the card hides once it's out)
    let pages = [];
    let frame = 0;
    const move = (ev) => {
      const dx = ev.screenX - start.x;
      const dy = ev.screenY - start.y;
      if (!start.moved) {
        if (Math.hypot(dx, dy) < 4) return;
        // a drag now: the pointer is caught here from now on (not before, so a press on a button stays its click)
        start.moved = true;
        card.classList.add('mp-dragging'); // (its buttons stay still: none pressed or lit as it goes)
        try { catcher.setPointerCapture(e.pointerId); } catch { /* let go already */ }
        if (docked) {
          pages = $$('webview');
          pages.forEach((w) => { w.style.pointerEvents = 'none'; }); // the page mustn't swallow the pointer
        }
      }
      if (docked) {
        if (!start.out) {
          const s = (sidebar || card).getBoundingClientRect();
          if (ev.clientX >= s.left - 16 && ev.clientX <= s.right + 16 && ev.clientY >= s.top - 16 && ev.clientY <= s.bottom + 16) return;
          const r = card.getBoundingClientRect();
          start.out = true;
          window.ultima.playerUndock((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, ev.screenX, ev.screenY);
        } else window.ultima.playerDrag(ev.screenX, ev.screenY);
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // the grip follows whichever way you drag it further: across, or down (as a portrait video mostly is)
        if (grip) {
          const across = start.w + dx;
          const down = start.w + dy / ratio();
          fit({ keep: true, width: Math.abs(dx) >= Math.abs(dy / ratio()) ? across : down, user: true });
        }
        else window.ultima.playerMove(start.wx + dx, start.wy + dy, ev.screenX, ev.screenY);
      });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      pages.forEach((w) => { w.style.pointerEvents = ''; });
      card.classList.remove('mp-dragging');
      if (start.moved) {
        // the click that ends a drag doesn't press the button it started on
        const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', eat, true), 0);
      }
      if (docked ? start.out : start.moved && !grip) window.ultima.playerDrop(ev.screenX, ev.screenY);
      if (!start.moved && !grip && !onControl && PL.video) window.ultima.playerAction('toggle');
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
  // Docked, the handle along its top: dragged up, the video takes more of the sidebar (the tabs keep the rest);
  // down, less. Kept for next time when it's let go.
  function resizeDocked(e) {
    e.preventDefault();
    const grip = e.target;
    const start = { y: e.clientY, h: card.getBoundingClientRect().height };
    let height = start.h;
    try { grip.setPointerCapture(e.pointerId); } catch { /* let go already */ }
    card.classList.add('mp-resizing');
    const move = (ev) => {
      const { min, max } = dockLimits();
      height = Math.max(min, Math.min(max, start.h - (ev.clientY - start.y)));
      fitDocked(height);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      card.classList.remove('mp-resizing');
      onDockHeight(Math.round(height));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  card.addEventListener('dblclick', (e) => { if (PL.video && !e.target.closest('button, .mp-seek, .mpv-grip, .mp-dock-grip')) window.ultima.playerAction('open'); });

  return {
    state(want) {
      const before = PL.want;
      if (want && !before) PL.streamFor = null; // (a new start: whoever drew it before has stopped its video)
      PL.want = want;
      if (want) {
        if (!docked) document.documentElement.style.setProperty('--accent', want.accent || '#8b5cf6');
        if (!before || before.webContentsId !== want.webContentsId || before.video !== want.video) PL.size = '';
        PL.video = Boolean(want.video);
        if (!PL.video && PL.streamFor != null) stopVideo();
      }
      render();
    },
    signal: onSignal,
    // the sidebar changed size: docked, it fits again
    refit() { if (docked && PL.want) fitDocked(); },
    // over a sidebar, as it's dragged: it would dock there
    docking(on) { card.classList.toggle('mp-docking', Boolean(on)); },
  };
}

// the player's own window
if (document.body.classList.contains('player')) {
  const player = createPlayer($('#card'));
  window.ultima.on('player-state', player.state);
  window.ultima.on('player-signal', player.signal);
  window.ultima.on('player-dock-hover', player.docking);
}
