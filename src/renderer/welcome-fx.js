// The welcome's world, from the installer (installer/ui): a starfield that drifts towards you, warps into streaks and
// bursts outward, and a score synthesized live with Web Audio (no audio files). Both stop when the welcome ends.

// The starfield on a canvas: idle | warp | burst (then settles to calm) | calm
function createStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduce-motion');
  const tints = ['255,255,255', '196,181,253', '165,243,252', '245,208,254'];
  const SPEEDS = { idle: 0.55, warp: 11, burst: 70, calm: 0.35 };
  const stars = [];
  let w = 0, h = 0, depth = 0, raf = 0;
  let speed = SPEEDS.idle, target = SPEEDS.idle, settleTo = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight; depth = w;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function place(s, z) {
    s.x = (Math.random() * 2 - 1) * w;
    s.y = (Math.random() * 2 - 1) * h;
    s.z = s.pz = z * depth;
    s.tint = tints[(Math.random() * tints.length) | 0];
    s.size = Math.random() * 1.3 + 0.35;
    return s;
  }
  const project = (x, y, z) => { const f = w * 0.55; return [w / 2 + (x / z) * f, h * 0.47 + (y / z) * f]; };

  function frame() {
    speed += (target - speed) * (target === SPEEDS.burst ? 0.22 : 0.035);
    if (settleTo && Math.abs(speed - target) < target * 0.12) { target = SPEEDS[settleTo]; settleTo = null; }
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.pz = s.z;
      s.z -= speed;
      if (s.z < 1) place(s, 1);
      const [x, y] = project(s.x, s.y, s.z);
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) { place(s, 1); continue; }
      const [px, py] = project(s.x, s.y, s.pz);
      const near = 1 - s.z / depth;
      ctx.strokeStyle = `rgba(${s.tint},${Math.min(1, near * 1.25) * (0.35 + 0.65 * near)})`;
      ctx.lineWidth = s.size * (0.6 + near * 1.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(Math.abs(speed) < 1.5 ? x + 0.01 : x, y); // a dot when slow, a streak when fast
      ctx.stroke();
    }
    raf = requestAnimationFrame(frame);
  }
  function still() { // reduced motion: a quiet sky
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const [x, y] = project(s.x, s.y, s.z);
      ctx.fillStyle = `rgba(${s.tint},${0.25 + 0.6 * (1 - s.z / depth)})`;
      ctx.fillRect(x, y, s.size, s.size);
    }
  }
  const onResize = () => { resize(); if (reduced) still(); };

  resize();
  for (let i = 0; i < 280; i++) stars.push(place({}, Math.random()));
  window.addEventListener('resize', onResize);
  if (reduced) still(); else raf = requestAnimationFrame(frame);
  return {
    mode(name) { target = SPEEDS[name] ?? SPEEDS.idle; settleTo = name === 'burst' ? 'calm' : null; },
    stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); },
  };
}

// The score: a pad that breathes under everything, a whoosh on each cut, chimes on choices, a low boom and a swelling
// chord for the finale. Quiet by design; the speaker button mutes it (remembered in welcomeMuted).
function createScore(muted = false) {
  let ctx = null, master = null, verb = null, padFilter = null, started = false;
  const LEVEL = 0.4;
  const now = () => ctx.currentTime;

  function init() {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // a soft space around everything: two feedback delays through a low-pass
    verb = ctx.createGain();
    verb.gain.value = 0.55;
    for (const [time, fb] of [[0.23, 0.42], [0.37, 0.36]]) {
      const d = ctx.createDelay(1);
      d.delayTime.value = time;
      const f = ctx.createGain(); f.gain.value = fb;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      verb.connect(d); d.connect(lp); lp.connect(f); f.connect(d); lp.connect(master);
    }
  }
  function voice(freq, type, gain, attack, hold, release, when = 0, send = 0.4) {
    const t = now() + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.connect(g); g.connect(master);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(verb); }
    o.start(t); o.stop(t + attack + hold + release + 0.1);
  }
  function pad() {
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass'; padFilter.frequency.value = 420; padFilter.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, now() + 4);
    padFilter.connect(g); g.connect(master);
    const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(verb);
    for (const [f, detune] of [[110, -6], [110, 6], [164.81, -4], [220, 3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = detune;
      o.connect(padFilter); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const depthGain = ctx.createGain(); depthGain.gain.value = 160;
    lfo.connect(depthGain); depthGain.connect(padFilter.frequency); lfo.start();
  }

  return {
    start() {
      try { init(); } catch { return; } // no audio device: a silent film
      if (ctx.state === 'suspended') ctx.resume();
      if (started) return;
      started = true;
      master.gain.setValueAtTime(0.0001, now());
      master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : LEVEL, now() + 2);
      pad();
    },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (!ctx) return;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(m ? 0.0001 : LEVEL, now(), 0.15);
    },
    intensity(level) { if (padFilter) padFilter.frequency.setTargetAtTime(420 + level * 1400, now(), 1.2); },
    chime(freqs, gap = 0.16) {
      if (!ctx) return;
      freqs.forEach((f, i) => { voice(f, 'sine', 0.09, 0.008, 0.05, 2.4, i * gap); voice(f * 2, 'triangle', 0.018, 0.008, 0.02, 1.2, i * gap); });
    },
    tick() { if (ctx) voice(1318.5, 'sine', 0.035, 0.004, 0.01, 0.35, 0, 0.25); }, // a small click of light, for a choice
    whoosh(duration = 1.3) {
      if (!ctx) return;
      const t = now();
      const len = Math.ceil(ctx.sampleRate * duration);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + duration * 0.55);
      bp.frequency.exponentialRampToValueAtTime(500, t + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + duration * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(bp); bp.connect(g); g.connect(master);
      const s = ctx.createGain(); s.gain.value = 0.3; g.connect(s); s.connect(verb);
      src.start(t);
    },
    boom() {
      if (!ctx) return;
      const t = now();
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 2);
    },
    swell() { // a warm A-major chord
      if (!ctx) return;
      for (const f of [220, 277.18, 329.63, 440, 554.37]) { voice(f, 'triangle', 0.035, 1.4, 1.6, 4.2, 0.1); voice(f * 1.003, 'sine', 0.03, 1.6, 1.4, 4.5, 0.1); }
    },
    // fades out, then lets the audio device go
    stop(seconds = 1.2) {
      if (!ctx) return;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(0.0001, now(), seconds / 4);
      const c = ctx;
      setTimeout(() => c.close().catch(() => {}), seconds * 1000 + 400);
    },
  };
}
