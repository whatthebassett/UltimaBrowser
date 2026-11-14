// What a page is playing, for the mini player (renderer/miniplayer.js, player.js): its title, artist and artwork (the
// page's media session, as for the system's media controls), whether it's playing, and where. And the controls: play,
// pause, next, previous and seeking. They use the page's own media session handlers when it has them (Spotify,
// YouTube Music…), so its player stays in step, and the audio or video element itself otherwise.
// A video is shown in the mini player itself: its picture goes there over a connection inside this computer (WebRTC;
// its sound stays with the page). A page's own picture-in-picture button opens the mini player too, so there's only
// ever the one player.
// A session preload (see setupSession in main.js), so it runs in every frame: embedded players are frames of their own.
// Only media with sound counts, so muted background videos and animated pictures never show a player.
const { contextBridge, ipcRenderer } = require('electron');

const report = (json) => ipcRenderer.send('ultima:media', json);
const signal = (json) => ipcRenderer.send('ultima:media-signal', json);
let control = null;
const listen = (fn) => { control = fn; };
ipcRenderer.on('ultima:media-control', (_e, action, arg) => {
  try { control?.(String(action), typeof arg === 'string' ? arg : Number(arg) || 0); } catch { /* page gone */ }
});

function installMedia(send, sendSignal, register, token) {
  try {
    if (!window.HTMLMediaElement) return;
    // like Chrome's own functions: no prototype (methods and accessors), and they print as built-in (native-preload.js)
    const native = (fn, name) => { try { Function.prototype.toString.call(fn, token, `function ${name}() { [native code] }`); } catch { /* as it is */ } return fn; };
    const handlers = {};
    const watched = new WeakSet();
    let current = null;
    let session = null; // the page's navigator.mediaSession, once it has used it
    let popout = false; // the page asked for picture in picture: the mini player shows it, even on the tab you're on

    const audible = (el) => !el.muted && el.volume > 0;
    const playing = (el) => Boolean(el) && !el.paused && !el.ended;

    let timer = 0;
    let last = '';
    function queue() {
      if (timer) return;
      timer = setTimeout(() => { timer = 0; flush(); }, 120);
    }
    function artworkOf(meta) {
      const list = Array.from((meta && meta.artwork) || []);
      const size = (a) => Math.max(0, ...String(a.sizes || '').split(/\s+/).map((s) => parseInt(s, 10) || 0));
      list.sort((a, b) => size(b) - size(a));
      const best = list.find((a) => /^(https?|data):/.test(a.src || ''));
      return best ? best.src : '';
    }
    function flush() {
      const meta = session && session.metadata;
      const has = Boolean(current) || Boolean(meta && (handlers.play || handlers.pause));
      let state = null;
      if (has) {
        const el = current;
        const video = el instanceof HTMLVideoElement && el.videoWidth > 0;
        state = {
          playing: el ? playing(el) : session.playbackState === 'playing',
          title: (meta && meta.title) || '',
          artist: (meta && meta.artist) || '',
          artwork: artworkOf(meta),
          duration: el && Number.isFinite(el.duration) ? el.duration : 0,
          position: el ? el.currentTime : 0,
          rate: el ? el.playbackRate : 1,
          video,
          width: video ? el.videoWidth : 0,
          height: video ? el.videoHeight : 0,
          popout: popout && video,
          next: Boolean(handlers.nexttrack),
          prev: Boolean(handlers.previoustrack),
          seek: Boolean(el) || Boolean(handlers.seekto),
        };
      }
      // position moves all the time; it's sent with every other change, and the mini player counts on from there
      const key = state ? JSON.stringify({ ...state, position: 0 }) : 'null';
      if (key === last) return;
      last = key;
      send(JSON.stringify(state));
    }
    function onEvent(e) {
      const el = e.currentTarget;
      if ((e.type === 'play' || e.type === 'playing' || e.type === 'volumechange') && audible(el) && !el.paused && el !== current) {
        current = el;
        if (rtc) startStream(); // the mini player shows the new one
      }
      if (el === current && e.type === 'emptied' && !el.currentSrc) current = null;
      if (el === current && e.type === 'seeked') last = ''; // a jump: send where it is now
      if (el === current || e.type === 'volumechange') queue();
    }
    function watch(el) {
      if (watched.has(el)) return;
      watched.add(el);
      for (const type of ['play', 'playing', 'pause', 'ended', 'emptied', 'durationchange', 'ratechange', 'seeked', 'volumechange', 'loadedmetadata', 'resize']) {
        el.addEventListener(type, onEvent);
      }
    }
    // media in the page: its first play is seen here (media events don't bubble, but capturing listeners see them)
    document.addEventListener('play', (e) => {
      if (e.target instanceof HTMLMediaElement && !watched.has(e.target)) { watch(e.target); onEvent({ type: 'play', currentTarget: e.target }); }
    }, true);
    // and media that never joins the page (new Audio(), Spotify's player), from its play()
    const play = HTMLMediaElement.prototype.play;
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: native({ play() { watch(this); return play.apply(this, arguments); } }.play, 'play'),
      configurable: true, writable: true, enumerable: true,
    });
    // the page's picture-in-picture button opens the mini player instead of a second, different player; only from a
    // click or key press, as in Chrome, so a page can't open it by itself
    if (window.HTMLVideoElement && HTMLVideoElement.prototype.requestPictureInPicture) {
      Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', {
        value: native({ requestPictureInPicture() {
          if (navigator.userActivation && !navigator.userActivation.isActive) {
            return Promise.reject(new DOMException('Must be handling a user gesture if there isn\'t already an element in Picture-in-Picture.', 'NotAllowedError'));
          }
          watch(this);
          current = this;
          popout = true;
          last = '';
          queue();
          return Promise.resolve({ width: this.videoWidth, height: this.videoHeight, onresize: null, addEventListener() {}, removeEventListener() {} });
        } }.requestPictureInPicture, 'requestPictureInPicture'),
        configurable: true, writable: true, enumerable: true,
      });
    }

    // the page's media session: its title and artwork, and what its buttons do
    if (window.MediaSession) {
      const proto = MediaSession.prototype;
      const setAction = proto.setActionHandler;
      Object.defineProperty(proto, 'setActionHandler', {
        value: native({ setActionHandler(action, handler) {
          const r = setAction.call(this, action, handler);
          session = this;
          handlers[action] = typeof handler === 'function' ? handler : null;
          queue();
          return r;
        } }.setActionHandler, 'setActionHandler'),
        configurable: true, writable: true, enumerable: true,
      });
      for (const prop of ['metadata', 'playbackState']) {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (!d || !d.set) continue;
        Object.defineProperty(proto, prop, {
          get: d.get,
          set: native(Object.getOwnPropertyDescriptor({ set [prop](v) { d.set.call(this, v); session = this; queue(); } }, prop).set, `set ${prop}`),
          configurable: true, enumerable: d.enumerable,
        });
      }
    }

    // ---- the video's picture, for the mini player ----
    // This page offers it; the mini player answers. Both ends are in Ultima, so there's nothing to trickle: each side
    // sends its whole description once its own addresses are known.
    let rtc = null;
    const gathered = (pc) => new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve(); });
      setTimeout(resolve, 2500);
    });
    function stopStream() {
      uncoverVideo();
      if (!rtc) return;
      try { rtc.pc.close(); } catch { /* closed */ }
      rtc = null;
    }
    async function startStream() {
      stopStream();
      const el = current;
      let stream = null;
      try { stream = el instanceof HTMLVideoElement ? el.captureStream() : null; } catch { /* protected video (DRM) */ }
      if (!stream) { sendSignal(JSON.stringify({ failed: true })); return; }
      const pc = new RTCPeerConnection();
      const mine = { pc };
      rtc = mine;
      const live = () => stream.getVideoTracks().find((t) => t.readyState === 'live');
      if (!live()) await new Promise((r) => { stream.addEventListener('addtrack', r, { once: true }); setTimeout(r, 2000); });
      if (rtc !== mine) return;
      const track = live();
      if (!track) { stopStream(); sendSignal(JSON.stringify({ failed: true })); return; }
      // once the mini player shows it, the page shows a note in its place
      pc.addEventListener('connectionstatechange', () => {
        if (rtc !== mine) return;
        if (pc.connectionState === 'connected') coverVideo(el);
        else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') uncoverVideo();
      });
      const sender = pc.addTrack(track, stream);
      // a new video in the same player (the next one on YouTube) is a new track: it takes the old one's place
      stream.addEventListener('addtrack', () => { const t = live(); if (t && rtc === mine) sender.replaceTrack(t).catch(() => {}); });
      try {
        const p = sender.getParameters();
        p.degradationPreference = 'maintain-resolution';
        if (p.encodings && p.encodings[0]) p.encodings[0].maxBitrate = 12000000;
        await sender.setParameters(p);
      } catch { /* the browser's own choice */ }
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      if (rtc === mine) sendSignal(JSON.stringify({ offer: pc.localDescription.sdp }));
    }

    // ---- the note in the video's place, while the mini player shows it ----
    // Laid over the video, as the next thing after it in the page, so the page's own controls stay on top and work as
    // before (it lets the pointer through). The video itself plays on underneath: the mini player's picture is its.
    const shade = { host: null, video: null, loop: 0, at: '' };
    const SHADE_CSS = `:host { all: initial; position: absolute; display: block; pointer-events: none; overflow: hidden; }
      .c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 8px; box-sizing: border-box;
        background: radial-gradient(ellipse at 50% 42%, #26222f, #0c0b11 72%); color: rgb(255 255 255 / 0.82);
        font: 500 15px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; animation: in 0.25s ease; }
      @keyframes in { from { opacity: 0; } }
      .i { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; color: #fff;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0.05) 55%, rgb(255 255 255 / 0.12));
        box-shadow: inset 0 1.5px 0.5px rgb(255 255 255 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.12), inset 0 -9px 12px -9px rgb(255 255 255 / 0.45), 0 6px 14px -6px rgb(0 0 0 / 0.6); }
      svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .inner { fill: currentColor; stroke: none; }
      :host(.small) .t { display: none; }
      :host(.small) .i { width: 40px; height: 40px; }`;
    function shadeEl() {
      if (shade.host) return shade.host;
      const host = document.createElement('ultima-mini-player-note');
      const root = host.attachShadow({ mode: 'closed' });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(SHADE_CSS);
        root.adoptedStyleSheets = [sheet];
      } catch {
        const style = document.createElement('style');
        style.textContent = SHADE_CSS;
        root.append(style);
      }
      const NS = 'http://www.w3.org/2000/svg';
      const c = document.createElement('div');
      c.className = 'c';
      const i = document.createElement('div');
      i.className = 'i';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const shape = (attrs) => { const el = document.createElementNS(NS, 'rect'); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.append(el); };
      shape({ x: '2.5', y: '4.5', width: '19', height: '15', rx: '2.5' });
      shape({ x: '12', y: '11.5', width: '7', height: '5', rx: '1.2', class: 'inner' });
      i.append(svg);
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = 'Playing in the mini player';
      c.append(i, t);
      root.append(c);
      shade.host = host;
      return host;
    }
    // it keeps to the video as the page moves it or changes its size
    function placeShade() {
      const v = shade.video;
      if (!v || !v.isConnected || !v.parentNode) { uncoverVideo(); return; }
      const host = shade.host;
      if (host.previousSibling !== v) v.after(host);
      const z = getComputedStyle(v).zIndex;
      const at = `${v.offsetLeft},${v.offsetTop},${v.offsetWidth},${v.offsetHeight},${z}`;
      if (at !== shade.at) {
        shade.at = at;
        Object.assign(host.style, { left: `${v.offsetLeft}px`, top: `${v.offsetTop}px`, width: `${v.offsetWidth}px`, height: `${v.offsetHeight}px`, zIndex: z === 'auto' ? '' : z });
        host.classList.toggle('small', v.offsetWidth < 260 || v.offsetHeight < 150);
      }
      shade.loop = requestAnimationFrame(placeShade);
    }
    function coverVideo(v) {
      if (!(v instanceof HTMLVideoElement)) return;
      uncoverVideo();
      shadeEl();
      shade.video = v;
      shade.at = '';
      placeShade();
    }
    function uncoverVideo() {
      cancelAnimationFrame(shade.loop);
      shade.loop = 0;
      shade.video = null;
      if (shade.host) shade.host.remove();
    }

    // ---- a button over a video, to open it in the mini player (or bring it back) ----
    // Liquid glass, like the mini player's own, at the video's right edge while you point at it. It's drawn in a
    // closed shadow root, with its own styles, so the page neither styles it nor sees inside it. Short clips, small
    // videos and ones the page keeps out of picture in picture (disablePictureInPicture) don't get one.
    let buttonOn = false; // (until main.js says the mini player is on)
    const pip = { host: null, btn: null, video: null, at: 0, x: 0, y: 0, frame: 0, loop: 0 };
    const SIZE = 40;
    const CSS = `:host { all: initial; position: fixed; z-index: 2147483647; width: ${SIZE}px; height: ${SIZE}px; opacity: 0; pointer-events: none; transition: opacity 0.18s ease; }
      :host(.on) { opacity: 1; pointer-events: auto; }
      button { all: unset; box-sizing: border-box; position: relative; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #fff;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.26), rgb(255 255 255 / 0.06) 55%, rgb(255 255 255 / 0.14)), rgb(18 18 26 / 0.32);
        -webkit-backdrop-filter: blur(8px) saturate(1.9) brightness(1.1); backdrop-filter: blur(8px) saturate(1.9) brightness(1.1);
        box-shadow: inset 0 1.5px 0.5px rgb(255 255 255 / 0.6), inset 0 -1px 0.5px rgb(255 255 255 / 0.22), inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 -9px 12px -9px rgb(255 255 255 / 0.5), 0 6px 14px -6px rgb(0 0 0 / 0.55);
        transition: transform 0.22s cubic-bezier(0.3, 1.6, 0.5, 1), background 0.15s; }
      button::before { content: ""; position: absolute; left: 18%; right: 18%; top: 7%; height: 38%; border-radius: 50%; pointer-events: none; background: linear-gradient(180deg, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0)); opacity: 0.75; }
      button:hover { transform: scale(1.08); background: linear-gradient(180deg, rgb(255 255 255 / 0.36), rgb(255 255 255 / 0.1) 55%, rgb(255 255 255 / 0.2)), rgb(18 18 26 / 0.32); }
      button:active { transform: scale(0.92); transition-duration: 0.08s; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      svg { position: relative; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.35)); }
      .inner { fill: currentColor; stroke: none; }`;
    function pipButton() {
      if (pip.host) return pip.host;
      const host = document.createElement('ultima-mini-player');
      const root = host.attachShadow({ mode: 'closed' });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet]; // (a page's style rules for itself don't stop these)
      } catch {
        const style = document.createElement('style');
        style.textContent = CSS;
        root.append(style);
      }
      const btn = document.createElement('button');
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const shape = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.append(el); };
      shape('rect', { x: '2.5', y: '4.5', width: '19', height: '15', rx: '2.5' });
      shape('rect', { x: '12', y: '11.5', width: '7', height: '5', rx: '1.2', class: 'inner' });
      btn.append(svg);
      root.append(btn);
      // its clicks are its own: the page underneath doesn't see them (as a click on its video, say)
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
        host.addEventListener(type, (e) => { e.stopPropagation(); if (type !== 'pointerdown' && type !== 'pointerup') e.preventDefault(); });
      }
      btn.addEventListener('click', () => popVideo(pip.video));
      pip.host = host;
      pip.btn = btn;
      return host;
    }
    // into the mini player, or back to the page if it's there
    function popVideo(v) {
      if (!(v instanceof HTMLVideoElement)) return;
      if (popout && current === v) popout = false;
      else { watch(v); current = v; popout = true; }
      label();
      last = '';
      queue();
    }
    // the video right-clicked, for Ultima's menu (Open in mini player)
    let menuVideo = null;
    window.addEventListener('contextmenu', (e) => {
      menuVideo = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLVideoElement) || null;
    }, true);
    const label = () => { if (pip.btn) pip.btn.setAttribute('aria-label', popout && current === pip.video ? 'Back to the page' : 'Open in mini player'); };
    const fits = (v) => v instanceof HTMLVideoElement && v.videoWidth > 0 && !v.disablePictureInPicture && !(v.duration < 30)
      && v.getBoundingClientRect().width >= 200 && v.getBoundingClientRect().height >= 112;
    function videoAt(x, y) {
      for (const el of document.elementsFromPoint(x, y)) if (el instanceof HTMLVideoElement) return fits(el) ? el : null;
      return null;
    }
    function placeButton() {
      const v = pip.video;
      if (!v || !v.isConnected) { hideButton(); return; }
      const r = v.getBoundingClientRect();
      const left = Math.min(r.right, innerWidth) - SIZE - 12;
      const top = Math.max(r.top, 0) + (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) - SIZE) / 2;
      pip.host.style.left = `${Math.round(left)}px`;
      pip.host.style.top = `${Math.round(top)}px`;
      // it goes once the pointer is still for a while, or has left the video
      const inside = pip.x >= r.left && pip.x <= r.right && pip.y >= r.top && pip.y <= r.bottom;
      const still = Date.now() - pip.at > 2500 && !pip.host.matches(':hover');
      if (!inside || still) { hideButton(); return; }
      pip.loop = requestAnimationFrame(placeButton);
    }
    function hideButton() {
      cancelAnimationFrame(pip.loop);
      pip.loop = 0;
      if (pip.host) pip.host.classList.remove('on');
      pip.video = null;
    }
    function onPointer(e) {
      pip.x = e.clientX;
      pip.y = e.clientY;
      pip.at = Date.now();
      if (pip.frame) return;
      pip.frame = requestAnimationFrame(() => {
        pip.frame = 0;
        if (!buttonOn || document.fullscreenElement || e.pointerType === 'touch') { hideButton(); return; }
        const v = videoAt(pip.x, pip.y);
        if (!v) { if (!pip.host?.matches(':hover')) hideButton(); return; }
        const host = pipButton();
        if (host.parentNode !== document.documentElement) document.documentElement.append(host);
        pip.video = v;
        label();
        host.classList.add('on');
        if (!pip.loop) placeButton();
      });
    }
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    window.addEventListener('pointerout', (e) => { if (!e.relatedTarget) hideButton(); }, true); // (out of the page)

    const call = (action, extra) => {
      const fn = handlers[action];
      if (!fn) return false;
      try { fn.call(session, { action, ...extra }); } catch { /* the page's own */ }
      return true;
    };
    register((action, arg) => {
      const el = current;
      if (action === 'toggle') {
        const isPlaying = el ? playing(el) : session && session.playbackState === 'playing';
        if (isPlaying) { if (!call('pause') && el) el.pause(); } else if (!call('play') && el) el.play().catch(() => {});
      } else if (action === 'next') call('nexttrack');
      else if (action === 'prev') call('previoustrack');
      else if (action === 'seek') { if (!call('seekto', { seekTime: arg }) && el) el.currentTime = arg; }
      else if (action === 'skip') {
        const by = arg || 10;
        if (!call(by < 0 ? 'seekbackward' : 'seekforward', { seekOffset: Math.abs(by) }) && el) {
          el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + by));
        }
      } else if (action === 'unpop') { popout = false; label(); }
      else if (action === 'pop') { popVideo(menuVideo); return; }
      else if (action === 'button') { buttonOn = Boolean(arg); if (!buttonOn) hideButton(); return; }
      else if (action === 'stream') { startStream(); return; }
      else if (action === 'stream-stop') { stopStream(); return; }
      else if (action === 'answer') {
        if (rtc && typeof arg === 'string') rtc.pc.setRemoteDescription({ type: 'answer', sdp: arg }).catch(() => {});
        return;
      }
      last = '';
      queue();
    });
    // a page that goes away takes its player with it
    window.addEventListener('pagehide', () => { stopStream(); current = null; session = null; popout = false; last = ''; send('null'); });
  } catch { /* never break a page over this */ }
}

if (process.contextIsolated) contextBridge.executeInMainWorld({ func: installMedia, args: [report, signal, listen] });
else installMedia(report, signal, listen);
// the button over videos shows while the mini player is on (Settings → General)
ipcRenderer.invoke('ultima:media-config').then((on) => { try { control?.('button', on ? 1 : 0); } catch { /* page gone */ } }).catch(() => {});
