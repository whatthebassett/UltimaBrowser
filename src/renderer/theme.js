// Per-space themes (Arc-style): 1–3 colors that make a gradient across the sidebar and toolbar,
// with intensity, grain and an optional light/dark override. Edited in a floating panel with a color wheel.

const THEME_PRESETS = [
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
const MAX_THEME_COLORS = 3;

// ---------- color math ----------
function hexToHsl(hex) {
  let x = hex.replace('#', '').trim();
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(x)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  // kept unrounded so a typed hex color comes back out exactly
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }) {
  const sat = s / 100;
  const lig = l / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = lig - sat * Math.min(lig, 1 - lig) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const hslCss = (c, a = 1) => `hsl(${c.h} ${c.s}% ${c.l}% / ${a.toFixed(3)})`;

// ---------- model ----------
function defaultTheme(color = '#8b5cf6') {
  return { colors: [hexToHsl(color) || hexToHsl('#8b5cf6')], intensity: 55, grain: 0, mode: 'auto' };
}

// Spaces created before themes existed get one from their single color.
function spaceTheme(space) {
  if (!space.theme) space.theme = defaultTheme(space.color);
  return space.theme;
}

function themeBackground(t) {
  const a = t.intensity / 100;
  const c = t.colors;
  if (c.length === 1) return `linear-gradient(180deg, ${hslCss(c[0], a)}, ${hslCss(c[0], a * 0.45)})`;
  if (c.length === 2) return `linear-gradient(160deg, ${hslCss(c[0], a)}, ${hslCss(c[1], a)})`;
  // three colors: a soft mesh — one in each far corner over a diagonal blend through the middle color
  return [
    `radial-gradient(85% 55% at 0% 0%, ${hslCss(c[0], a)}, transparent 75%)`,
    `radial-gradient(85% 60% at 100% 100%, ${hslCss(c[2], a)}, transparent 75%)`,
    `linear-gradient(160deg, ${hslCss(c[0], a * 0.6)}, ${hslCss(c[1], a)} 50%, ${hslCss(c[2], a * 0.6)})`,
  ].join(', ');
}

const presetBackground = (p) => (p.colors.length === 1
  ? `linear-gradient(160deg, ${p.colors[0]}, ${p.colors[0]}99)`
  : `linear-gradient(160deg, ${p.colors.join(', ')})`);

// The space's own light/dark choice wins over the app setting.
function themeMode() {
  const m = activeSpace()?.theme?.mode;
  if (m === 'light' || m === 'dark') return m;
  return B.settings.theme === 'system' ? 'system' : B.settings.theme === 'light' ? 'light' : 'dark';
}
const effectiveDark = () => (themeMode() === 'system' ? B.systemDark : themeMode() === 'dark');

function applySpaceVars() {
  const space = activeSpace();
  if (!space) return;
  const t = spaceTheme(space);
  const root = document.documentElement;
  root.style.setProperty('--space', hslToHex(t.colors[0]));
  root.style.setProperty('--space-bg', themeBackground(t));
  root.style.setProperty('--space-grain', String(t.grain / 100));
  applyLoaderVars(); // "Space" loading colors follow the theme
}

// ---------- address bar loading animation ----------
const LOADER_THEMES = {
  space: { name: 'Space' },
  accent: { name: 'Accent' },
  aurora: { name: 'Aurora', colors: ['#22c55e', '#06b6d4', '#a855f7'] },
  sunset: { name: 'Sunset', colors: ['#f97316', '#ec4899', '#8b5cf6'] },
  ocean: { name: 'Ocean', colors: ['#1d4ed8', '#06b6d4', '#38bdf8'] },
  candy: { name: 'Candy', colors: ['#ec4899', '#a78bfa', '#38bdf8'] },
  rainbow: { name: 'Rainbow', colors: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'] },
  mono: { name: 'Mono', colors: ['#6b7280', '#f3f4f6', '#9ca3af'] },
  custom: { name: 'Custom' },
};
const CUSTOM_LOADER_DEFAULT = ['#f43f5e', '#f59e0b', '#8b5cf6'];

// Your own colors (2–5), from Settings → Address bar
function customLoaderColors() {
  const list = (B.settings.loadingCustom || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  return list.length >= 2 ? list.slice(0, 5) : CUSTOM_LOADER_DEFAULT;
}

// One color isn't much of a gradient, so spread it into a lighter and a deeper neighbor.
function spreadColor(hex) {
  const c = hexToHsl(hex) || hexToHsl('#8b5cf6');
  const clamp = (v) => Math.max(8, Math.min(92, v));
  return [hex, hslToHex({ h: (c.h + 24) % 360, s: c.s, l: clamp(c.l + 16) }), hslToHex({ h: (c.h + 336) % 360, s: c.s, l: clamp(c.l - 10) })];
}

function loaderColors(key) {
  if (key === 'accent') return spreadColor(B.settings.accent || '#8b5cf6');
  if (key === 'custom') return customLoaderColors();
  if (key === 'space' || !LOADER_THEMES[key]) {
    const space = activeSpace();
    const colors = space ? spaceTheme(space).colors.map(hslToHex) : ['#8b5cf6'];
    return colors.length === 1 ? spreadColor(colors[0]) : colors;
  }
  return LOADER_THEMES[key].colors;
}

// colors twice over, ending where they began, so sliding the strip by half loops seamlessly
const loaderBackground = (colors) => `linear-gradient(90deg, ${[...colors, ...colors, colors[0]].join(', ')})`;

function applyLoaderVars() {
  const root = document.documentElement;
  root.style.setProperty('--loader-bg', loaderBackground(loaderColors(B.settings.loadingTheme)));
  root.style.setProperty('--loader-opacity', root.dataset.theme === 'light' ? '0.5' : '0.6');
}

// Plays the animation for a moment so a new choice can be seen without loading a page.
function previewLoader() {
  const bar = $('#urlbar');
  bar.classList.add('loading');
  clearTimeout(previewLoader.timer);
  previewLoader.timer = setTimeout(() => { bar.classList.remove('loading'); updateChrome(); }, 1800);
}

// ---------- editor ----------
const TE = { el: null, space: null, sel: 0, before: null };
const WHEEL = 200; // px

function openThemeEditor(space = activeSpace()) {
  closeThemeEditor();
  if (space.id !== B.activeSpaceId) switchSpace(space.id);
  TE.space = space;
  TE.sel = 0;
  TE.before = JSON.parse(JSON.stringify(spaceTheme(space)));
  const el = h(`<div class="theme-editor" role="dialog" aria-label="Space theme" tabindex="-1">
    <div class="te-head"><span class="te-title"></span><button class="icon-btn" data-act="done" title="Close">${icon('close', 15)}</button></div>
    <div class="seg te-modes">
      <button data-mode="auto">Auto</button><button data-mode="light">${icon('sun', 13)}Light</button><button data-mode="dark">${icon('moon', 13)}Dark</button>
    </div>
    <div class="te-wheel"><div class="te-wheel-bg"></div><div class="te-dots"></div></div>
    <div class="te-row">
      <button class="icon-btn" data-act="add" title="Add a color">${icon('plus', 15)}</button>
      <button class="icon-btn" data-act="remove" title="Remove the selected color">${icon('minus', 15)}</button>
      <span class="te-count"></span>
      <span class="te-chip"></span>
      <input class="field te-hex" spellcheck="false" maxlength="7" aria-label="Hex color">
    </div>
    <label class="te-slider"><span>Lightness</span><input type="range" data-k="l" min="8" max="92"></label>
    <label class="te-slider"><span>Intensity</span><input type="range" data-k="intensity" min="0" max="100"></label>
    <label class="te-slider"><span>Grain</span><input type="range" data-k="grain" min="0" max="100"></label>
    <div class="te-presets">${THEME_PRESETS.map((p, i) => `<button class="te-preset" data-preset="${i}" title="${esc(p.name)}" style="background:${presetBackground(p)}"></button>`).join('')}</div>
    <div class="te-foot"><button class="btn" data-act="reset">Undo changes</button><button class="btn primary" data-act="done">Done</button></div>
  </div>`);
  document.body.append(el);
  TE.el = el;
  wireThemeEditor(el);
  renderThemeEditor();
  el.focus();
}

function closeThemeEditor() {
  if (!TE.el) return;
  TE.el.remove();
  TE.el = null;
  TE.space = null;
  saveSession();
}

function themeChanged() {
  const t = spaceTheme(TE.space);
  TE.space.color = hslToHex(t.colors[0]); // the space's chip and ring follow its first color
  refreshSettingsSpaceChip(TE.space);
  applyTheme();
  renderThemeEditor();
  renderSpaces();
  saveSession();
}

function dotPosition(c) {
  const r = (c.s / 100) * (WHEEL / 2);
  const a = (c.h * Math.PI) / 180;
  return { x: WHEEL / 2 + r * Math.sin(a), y: WHEEL / 2 - r * Math.cos(a) };
}

function renderThemeEditor() {
  const el = TE.el;
  if (!el) return;
  const t = spaceTheme(TE.space);
  TE.sel = Math.min(TE.sel, t.colors.length - 1);
  const cur = t.colors[TE.sel];
  $('.te-title', el).textContent = `${TE.space.icon}  ${TE.space.name} theme`;
  $$('.te-modes button', el).forEach((b) => b.classList.toggle('on', b.dataset.mode === t.mode));
  // the wheel shows hue around the edge and saturation toward the center, at the selected color's lightness
  const L = cur.l;
  const hues = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% ${L}%)`).join(', ');
  $('.te-wheel-bg', el).style.background = `radial-gradient(circle closest-side, hsl(0 0% ${L}%), hsl(0 0% ${L}% / 0)), conic-gradient(${hues})`;
  $('.te-dots', el).innerHTML = t.colors.map((c, i) => {
    const p = dotPosition(c);
    return `<span class="te-dot ${i === TE.sel ? 'sel' : ''}" data-dot="${i}" style="left:${p.x}px;top:${p.y}px;background:${hslToHex(c)}"></span>`;
  }).join('');
  $('.te-count', el).textContent = t.colors.length === 1 ? 'Solid' : `${t.colors.length} colors`;
  $('.te-chip', el).style.background = themeBackground({ ...t, intensity: 100 });
  const hex = $('.te-hex', el);
  if (document.activeElement !== hex) hex.value = hslToHex(cur);
  $('[data-act=add]', el).disabled = t.colors.length >= MAX_THEME_COLORS;
  $('[data-act=remove]', el).disabled = t.colors.length <= 1;
  $('[data-k=l]', el).value = cur.l;
  $('[data-k=intensity]', el).value = t.intensity;
  $('[data-k=grain]', el).value = t.grain;
}

function wireThemeEditor(el) {
  const t = () => spaceTheme(TE.space);

  // drag a dot (or click the wheel to move the selected one)
  const wheel = $('.te-wheel', el);
  const setFromPointer = (e) => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const c = t().colors[TE.sel];
    c.h = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
    c.s = Math.round(Math.min(1, Math.hypot(dx, dy) / (r.width / 2)) * 100);
    themeChanged();
  };
  wheel.addEventListener('pointerdown', (e) => {
    const dot = e.target.closest('.te-dot');
    if (dot) TE.sel = Number(dot.dataset.dot);
    wheel.setPointerCapture(e.pointerId);
    setFromPointer(e);
    const move = (ev) => setFromPointer(ev);
    const up = () => { wheel.removeEventListener('pointermove', move); wheel.removeEventListener('pointerup', up); };
    wheel.addEventListener('pointermove', move);
    wheel.addEventListener('pointerup', up);
  });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-mode], [data-preset]');
    if (!b) return;
    const theme = t();
    if (b.dataset.mode) theme.mode = b.dataset.mode;
    else if (b.dataset.preset) {
      theme.colors = THEME_PRESETS[Number(b.dataset.preset)].colors.map(hexToHsl);
      TE.sel = 0;
    } else if (b.dataset.act === 'add' && theme.colors.length < MAX_THEME_COLORS) {
      // a new color starts opposite the selected one on the wheel
      const c = theme.colors[TE.sel];
      theme.colors.push({ h: (c.h + 150) % 360, s: Math.max(55, c.s), l: c.l });
      TE.sel = theme.colors.length - 1;
    } else if (b.dataset.act === 'remove') return removeThemeColor();
    else if (b.dataset.act === 'reset') { TE.space.theme = JSON.parse(JSON.stringify(TE.before)); TE.sel = 0; }
    else if (b.dataset.act === 'done') return closeThemeEditor();
    return themeChanged();
  });

  el.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (k === 'l') t().colors[TE.sel].l = Number(e.target.value);
    else t()[k] = Number(e.target.value);
    themeChanged();
  });

  const hex = $('.te-hex', el);
  const commitHex = () => {
    const c = hexToHsl(hex.value);
    if (c) { t().colors[TE.sel] = c; themeChanged(); } else hex.value = hslToHex(t().colors[TE.sel]);
  };
  hex.addEventListener('change', commitHex);
  hex.addEventListener('keydown', (e) => { if (matchesKey(e, 'field.submit')) { e.preventDefault(); commitHex(); hex.blur(); } });

  el.addEventListener('keydown', (e) => {
    if (matchesKey(e, 'theme.close')) { e.preventDefault(); e.stopPropagation(); closeThemeEditor(); }
    else if (e.target.tagName !== 'INPUT' && matchesKey(e, 'theme.remove-color')) { e.preventDefault(); removeThemeColor(); }
  });
}

function removeThemeColor() {
  const theme = spaceTheme(TE.space);
  if (theme.colors.length <= 1) return;
  theme.colors.splice(TE.sel, 1);
  TE.sel = Math.max(0, TE.sel - 1);
  themeChanged();
}

// clicking anywhere else closes the editor (menus it opened don't count)
document.addEventListener('mousedown', (e) => {
  if (TE.el && !TE.el.contains(e.target) && !e.target.closest('.ctx-layer, .space-chip')) closeThemeEditor();
}, true);
