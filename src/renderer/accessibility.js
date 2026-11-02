// Accessibility (Settings → Accessibility). Applied as settings change, in every window:
//   pages:  default zoom (with each tab's own zoom on top); contrast, brightness, grayscale and inverted colors (a CSS
//           filter on every page's <webview>, so it works on any site and changes at once); corrections for color
//           blindness, a highlight on the focused item and underlined links (added to each page: a webview can't take
//           an SVG filter, so that one goes on the page's root element)
//   Ultima: higher contrast, a focus highlight, and reduced motion (also on while Windows' animations are off)
// Text size, minimum font size and caret browsing are set where pages are created (main.js).
// Browser sounds (experimental): a soft tick when you click or press something in Ultima (not in pages).
const A11Y = { css: null, base: null, audio: null };

const reducedMotion = () => Boolean(B.settings.reduceMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches;
// the default page zoom as a zoom level (Chromium's: each level is 20% more)
const baseZoomLevel = () => Math.log((Number(B.settings.pageZoom) || 100) / 100) / Math.log(1.2);

// Corrections for color blindness (daltonization): the colors a viewer can't tell apart (what the simulation matrix
// loses) are shifted into ones they can.
const CVD_SIMULATION = {
  protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
};
const CVD_SHIFT = [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]];
function daltonizeMatrix(sim) {
  // M = I + SHIFT · (I − SIM), as the 4×5 matrix feColorMatrix takes
  const rows = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c ? 1 : 0)
    + [0, 1, 2].reduce((sum, k) => sum + CVD_SHIFT[r][k] * ((k === c ? 1 : 0) - sim[k][c]), 0)));
  return [...rows.map((row) => [...row.map((v) => v.toFixed(4)), 0, 0].join(' ')), '0 0 0 1 0'].join(' ');
}

function pageFilter() {
  const s = B.settings;
  const parts = [];
  if ((Number(s.pageContrast) || 100) !== 100) parts.push(`contrast(${s.pageContrast / 100})`);
  if ((Number(s.pageBrightness) || 100) !== 100) parts.push(`brightness(${s.pageBrightness / 100})`);
  if (s.colorFilter === 'grayscale') parts.push('grayscale(1)');
  else if (s.colorFilter === 'invert') parts.push('invert(1) hue-rotate(180deg)'); // inverted, with colors keeping their hue
  return parts.join(' ') || 'none';
}

// the style sheet added to every page
function pageCss() {
  const s = B.settings;
  return [
    s.focusHighlight && `:focus-visible { outline: 3px solid ${s.accent} !important; outline-offset: 2px !important; box-shadow: 0 0 0 6px ${s.accent}55 !important; }`,
    s.underlineLinks && 'a[href] { text-decoration: underline !important; text-underline-offset: 2px !important; }',
    CVD_SIMULATION[s.colorFilter] && 'html { filter: url(#ultima-cvd) !important; }', // the filter pageScript adds
  ].filter(Boolean).join('\n');
}

// Puts the color blindness filter into the page (or takes it out), built with DOM calls so sites that only allow
// trusted HTML (Trusted Types) don't refuse it
function pageScript() {
  const sim = CVD_SIMULATION[B.settings.colorFilter];
  return `(() => {
    document.getElementById('ultima-cvd-svg')?.remove();
    const values = ${JSON.stringify(sim ? daltonizeMatrix(sim) : '')};
    if (!values) return;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'ultima-cvd-svg';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;pointer-events:none');
    const filter = document.createElementNS(NS, 'filter');
    filter.id = 'ultima-cvd';
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const matrix = document.createElementNS(NS, 'feColorMatrix');
    matrix.setAttribute('type', 'matrix');
    matrix.setAttribute('values', values);
    filter.append(matrix);
    svg.append(filter);
    document.documentElement.append(svg);
  })()`;
}

// Adds the style sheet and color filter to a page (again: each new document starts without them), replacing what
// was added before
async function applyPageCss(wv) {
  try {
    if (wv.a11yKey) { const old = wv.a11yKey; wv.a11yKey = null; await wv.removeInsertedCSS(old); }
    if (A11Y.css) wv.a11yKey = await wv.insertCSS(A11Y.css);
    const filter = A11Y.css.includes('ultima-cvd');
    if (filter || wv.a11yFilter) { wv.a11yFilter = filter; await wv.executeJavaScript(pageScript()); }
  } catch { /* not attached yet: its dom-ready adds it */ }
}
// a page finished loading a new document (tabs.js, glance.js): its zoom and style sheet
function pageReady(wv, tab = null) {
  wv.a11yKey = null;
  wv.a11yFilter = false;
  if (A11Y.css) applyPageCss(wv);
  const level = baseZoomLevel() + (tab?.zoom || 0);
  if (level) wv.setZoomLevel(level);
}

function applyAccessibility() {
  const s = B.settings;
  document.documentElement.style.setProperty('--page-filter', pageFilter());
  document.body.classList.toggle('a11y-contrast', Boolean(s.uiContrast));
  document.body.classList.toggle('a11y-focus', Boolean(s.focusHighlight));
  document.body.classList.toggle('reduce-motion', reducedMotion());
  const css = pageCss();
  if (css !== A11Y.css) {
    A11Y.css = css;
    for (const wv of $$('#viewport webview')) applyPageCss(wv);
  }
  // a new default zoom applies to open pages too, each keeping its own zoom on top
  const base = baseZoomLevel();
  if (A11Y.base !== null && base !== A11Y.base) for (const t of B.tabs) if (ready(t)) t.webview.setZoomLevel(base + t.zoom);
  A11Y.base = base;
}

// A short, quiet tick: a sine that drops in pitch and dies away in a few hundredths of a second
function tick() {
  try {
    if (!A11Y.audio) A11Y.audio = new AudioContext();
    const ctx = A11Y.audio;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.05);
  } catch { /* no audio device */ }
}
// what a tick is for: something you can click or press (or anything with a hand cursor), unless it's switched off
const TICK_TARGETS = 'button, a[href], select, summary, input[type="checkbox"], input[type="radio"], [role="button"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], [data-tab]';
function tickTarget(el) {
  if (!(el instanceof Element) || el.closest('webview')) return false;
  const hit = el.closest(TICK_TARGETS);
  if (hit ? hit.matches(':disabled, .disabled, [aria-disabled="true"]') : getComputedStyle(el).cursor !== 'pointer') return false;
  return true;
}

function initAccessibility() {
  // Browser sounds: a tick on press for the mouse, and on the click a key makes (Enter or Space on a button)
  document.addEventListener('pointerdown', (e) => { if (B.settings.browserSounds && e.button === 0 && tickTarget(e.target)) tick(); }, true);
  document.addEventListener('click', (e) => { if (B.settings.browserSounds && e.detail === 0 && tickTarget(e.target)) tick(); }, true);
  // Reduced motion: Ultima's own animations finish the moment they start (CSS ones are switched off in styles.css)
  const animate = Element.prototype.animate;
  Element.prototype.animate = function animateUnlessReduced(...args) {
    const a = animate.apply(this, args);
    if (document.body.classList.contains('reduce-motion')) a.finish();
    return a;
  };
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyAccessibility);
  applyAccessibility();
}
