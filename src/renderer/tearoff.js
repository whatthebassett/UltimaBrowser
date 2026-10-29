// The tear-off ghost (main/tearoff.js): the picture of the window a dragged tab will become. It pops up at the
// pointer when the tab leaves its window, follows it (leaning into the movement, like the tab's card), tucks away
// when the tab comes back, and on release grows into the new window's place and fades into it.
const $ = (id) => document.getElementById(id);
const mover = $('mover');
const tiltEl = $('tilt');
const pop = $('pop');
const card = $('card');
const CARD_W = 300;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const G = { setup: null, wantOut: false, out: false, phase: 'idle', pos: { x: 0, y: 0 }, prev: null, vx: 0, tilt: 0, size: null, hold: null, popAnim: null };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const still = () => Boolean(G.setup?.look?.still) || matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = (n) => (still() ? 1 : n);

function setup(s) {
  const wanted = G.wantOut; // the tab may have left its window before the picture was ready
  reset();
  G.setup = s;
  const look = s.look || {};
  for (const [k, v] of Object.entries({ surface: look.surface, text: look.text, accent: look.accent, edge: look.edge })) {
    if (typeof v === 'string' && v) document.body.style.setProperty(`--${k}`, v);
  }
  document.body.style.fontFamily = look.font || '';
  // the space's colors over this window's surface, as in the window the tab comes from
  card.style.background = typeof look.chrome === 'string' && look.chrome.length < 2000 ? `${look.chrome}, var(--surface)` : '';
  const w = CARD_W;
  const h = Math.round(clamp(w * s.ratio, 170, 320));
  G.size = { w, h };
  // the pointer holds the picture by its tab, where it held the tab
  G.hold = { x: clamp(Number(s.grip?.x) || 40, 22, w - 22), y: 18 };
  Object.assign(card.style, { width: `${w}px`, height: `${h}px` });
  document.body.style.setProperty('--hx', `${G.hold.x}px`);
  document.body.style.setProperty('--hy', `${G.hold.y}px`);

  const tab = $('tab');
  tab.replaceChildren();
  if (s.favicon) {
    const img = new Image();
    img.src = s.favicon;
    img.onerror = () => img.replaceWith(Object.assign(document.createElement('i'), { className: 'dot' }));
    tab.append(img);
  } else tab.append(Object.assign(document.createElement('i'), { className: 'dot' }));
  tab.append(Object.assign(document.createElement('span'), { textContent: s.title || 'New Tab' }));
  const page = $('page');
  page.replaceChildren();
  if (s.favicon) page.append(Object.assign(new Image(), { src: s.favicon, className: 'mark' }));

  G.phase = 'drag';
  place();
  requestAnimationFrame(frame);
  if (wanted) setOut(true);
}

function place() {
  mover.style.transform = `translate(${G.pos.x - G.hold.x}px, ${G.pos.y - G.hold.y}px)`;
}

// follows the pointer, leaning a little the way it moves
function frame() {
  if (G.phase !== 'drag') return;
  const dx = G.prev ? G.pos.x - G.prev.x : 0;
  G.prev = { ...G.pos };
  G.vx = G.vx * 0.6 + dx * 0.4;
  G.tilt += (clamp(G.vx * 0.5, -8, 8) - G.tilt) * 0.18;
  G.vx *= 0.85;
  place();
  tiltEl.style.transform = `rotate(${(still() ? 0 : G.tilt).toFixed(2)}deg)`;
  requestAnimationFrame(frame);
}

function popTo(on) {
  const from = getComputedStyle(pop);
  G.popAnim?.cancel();
  G.popAnim = pop.animate([
    { transform: from.transform === 'none' ? 'scale(1)' : from.transform, opacity: from.opacity },
    on ? { transform: 'scale(1)', opacity: 1 } : { transform: 'scale(0.55)', opacity: 0 },
  ], { duration: ms(on ? 280 : 150), easing: on ? 'cubic-bezier(0.34, 1.45, 0.64, 1)' : 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
  return G.popAnim.finished.catch(() => {});
}

function setOut(on) {
  G.wantOut = on;
  if (!G.setup || G.phase !== 'drag' || G.out === on) return;
  G.out = on;
  if (on) {
    mover.hidden = false;
    pop.style.transform = 'scale(0.55)';
    pop.style.opacity = '0';
  }
  popTo(on);
}

// Let go: the picture grows into the new window's place, the page settling where it will be there (beside the
// sidebar, under the toolbar) as the tab bar fades.
function open(rect) {
  if (!G.setup || !G.out) { finish(); return; }
  G.phase = 'open';
  const o = { duration: ms(260), easing: EASE, fill: 'forwards' };
  mover.animate([{ transform: mover.style.transform }, { transform: `translate(${rect.x}px, ${rect.y}px)` }], o);
  tiltEl.animate([{ transform: tiltEl.style.transform || 'none' }, { transform: 'rotate(0deg)' }], o);
  G.popAnim?.cancel();
  pop.style.transform = 'none';
  pop.style.opacity = '1';
  card.animate([
    { width: `${G.size.w}px`, height: `${G.size.h}px`, borderRadius: '12px' },
    { width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: '8px' },
  ], o);
  $('tab').parentElement.animate([{ height: '36px', opacity: 1 }, { height: '0px', opacity: 0 }], { ...o, duration: ms(180) });
  const px = (v) => `${Math.max(0, Math.min(400, Number(v) || 0))}px`;
  const i = G.setup.inset || {};
  $('page').animate([{ margin: '0px 6px 6px', borderRadius: '8px' }, { margin: `${px(i.t)} ${px(i.r)} ${px(i.b)} ${px(i.l)}`, borderRadius: '0px' }], o);
}

// the new window is showing underneath: fade away into it
function reveal() {
  if (G.phase !== 'open') { finish(); return; }
  card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(180), easing: 'ease', fill: 'forwards' }).finished.then(finish, finish);
}

function cancel() {
  if (G.phase === 'drag' && G.out) {
    G.phase = 'closing';
    popTo(false).then(finish);
  } else finish();
}

function finish() {
  reset();
  window.ghost.settled();
}

function reset() {
  G.phase = 'idle';
  G.setup = null;
  G.out = false;
  G.wantOut = false;
  G.prev = null;
  G.vx = 0;
  G.tilt = 0;
  mover.hidden = true;
  for (const el of [mover, tiltEl, pop, card, $('tab').parentElement, $('page')]) {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = '';
  }
}

window.ghost.on((m) => {
  if (m.type === 'pos') G.pos = { x: m.x, y: m.y };
  else if (m.type === 'setup') setup(m);
  else if (m.type === 'picture' && G.setup) $('page').replaceChildren(Object.assign(new Image(), { src: m.picture }));
  else if (m.type === 'out') setOut(m.on);
  else if (m.type === 'open') open(m.rect);
  else if (m.type === 'reveal') reveal();
  else if (m.type === 'cancel') cancel();
});
