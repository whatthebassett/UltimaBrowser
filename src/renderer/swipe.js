// Two-finger touchpad swipes on a page (webview-preload.js notices them): sideways past its edge goes back or forward,
// and down past its top reloads it. A round sign comes in from that edge as you swipe, and fills in once letting go
// will do it.
const SW = { hint: null, tab: null, kind: null, timer: null };
const SWIPE_GO = { back: 200, forward: 200, reload: 180 }; // how far (in scrolled pixels) a swipe goes to count

function onPageSwipe(tab, { kind, amount, done }) {
  const wv = tab.webview;
  if (!SWIPE_GO[kind] || !wv) return;
  // nowhere to go, or not on screen: nothing to show
  const can = kind === 'back' ? wv.canGoBack() : kind === 'forward' ? wv.canGoForward() : true;
  if (!can || wv.classList.contains('hidden')) { if (done) hideSwipe(false); return; }
  const p = Math.max(0, Number(amount) || 0) / SWIPE_GO[kind];
  if (!done) { showSwipe(tab, kind, p); return; }
  const go = p >= 1 && SW.tab === tab;
  hideSwipe(go);
  if (!go) return;
  if (kind === 'back') wv.goBack();
  else if (kind === 'forward') wv.goForward();
  else wv.reload();
}

// The sign at `p` of the way (1: letting go now does it). Past that it only creeps on, as if held back.
function showSwipe(tab, kind, p) {
  if (SW.hint && (SW.kind !== kind || SW.tab !== tab)) hideSwipe(false, true);
  if (!SW.hint) {
    SW.hint = h(`<div class="swipe-hint ${kind}">${icon(kind, 20)}</div>`);
    document.body.append(SW.hint);
    Object.assign(SW, { tab, kind });
  }
  const el = SW.hint;
  const r = tab.webview.getBoundingClientRect();
  const t = Math.min(p, 1);
  const reach = t + Math.min(Math.max(0, p - 1), 0.8) * 0.2;
  const x = kind === 'reload' ? r.left + r.width / 2 - 22 : kind === 'back' ? r.left - 44 + reach * 84 : r.right - reach * 84;
  const y = kind === 'reload' ? r.top - 44 + reach * 92 : r.top + r.height / 2 - 22;
  el.style.translate = `${x}px ${y}px`; // (not transform: `scale` would shrink the move with the sign)
  el.style.opacity = String(Math.min(1, t * 2.5));
  el.style.scale = String(0.6 + 0.4 * t);
  if (kind === 'reload') $('svg', el).style.rotate = `${Math.round(p * 300)}deg`;
  el.classList.toggle('ready', p >= 1);
  // (should the page go away mid-swipe, the sign doesn't stay behind)
  clearTimeout(SW.timer);
  SW.timer = setTimeout(() => hideSwipe(false), 1500);
}

// The swipe ended: the sign pops and fades if it went, or shrinks away if not.
function hideSwipe(went, instant = false) {
  const el = SW.hint;
  clearTimeout(SW.timer);
  Object.assign(SW, { hint: null, tab: null, kind: null });
  if (!el) return;
  if (instant) { el.remove(); return; }
  el.style.opacity = '';
  el.style.scale = '';
  el.classList.add(went ? 'went' : 'gone');
  setTimeout(() => el.remove(), 280);
}
