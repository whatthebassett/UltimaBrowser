// Hidden sidebar: the page gets the whole window, and the sidebar slides in over it while the pointer is at the
// window's left edge (a thin strip there stays above the page to notice), then slides away once the pointer leaves —
// unless something started from the sidebar still needs it (a menu, a rename, a tab being dragged…).
const SBH = { timer: null };
// (hidden by the setting, which is for vertical tabs, or by F11's full screen: app.js; with horizontal tabs the bars
// then slide down from the top edge instead: styles.css)
const sidebarHidden = () => Boolean(B.immersive || (B.settings.sidebarHidden && !tabsAcross()));
const sidebarPeeking = () => document.body.classList.contains('sb-peek');

function sidebarPeek(on) {
  clearTimeout(SBH.timer);
  document.body.classList.toggle('sb-peek', Boolean(on) && sidebarHidden());
}

function sidebarBusy() {
  return Boolean(OV.menu || OV.dialog || B.renaming || EXT.menu || TH.panel || $('.space-name-input, .theme-editor, .ext-popup'))
    || document.body.classList.contains('tab-dragging') || document.body.classList.contains('sb-resizing') || $('#sidebar').matches(':hover');
}

// slides it away after a moment, or once nothing needs it any more
function sidebarLeave(delay = 300) {
  clearTimeout(SBH.timer);
  SBH.timer = setTimeout(function check() {
    if (!sidebarPeeking()) return;
    if (sidebarBusy()) { SBH.timer = setTimeout(check, 250); return; }
    sidebarPeek(false);
  }, delay);
}

// Back in its place beside the page: it slides in from the window's left edge, the page narrowing alongside it.
function slideSidebarIn() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const sb = $('#sidebar');
  clearTimeout(slideSidebarIn.timer);
  sb.style.transition = 'none';
  sb.style.marginLeft = `${-sb.offsetWidth}px`;
  void sb.offsetWidth;
  sb.style.transition = 'margin-left 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)';
  sb.style.marginLeft = '0px';
  slideSidebarIn.timer = setTimeout(() => { sb.style.transition = ''; sb.style.marginLeft = ''; }, 320);
}

// for commands that need the sidebar on screen (renaming a tab or a space from the keyboard)
function sidebarShowForCommand() {
  if (!sidebarHidden()) return;
  sidebarPeek(true);
  sidebarLeave(800);
}

function toggleSidebarHidden() {
  if (tabsAcross()) { toast('Hiding the sidebar is for vertical tabs'); return; }
  const hidden = !B.settings.sidebarHidden;
  applySettings({ sidebarHidden: hidden });
  rerenderIfShowing('settings');
  const key = keyText('toggle-sidebar-hidden');
  if (hidden) toast(`Sidebar hidden — point at the left edge of the window to show it${key ? `, or press ${key}` : ''}`);
}

function initSidebarHide() {
  $('#sb-hotzone').addEventListener('mouseenter', () => { sidebarPeek(true); sidebarLeave(700); });
  $('#sidebar').addEventListener('mouseleave', () => { if (sidebarPeeking()) sidebarLeave(); });
  // a click elsewhere in Ultima's own UI puts it away at once (clicks on the page itself go to the page)
  document.addEventListener('mousedown', (e) => {
    if (sidebarPeeking() && !e.target.closest('#sidebar, #sb-hotzone, .ctx-layer, .dd-layer, .url-menu, .tab-history, .ext-popup, .theme-editor, .dlg-backdrop')) sidebarLeave(0);
  }, true);
}
