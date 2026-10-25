// The starfield behind everything: stars drift towards you; "warp" stretches them into streaks while installing,
// "burst" throws them outward for the finale, "reverse" lets them fall away while uninstalling.
const Stars = (() => {
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tints = ['255,255,255', '196,181,253', '165,243,252', '245,208,254'];
  const SPEEDS = { idle: 0.55, warp: 11, burst: 70, reverse: -1.6, calm: 0.35 };
  const stars = [];
  let w = 0, h = 0, depth = 0;
  let speed = SPEEDS.idle, target = SPEEDS.idle, settleTo = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight; depth = w;
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

  function project(x, y, z) {
    const f = w * 0.55;
    return [w / 2 + (x / z) * f, h * 0.47 + (y / z) * f];
  }

  function frame() {
    speed += (target - speed) * (target === SPEEDS.burst ? 0.22 : 0.035);
    if (settleTo && Math.abs(speed - target) < target * 0.12) { target = SPEEDS[settleTo]; settleTo = null; }
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.pz = s.z;
      s.z -= speed;
      if (s.z < 1) place(s, 1);
      else if (s.z > depth) place(s, 0.04 + Math.random() * 0.1);
      const [x, y] = project(s.x, s.y, s.z);
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) { place(s, speed > 0 ? 1 : 0.1); continue; }
      const [px, py] = project(s.x, s.y, s.pz);
      const near = 1 - s.z / depth;
      const alpha = Math.min(1, near * 1.25) * (0.35 + 0.65 * near);
      ctx.strokeStyle = `rgba(${s.tint},${alpha})`;
      ctx.lineWidth = s.size * (0.6 + near * 1.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(Math.abs(speed) < 1.5 ? x + 0.01 : x, y); // a dot when slow, a streak when fast
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  }

  function still() { // reduced motion: a quiet sky
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const [x, y] = project(s.x, s.y, s.z);
      ctx.fillStyle = `rgba(${s.tint},${0.25 + 0.6 * (1 - s.z / depth)})`;
      ctx.fillRect(x, y, s.size, s.size);
    }
  }

  resize();
  for (let i = 0; i < 280; i++) stars.push(place({}, Math.random()));
  window.addEventListener('resize', () => { resize(); if (reduced) still(); });
  if (reduced) still(); else requestAnimationFrame(frame);

  return {
    // idle | warp | burst (then settles to calm) | reverse | calm
    mode(name) {
      target = SPEEDS[name] ?? SPEEDS.idle;
      settleTo = name === 'burst' ? 'calm' : null;
    },
  };
})();
