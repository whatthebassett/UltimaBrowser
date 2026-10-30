// Sleeping tabs (Settings → General → Performance): a tab that has been in the background for longer than you chose
// goes to sleep, as if you had unloaded it, and gives its memory back. It loads again, on the page it was on, when you
// open it. Never the tab you're on (or the rest of its split view), one playing sound, one a glance is open over, or
// one being dragged. The clock starts when a tab leaves the front, or when its page opens in the background.
const SLEEP_AFTER = [[5, '5 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [45, '45 seconds'],
  [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes']];

function sleepTabsTick() {
  if (B.closing) return;
  const on = Boolean(B.settings.sleepTabs);
  const after = (Number(B.settings.sleepTabsAfter) || 900) * 1000;
  const now = Date.now();
  const cur = activeTab();
  const shown = cur?.splitId ? splitTabs(cur.splitId) : cur ? [cur] : [];
  let slept = false;
  for (const t of B.tabs) {
    // (never a private tab: private browsing ends, and its sign-ins with it, once no private page is open)
    if (!t.webview || t.private) { t.seenAt = undefined; continue; }
    // (sound, a glance or a drag keeps it awake, and its clock starts again once they end)
    if (!t.seenAt || shown.includes(t) || t.audible || GL.open?.source === t || TD.drag?.tab === t) { t.seenAt = now; continue; }
    if (!on || now - t.seenAt < after) continue; // (kept up to date while it's off, so turning it on is fair)
    dropWebview(t);
    t.seenAt = undefined;
    slept = true;
  }
  if (slept) renderTabs();
}

function initTabSleep() {
  setInterval(sleepTabsTick, 1000);
}
