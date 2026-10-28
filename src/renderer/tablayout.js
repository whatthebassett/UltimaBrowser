// Tab layout (Settings → Appearance → Tabs): tabs down the sidebar, or across the top. Horizontal tabs are a tab strip
// along the window's top edge (your spaces, Essentials, pinned tabs and their folders, then your tabs, folders and
// split views) with the address bar's row under it, as in Chrome. Rather than a second set of tabs, horizontal mode
// moves the sidebar's own parts into those two rows (and back for vertical), so everything they do (folders, pinned
// tabs, split views, dragging, every menu) works the same either way; styles.css lays them out (body.htabs) and
// tabdrag.js aims along the strip.
const TL = { mode: 'vertical', home: null };
const tabsAcross = () => TL.mode === 'horizontal';

// what goes where in horizontal mode
const TL_STRIP = ['#space-bar', '#essentials', '#pinned-list', '#sidebar .zone-sep', '#tabs', '#btn-newtab'];
const TL_TOOLBAR = ['#sidebar .nav', '#urlbar', '#topbar .top-actions', '#sidebar .sb-foot'];

// Called with every settings change (applyTheme): rearranges only when the layout changes. Switched while Ultima is open
// (not as it starts), the change slides: the bar that's there leaves, then the new one arrives (switchTabLayout).
function applyTabLayout() {
  const mode = B.settings.tabLayout === 'horizontal' ? 'horizontal' : 'vertical';
  if (mode === TL.mode || TL.busy) return;
  if (B.restored && !reducedMotion()) switchTabLayout(mode);
  else setTabLayout(mode);
}

function setTabLayout(mode) {
  TL.mode = mode;
  document.body.classList.toggle('htabs', mode === 'horizontal');
  if (mode === 'horizontal') {
    // where each part lives now, to put it back (each one's next sibling is the whitespace after it, which stays)
    TL.home = [...TL_STRIP, ...TL_TOOLBAR].map((sel) => { const el = $(sel); return { el, parent: el.parentElement, next: el.nextSibling }; });
    const strip = h('<div id="hstrip" class="hstrip drag"></div>');
    const bar = h('<div id="htoolbar" class="htoolbar"></div>');
    for (const sel of TL_STRIP) strip.append($(sel));
    for (const sel of TL_TOOLBAR) bar.append($(sel));
    $('#sidebar').prepend(strip, bar);
  } else {
    for (const { el, parent, next } of TL.home || []) parent.insertBefore(el, next);
    $('#hstrip')?.remove();
    $('#htoolbar')?.remove();
    TL.home = null;
  }
  if (B.restored) { renderTabs(); updateChrome(); } // (while Ultima starts, its own first render does this)
}

// ---------- the transition ----------
// To horizontal: the sidebar slides away to the left, then the tab strip and toolbar drop down from the top. To
// vertical: the bar slides up and away, then the sidebar slides in from the left. The page grows and shrinks with them
// (the bar slides by its margin, as when a hidden sidebar comes back: sidebarhide.js), so there's never a gap.
const TL_OUT_MS = 220;
const TL_IN_MS = 320;

function slideTabBar(dir, phase) {
  const side = $('#sidebar');
  const prop = dir === 'left' ? 'marginLeft' : 'marginTop';
  const away = `${-(dir === 'left' ? side.offsetWidth : side.offsetHeight)}px`;
  return side.animate(phase === 'out' ? [{ [prop]: '0px' }, { [prop]: away }] : [{ [prop]: away }, { [prop]: '0px' }], {
    duration: phase === 'out' ? TL_OUT_MS : TL_IN_MS,
    easing: phase === 'out' ? 'cubic-bezier(0.5, 0, 0.9, 0.4)' : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'forwards',
  });
}

async function switchTabLayout(mode) {
  TL.busy = true;
  document.body.classList.add('tl-switching'); // (nothing on the bar takes a click while it's moving)
  const leaving = slideTabBar(TL.mode === 'horizontal' ? 'up' : 'left', 'out');
  await leaving.finished.catch(() => {});
  setTabLayout(mode);
  applyTheme(); // what follows the layout (a compact sidebar is a vertical-tabs thing…)
  // in the same frame as the old slide lets go, so the new bar never shows before it arrives
  leaving.cancel();
  const arriving = slideTabBar(mode === 'horizontal' ? 'up' : 'left', 'in');
  await arriving.finished.catch(() => {});
  arriving.cancel();
  document.body.classList.remove('tl-switching');
  TL.busy = false;
  rerenderIfShowing('settings'); // (its layout cards, and its sidebar or toolbar options)
  applyTabLayout(); // (switched again while it was moving: on to that)
}

function toggleTabLayout() {
  const horizontal = !tabsAcross();
  applySettings({ tabLayout: horizontal ? 'horizontal' : 'vertical' });
  rerenderIfShowing('settings');
  toast(horizontal ? 'Horizontal tabs: your tabs are across the top' : 'Vertical tabs: your tabs are down the sidebar');
}

function initTabLayout() {
  // a mouse wheel scrolls the strip sideways (a trackpad already does)
  $('#tabs').addEventListener('wheel', (e) => {
    if (!tabsAcross() || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    $('#tabs').scrollLeft += e.deltaY;
  }, { passive: true });
}
