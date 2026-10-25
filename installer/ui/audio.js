// The score, synthesized live with Web Audio (no audio files): a pad that breathes under everything, a whoosh on
// each cut, chimes on reveals, a low boom and a swelling chord for the finale. Quiet by design; the speaker button mutes it.
const Score = (() => {
  let ctx = null, master = null, verb = null, padFilter = null;
  let muted = false, started = false;
  const LEVEL = 0.42;

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

  const now = () => ctx.currentTime;

  function voice(freq, type, gain, attack, hold, release, when = 0, dest = master, send = 0.4) {
    const t = now() + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.connect(g); g.connect(dest);
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
    const depth = ctx.createGain(); depth.gain.value = 160;
    lfo.connect(depth); depth.connect(padFilter.frequency); lfo.start();
  }

  return {
    // Starts the pad (needs a gesture in ordinary browsers; Setup lets it play straight away)
    start() {
      init();
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
    // brightens the pad as the film gets going (0 calm … 1 bright)
    intensity(level) {
      if (!padFilter) return;
      padFilter.frequency.setTargetAtTime(420 + level * 1400, now(), 1.2);
    },
    chime(freqs, gap = 0.16) {
      if (!ctx) return;
      freqs.forEach((f, i) => { voice(f, 'sine', 0.09, 0.008, 0.05, 2.4, i * gap); voice(f * 2, 'triangle', 0.018, 0.008, 0.02, 1.2, i * gap); });
    },
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
      g.gain.exponentialRampToValueAtTime(0.12, t + duration * 0.5);
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
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 2);
    },
    // the finale: a warm A-major chord swelling in
    swell() {
      if (!ctx) return;
      for (const f of [220, 277.18, 329.63, 440, 554.37]) { voice(f, 'triangle', 0.035, 1.4, 1.6, 4.2, 0.1); voice(f * 1.003, 'sine', 0.03, 1.6, 1.4, 4.5, 0.1); }
    },
    fadeOut(seconds = 1) {
      if (!ctx) return;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(0.0001, now(), seconds / 4);
    },
  };
})();
