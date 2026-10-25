// The colors of a tab's favicon, for the gradient outline an Essential gets on hover (--pin-ring, --pin-glow).
// Favicons come from other sites, so main fetches them as data: URLs a canvas can read. Results are cached per icon.
const FAV_RINGS = new Map(); // favicon src -> { ring, glow } once worked out (null: no usable colors)
const FAV_PENDING = new Map(); // favicon src -> Promise

// Up to 4 colors that stand out in the icon, in hue order starting after the widest gap round the color wheel (so
// the gradient flows from one to the next): pixels grouped into 15° hue buckets weighted by how vivid they are;
// whites, blacks and greys don't count (an icon with nothing else gets no colors).
function faviconPalette(px) {
  const bins = new Map();
  let opaque = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < 160) continue;
    opaque += 1;
    const r = px[i] / 255; const g = px[i + 1] / 255; const b = px[i + 2] / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (s < 0.25 || l < 0.12 || l > 0.92) continue;
    let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
    const key = Math.floor(h / 15);
    const bin = bins.get(key) || { w: 0, r: 0, g: 0, b: 0, h: 0 };
    const w = s * (a / 255);
    bin.w += w; bin.r += px[i] * w; bin.g += px[i + 1] * w; bin.b += px[i + 2] * w; bin.h += h * w;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()].sort((x, y) => y.w - x.w);
  const total = ranked.reduce((n, x) => n + x.w, 0);
  if (!ranked.length || total < opaque * 0.06) return []; // a black, white or grey icon
  const picked = [];
  for (const bin of ranked) {
    if (picked.length === 4 || bin.w < ranked[0].w * 0.12) break;
    const hue = bin.h / bin.w;
    if (picked.some((p) => Math.min(Math.abs(p.hue - hue), 360 - Math.abs(p.hue - hue)) < 30)) continue;
    picked.push({ hue, rgb: [bin.r, bin.g, bin.b].map((c) => Math.round(c / bin.w)) });
  }
  picked.sort((x, y) => x.hue - y.hue);
  let start = 0;
  let widest = -1;
  picked.forEach((p, i) => {
    const gap = (p.hue - picked[(i + picked.length - 1) % picked.length].hue + 360) % 360 || 360;
    if (gap > widest) { widest = gap; start = i; }
  });
  return [...picked.slice(start), ...picked.slice(0, start)].map((p) => p.rgb);
}

const rgbCss = ([r, g, b], alpha = 1) => (alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`);

function ringFromColors(colors) {
  if (!colors.length) return null;
  // one color: run it into a lighter shade of itself so it still reads as a gradient
  const stops = colors.length === 1
    ? [rgbCss(colors[0]), rgbCss(colors[0].map((c) => Math.round(c + (255 - c) * 0.45))), rgbCss(colors[0])]
    : colors.map((c) => rgbCss(c));
  return { ring: `linear-gradient(135deg, ${stops.join(', ')})`, glow: rgbCss(colors[0], 0.55) };
}

function readFaviconColors(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve(faviconPalette(ctx.getImageData(0, 0, 32, 32).data));
      } catch { resolve([]); }
    };
    img.onerror = () => resolve([]);
    img.src = src;
  });
}

async function faviconRing(src) {
  if (FAV_RINGS.has(src)) return FAV_RINGS.get(src);
  if (!FAV_PENDING.has(src)) {
    FAV_PENDING.set(src, (async () => {
      const data = src.startsWith('data:') ? src : await window.ultima.faviconData(src);
      const ring = data ? ringFromColors(await readFaviconColors(data)) : null;
      FAV_RINGS.set(src, ring);
      FAV_PENDING.delete(src);
      return ring;
    })());
  }
  return FAV_PENDING.get(src);
}

// The ring for a tab right now: its favicon's colors when known, the letter icon's color, or the accent for
// Ultima's own pages. Null while a favicon is still being read (pinRingStyle asks for it in the meantime).
function tabRing(t) {
  if (isInternal(t.url)) return { ring: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, white))', glow: 'color-mix(in srgb, var(--accent) 55%, transparent)' };
  if (!t.favicon) {
    const c = letterColor(hostname(t.url) || t.title || '?');
    return { ring: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 50%, white))`, glow: `color-mix(in srgb, ${c} 55%, transparent)` };
  }
  return FAV_RINGS.get(t.favicon) ?? null;
}

// The ring is brightest right where the pointer is: --mx/--my place that spotlight (styles.css) under it, 1:1.
function initPinRings() {
  $('#essentials').addEventListener('pointermove', (e) => {
    const pin = e.target.closest('.pin');
    if (!pin) return;
    const r = pin.getBoundingClientRect();
    pin.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(1)}px`);
    pin.style.setProperty('--my', `${(e.clientY - r.top).toFixed(1)}px`);
  });
}

// style="" for an Essential: the ring when known; otherwise it's worked out and put on the tile when ready
function pinRingStyle(t) {
  const r = tabRing(t);
  if (r) return `style="--pin-ring:${esc(r.ring)};--pin-glow:${esc(r.glow)}"`;
  if (t.favicon && !FAV_RINGS.has(t.favicon)) {
    faviconRing(t.favicon).then((ring) => {
      const el = ring && $(`#essentials .pin[data-tab="${t.id}"]`);
      if (el && tabById(t.id)?.favicon === t.favicon) { el.style.setProperty('--pin-ring', ring.ring); el.style.setProperty('--pin-glow', ring.glow); }
    });
  }
  return '';
}
