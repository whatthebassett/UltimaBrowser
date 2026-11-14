// Ultima's website: a starfield, a browser mock that acts out each feature, and a studio where visitors make it theirs.
// The theme presets, accents and loading colors are the app's own (src/renderer/theme.js and settings.js).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

const PRESETS = [
  { name: 'Violet', colors: ['#8b5cf6'] },
  { name: 'Ocean', colors: ['#2563eb', '#06b6d4'] },
  { name: 'Sunset', colors: ['#f97316', '#ec4899', '#8b5cf6'] },
  { name: 'Forest', colors: ['#15803d', '#0d9488'] },
  { name: 'Rose', colors: ['#e11d48', '#fb7185'] },
  { name: 'Aurora', colors: ['#22c55e', '#06b6d4', '#a855f7'] },
  { name: 'Peach', colors: ['#fb923c', '#f9a8d4'] },
  { name: 'Midnight', colors: ['#1e3a8a', '#4c1d95'] },
  { name: 'Candy', colors: ['#ec4899', '#38bdf8'] },
  { name: 'Lagoon', colors: ['#0ea5e9', '#14b8a6', '#84cc16'] },
  { name: 'Ember', colors: ['#b91c1c', '#f59e0b'] },
  { name: 'Graphite', colors: ['#64748b'] },
];
const preset = (name) => PRESETS.find((p) => p.name === name);
const ACCENTS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#a3a3a3'];
const LOADERS = {
  Aurora: ['#22c55e', '#06b6d4', '#a855f7'],
  Sunset: ['#f97316', '#ec4899', '#8b5cf6'],
  Ocean: ['#1d4ed8', '#06b6d4', '#38bdf8'],
  Candy: ['#ec4899', '#a78bfa', '#38bdf8'],
  Rainbow: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'],
  Mono: ['#6b7280', '#f3f4f6', '#9ca3af'],
  'Snow Cone': ['#ffffff', '#65bbf1', '#f16575'],
};

// ---------- color ----------
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
}
// the same gradients the sidebar draws (themeBackground in theme.js)
function spaceBg(c, intensity = 60) {
  const a = intensity / 100;
  if (c.length === 1) return `linear-gradient(180deg, ${rgba(c[0], a)}, ${rgba(c[0], a * 0.45)})`;
  if (c.length === 2) return `linear-gradient(160deg, ${rgba(c[0], a)}, ${rgba(c[1], a)})`;
  return [
    `radial-gradient(85% 55% at 0% 0%, ${rgba(c[0], a)}, transparent 75%)`,
    `radial-gradient(85% 60% at 100% 100%, ${rgba(c[2], a)}, transparent 75%)`,
    `linear-gradient(160deg, ${rgba(c[0], a * 0.6)}, ${rgba(c[1], a)} 50%, ${rgba(c[2], a * 0.6)})`,
  ].join(', ');
}
const loaderBg = (c) => `linear-gradient(90deg, ${[...c, c[0]].join(', ')})`;

// The light around the page follows whichever theme is on screen.
function setAmbient(colors) {
  const c = colors.length === 1 ? [colors[0], colors[0], '#06b6d4'] : colors.length === 2 ? [colors[0], colors[1], colors[0]] : colors;
  const root = document.documentElement.style;
  root.setProperty('--c1', c[0]);
  root.setProperty('--c2', c[1]);
  root.setProperty('--c3', c[2]);
}

// ---------- icons ----------
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tab: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/>',
  split: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 5v14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  play: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m10 9 5 3-5 3z"/>',
  puzzle: '<path d="M9 4.5a2 2 0 1 1 4 0V6h4v4h-1.5a2 2 0 1 0 0 4H17v4.5H5V14h1.5a2 2 0 1 0 0-4H5V6h4z"/>',
  ghost: '<path d="M5.5 20V10a6.5 6.5 0 0 1 13 0v10l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6z"/><circle cx="9.5" cy="10.5" r=".6"/><circle cx="14.5" cy="10.5" r=".6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/>',
  windows: '<rect x="3" y="6.5" width="12" height="10" rx="2"/><path d="M8 4h11a2 2 0 0 1 2 2v8"/>',
  tear: '<rect x="3.5" y="9" width="11" height="10" rx="2"/><path d="M9 5.5h9.5a2 2 0 0 1 2 2V14M14 9l4-4"/>',
  swipe: '<path d="M4 12h9m-3-3 3 3-3 3M16 6.5v11M20 6.5v11"/>',
  import: '<path d="M12 4v10m0 0-4-4m4 4 4-4M5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
};
const ico = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- the browser mock ----------
const urlBar = () => `<div class="m-url"><span class="m-load"></span>${ico('search')}<span class="m-url-text">ultima://new-tab</span>
  <span class="m-shield">${ico('shield')}<b>0</b></span></div>`;
const lights = '<div class="m-lights"><i></i><i></i><i></i></div>';

function mockHTML() {
  return `<div class="mock" data-layout="vertical" data-mode="dark" data-font="inter" data-row="default">
  <div class="m-frame">
    <aside class="m-side">
      ${lights}
      ${urlBar()}
      <div class="m-ess"><span style="--t:#4f8df6">${ico('tab')}</span><span style="--t:#22c55e">${ico('play')}</span><span style="--t:#f59e0b">${ico('bolt')}</span><span style="--t:#ec4899">${ico('pin')}</span></div>
      <div class="m-space"><span class="m-space-ico">🏠</span><span class="m-space-name">Home base</span></div>
      <div class="m-tabs">
        <div class="m-tab on"><i style="--f:#a78bfa"></i><span>Welcome to Ultima</span></div>
        <div class="m-tab"><i style="--f:#34d399"></i><span>Weekend plans</span></div>
        <div class="m-folder open">
          <div class="m-tab m-folder-head">${ico('folder')}<span>Docs</span></div>
          <div class="m-folder-body">
            <div class="m-tab"><i style="--f:#60a5fa"></i><span>Q4 plan</span></div>
            <div class="m-tab"><i style="--f:#60a5fa"></i><span>Roadmap</span></div>
          </div>
        </div>
        <div class="m-tab"><i style="--f:#fbbf24"></i><span>Recipes to try</span></div>
        <div class="m-tab m-new">${ico('plus')}<span>New tab</span></div>
      </div>
      <div class="m-dots"><i class="on"></i><i></i><i></i></div>
    </aside>
    <div class="m-head">
      <div class="m-head-row">${lights}
        <div class="m-htabs"><span class="on"><i style="--f:#a78bfa"></i>Welcome to Ultima</span><span><i style="--f:#34d399"></i>Weekend plans</span><span><i style="--f:#60a5fa"></i>Q4 plan</span><span><i style="--f:#fbbf24"></i>Recipes to try</span></div>
      </div>
      <div class="m-head-row">${urlBar()}</div>
    </div>
    <main class="m-page">
      <div class="m-pane m-main">
        <p class="m-greet">Good evening.</p>
        <div class="m-search">${ico('search')}<span>Search or type an address</span></div>
        <div class="m-banner m-ad"><span>Sponsored</span></div>
        <div class="m-cards">
          <div class="m-card"><b></b><i></i><i></i><i class="short"></i></div>
          <div class="m-card m-ad"><span>Ad</span></div>
          <div class="m-card"><b></b><i></i><i class="short"></i></div>
          <div class="m-card"><b></b><i></i><i></i></div>
        </div>
      </div>
      <div class="m-pane m-second">
        <p class="m-article-title"></p><i></i><i></i><i class="short"></i><div class="m-photo"></div><i></i><i class="short"></i>
      </div>
      <div class="m-palette">
        <div class="m-pal-input">${ico('search')}<span class="m-typed"></span><span class="m-caret"></span></div>
        <div class="m-pal-row on">${ico('tab')}<span>Weekend plans</span><em>Switch to tab</em></div>
        <div class="m-pal-row">${ico('history')}<span>Weather this week</span><em>History</em></div>
        <div class="m-pal-row">${ico('bolt')}<span>Switch tab layout</span><em>Alt+S</em></div>
      </div>
      <div class="m-glance">
        <div class="m-glance-bar"><span class="m-glance-url">${ico('eye')}trail-guide.example</span>
          <span class="m-glance-btn">${ico('tab')}Keep</span><span class="m-glance-btn hot">${ico('split')}Split</span></div>
        <div class="m-glance-body"><p class="m-article-title"></p><i></i><i></i><div class="m-photo"></div><i class="short"></i></div>
      </div>
    </main>
  </div>
</div>`;
}

function applyLook(mock, look) {
  const s = mock.style;
  if (look.colors) {
    s.setProperty('--space-bg', spaceBg(look.colors, look.intensity ?? 60));
    s.setProperty('--space', look.colors[0]);
  }
  if (look.accent) s.setProperty('--m-accent', look.accent);
  if (look.loader) s.setProperty('--load', loaderBg(look.loader));
  for (const k of ['mode', 'layout', 'font', 'row']) if (look[k]) mock.dataset[k] = look[k];
}

function playLoader(mock) {
  mock.classList.remove('loading');
  void mock.offsetWidth; // restart the animation
  mock.classList.add('loading');
  clearTimeout(mock._load);
  mock._load = setTimeout(() => mock.classList.remove('loading'), 2600);
}

for (const slot of $$('.mock-slot')) slot.innerHTML = mockHTML();
const mocks = Object.fromEntries($$('.mock-slot').map((slot) => [slot.dataset.mock, $('.mock', slot)]));
for (const m of Object.values(mocks)) applyLook(m, { colors: PRESETS[0].colors, accent: ACCENTS[0], loader: LOADERS.Aurora });

// ---------- opening, nav and download buttons ----------
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
for (const l of $$('.dl-label')) l.textContent = isMac ? 'Download for Mac' : 'Download for Windows';

requestAnimationFrame(() => document.body.classList.add('play'));
setTimeout(() => document.body.classList.add('opened'), calm ? 0 : 2600);

const nav = $('.nav');
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.18 });
for (const el of $$('.reveal')) io.observe(el);

// ---------- starfield ----------
const canvas = $('#stars');
const ctx = canvas.getContext('2d');
let stars = [];
function sizeStars() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.round((innerWidth * innerHeight) / 5200);
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight * 1.6,
    r: Math.random() ** 3 * 1.4 + 0.25,
    d: Math.random() * 0.35 + 0.05, // depth: how fast it drifts with the scroll
    t: Math.random() * Math.PI * 2,
    s: Math.random() * 0.02 + 0.004,
  }));
}
function drawStars(time = 0) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const h = innerHeight * 1.6;
  for (const st of stars) {
    const y = (((st.y - scrollY * st.d) % h) + h) % h;
    if (y > innerHeight) continue;
    const a = calm ? 0.7 : 0.45 + Math.sin(st.t + time * st.s * 0.06) * 0.35;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(st.x, y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!calm) requestAnimationFrame(drawStars);
}
sizeStars();
drawStars();
addEventListener('resize', () => { sizeStars(); if (calm) drawStars(); });

// ---------- scroll-linked scenes ----------
const hero = $('.hero-inner');
const reveal = $('.reveal-stage');
const tilt = $('.reveal-tilt');
const reelName = $('.reel-name');
let reelIndex = -1;

function onScroll() {
  const y = scrollY;
  nav.classList.toggle('solid', y > 40);
  if (calm) return; // with reduced motion the reel stays on its first look
  // the titles drift up and away
  const hp = clamp(y / (innerHeight * 0.8));
  hero.style.transform = `translateY(${hp * -80}px) scale(${1 - hp * 0.06})`;
  hero.style.opacity = String(1 - hp * 1.15);

  // the browser tilts up out of the dark, then runs through the presets like a reel
  const r = reveal.getBoundingClientRect();
  const p = clamp(-r.top / (r.height - innerHeight));
  const rise = clamp((innerHeight - r.top) / (innerHeight * 1.1));
  const ease = 1 - (1 - rise) ** 3;
  tilt.style.transform = `perspective(1600px) rotateX(${(1 - ease) * 38}deg) translateY(${(1 - ease) * 120}px) scale(${0.82 + ease * 0.18})`;
  tilt.style.opacity = String(clamp(rise * 1.6));
  reveal.style.setProperty('--line', String(clamp((p - 0.82) / 0.12)));
  const i = Math.min(PRESETS.length - 1, Math.floor(clamp((p - 0.08) / 0.78) * PRESETS.length));
  if (r.top < innerHeight && r.bottom > 0 && i !== reelIndex) {
    reelIndex = i;
    const pr = PRESETS[i];
    applyLook(mocks.reveal, { colors: pr.colors, accent: pr.colors[0], loader: pr.colors.length > 1 ? pr.colors : LOADERS.Aurora });
    reelName.textContent = pr.name;
    reelName.classList.remove('flip');
    void reelName.offsetWidth;
    reelName.classList.add('flip');
    if (r.top < innerHeight * 0.5) setAmbient(pr.colors);
    if (i > 0) playLoader(mocks.reveal);
  }
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- the feature reel ----------
const story = mocks.story;
const hint = $('.story-hint');
const HINTS = {
  spaces: '<span>Swipe with two fingers to change spaces</span>',
  tabs: '<kbd>Alt</kbd> <kbd>S</kbd> <span>switches the tab layout</span>',
  palette: '<kbd>Ctrl</kbd> <kbd>K</kbd> <span>opens the Control Palette</span>',
  glance: '<kbd>Alt</kbd> <span>+ click a link to glance at it</span>',
  shield: '<span>Click the shield to let a site through</span>',
};
const SPACES = [
  { name: 'Work', icon: '💼', preset: 'Ocean' },
  { name: 'Personal', icon: '🏠', preset: 'Sunset' },
  { name: 'Play', icon: '🎮', preset: 'Aurora' },
];
let timers = [];
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const every = (ms, fn) => { fn(); timers.push(setInterval(fn, ms)); };

function setSpace(i) {
  const sp = SPACES[i];
  const pr = preset(sp.preset);
  applyLook(story, { colors: pr.colors, accent: pr.colors[pr.colors.length - 1] });
  $('.m-space-name', story).textContent = sp.name;
  $('.m-space-ico', story).textContent = sp.icon;
  $$('.m-dots i', story).forEach((d, j) => d.classList.toggle('on', j === i));
  const tabs = $('.m-tabs', story);
  tabs.classList.remove('swipe');
  void tabs.offsetWidth;
  tabs.classList.add('swipe');
  const r = story.getBoundingClientRect();
  if (r.top < innerHeight && r.bottom > 0) setAmbient(pr.colors);
}

const SCENES = {
  spaces() {
    let i = 0;
    every(2600, () => { setSpace(i); i = (i + 1) % SPACES.length; });
  },
  tabs() {
    setSpace(1);
    let across = false;
    every(2800, () => {
      story.dataset.layout = across ? 'horizontal' : 'vertical';
      $('.m-folder', story).classList.toggle('open', !across);
      across = !across;
    });
  },
  palette() {
    const typed = $('.m-typed', story);
    const rows = $$('.m-pal-row', story);
    every(4200, () => {
      story.dataset.sub = '';
      typed.textContent = '';
      rows.forEach((r, j) => r.classList.toggle('on', j === 0));
      later(350, () => { story.dataset.sub = 'palette'; });
      [...'wee'].forEach((ch, j) => later(900 + j * 160, () => { typed.textContent += ch; }));
      later(1900, () => rows.forEach((r, j) => r.classList.toggle('on', j === 1)));
      later(2400, () => rows.forEach((r, j) => r.classList.toggle('on', j === 0)));
      later(3300, () => { story.dataset.sub = ''; });
    });
  },
  glance() {
    every(4600, () => {
      story.dataset.sub = '';
      later(400, () => { story.dataset.sub = 'glance'; });
      later(2300, () => { story.dataset.sub = 'split'; });
    });
  },
  shield() {
    const counts = $$('.m-shield b', story);
    every(4400, () => {
      story.dataset.sub = 'ads';
      counts.forEach((b) => { b.textContent = '0'; });
      playLoader(story);
      later(900, () => {
        story.dataset.sub = 'blocked';
        let n = 0;
        const tick = setInterval(() => {
          n = Math.min(37, n + 3);
          counts.forEach((b) => { b.textContent = String(n); });
          if (n >= 37) clearInterval(tick);
        }, 45);
        timers.push(tick);
      });
    });
  },
};

let scene = null;
function playScene(name) {
  if (name === scene) return;
  scene = name;
  timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  timers = [];
  story.dataset.scene = name;
  story.dataset.sub = '';
  story.dataset.layout = 'vertical';
  $('.m-folder', story).classList.add('open');
  hint.innerHTML = HINTS[name];
  $$('.step').forEach((s) => s.classList.toggle('on', s.dataset.scene === name));
  SCENES[name]();
}
const stepWatch = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) playScene(e.target.dataset.scene);
}, { rootMargin: '-45% 0px -45% 0px' });
for (const step of $$('.step')) stepWatch.observe(step);
playScene('spaces');

// ---------- the studio ----------
const studio = mocks.studio;
const look = { preset: 'Violet', intensity: 60, accent: ACCENTS[0], mode: 'dark', layout: 'vertical', font: 'inter', row: 'default', loader: 'Aurora' };
const LAYOUT_TEXT = { vertical: 'Tabs down the side', horizontal: 'Tabs across the top', compact: 'Icon-only sidebar' };
const FONT_TEXT = { inter: 'Inter', serif: 'Serif', mono: 'Monospace' };

$('[data-control="preset"]').innerHTML = PRESETS.map((p) => `<button type="button" class="swatch" data-v="${p.name}" title="${p.name}"
  aria-label="${p.name}" style="background:${p.colors.length === 1 ? `linear-gradient(160deg, ${p.colors[0]}, ${p.colors[0]}99)` : `linear-gradient(160deg, ${p.colors.join(', ')})`}"><span>${p.name}</span></button>`).join('');
$('[data-control="accent"]').innerHTML = ACCENTS.map((c) => `<button type="button" class="dot" data-v="${c}" aria-label="Accent ${c}" style="background:${c}"></button>`).join('');
$('[data-control="loader"]').innerHTML = Object.entries(LOADERS).map(([name, c]) => `<button type="button" class="chip" data-v="${name}">
  <i style="background:${loaderBg(c)}"></i>${name}</button>`).join('');

function renderStudio(changed) {
  const pr = preset(look.preset);
  applyLook(studio, { ...look, colors: pr.colors, loader: LOADERS[look.loader] });
  for (const group of $$('[data-control]', $('#controls'))) {
    const key = group.dataset.control;
    for (const b of $$('[data-v]', group)) {
      const on = b.dataset.v === String(look[key]);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  $('#studio-summary').textContent = `${pr.name}, ${pr.colors.length === 1 ? 'solid color' : `${pr.colors.length}-color gradient`} · ${look.mode === 'dark' ? 'Dark' : 'Light'} · ${LAYOUT_TEXT[look.layout]} · ${FONT_TEXT[look.font]}`;
  if (changed) {
    setAmbient(pr.colors);
    document.documentElement.style.setProperty('--accent', look.accent);
  }
  if (changed === 'loader') playLoader(studio);
}

$('#controls').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  const group = b?.closest('[data-control]');
  if (!b || !group) return;
  look[group.dataset.control] = b.dataset.v;
  renderStudio(group.dataset.control);
});
$('[data-control="intensity"]').addEventListener('input', (e) => { look.intensity = Number(e.target.value); renderStudio('intensity'); });
$('#replay').addEventListener('click', () => playLoader(studio));
$('#shuffle').addEventListener('click', () => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  Object.assign(look, {
    preset: pick(PRESETS).name,
    accent: pick(ACCENTS),
    mode: pick(['dark', 'dark', 'light']),
    layout: pick(['vertical', 'horizontal', 'compact']),
    font: pick(['inter', 'serif', 'mono']),
    row: pick(['compact', 'default', 'roomy']),
    loader: pick(Object.keys(LOADERS)),
    intensity: pick([45, 60, 75, 90]),
  });
  $('[data-control="intensity"]').value = look.intensity;
  renderStudio('loader');
});
renderStudio();

// ---------- the credits and the supporting cast ----------
const KNOBS = [
  ['Space gradients', 'Accent color', 'Light or dark, per space', 'Tabs down the side', 'Tabs across the top', 'Compact sidebar', 'Hidden sidebar', 'Sidebar font', 'Any installed font', 'Tab height', 'Text size'],
  ['Essentials size', 'Glass tint', 'Acrylic or Mica', 'Three address bars', 'Loading colors', 'Your own color sets', 'Sidebar buttons', 'Waypoints bar', 'Own Essentials per space', 'Separate sign-ins', 'Every shortcut'],
];
for (const track of $$('[data-knobs]')) {
  const words = KNOBS[track.dataset.knobs].map((w) => `<span>${w}</span>`).join('');
  track.innerHTML = words + words; // twice, so the loop is seamless
}

const CARDS = [
  ['play', 'Movie night, sorted', 'Netflix, Disney+, Prime Video and other streaming services play right in Ultima.'],
  ['puzzle', 'Chrome extensions', 'Install them straight from the Chrome Web Store.'],
  ['ghost', 'Private windows and tabs', 'They leave nothing behind when you close them.'],
  ['key', 'Passwords', 'Saved on your computer, encrypted with your Windows account or Mac Keychain.'],
  ['eye', 'Accessibility', 'Page zoom, text size, contrast, color filters, caret browsing and reduced motion.'],
  ['gauge', 'Task manager', 'Press Shift+Esc to see what each tab uses and end the ones that misbehave.'],
  ['windows', 'More than one window', 'All sharing your spaces and Essentials, and everything comes back when you reopen.'],
  ['tear', 'Tear off tabs', 'Drag a tab out to give it a window of its own.'],
  ['swipe', 'Swipes', 'Two fingers sideways to go back, down past the top to reload.'],
  ['import', 'Bring your stuff', 'Bookmarks and history from Chrome, Edge, Brave, Vivaldi or Firefox in one click.'],
  ['pin', 'Waypoints', 'Your bookmarks, with a popup to name and file them as you add them.'],
  ['history', 'Tab History', 'Press and hold Back to jump to any page a tab has been through.'],
];
$('#cards').innerHTML = CARDS.map(([icon, title, text], i) => `<article class="card reveal" style="--d:${(i % 4) * 70}ms">
  <span class="card-ico">${ico(icon)}</span><h3>${title}</h3><p>${text}</p></article>`).join('');
for (const el of $$('#cards .reveal')) io.observe(el);

// cards catch the light where the pointer is
$('#cards').addEventListener('pointermove', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
});
