// The ad and tracker blocker in the UI (the engine and its lists are main/blocker.js): the shield on the address bar
// with how much it blocked on the page, the switch for a site in its settings, and the rows in Settings → Privacy.
B.blocker = null; // the lists' status from main: { rules, updating, lists: [{ id, name, what, updated, error }] }

const blockingOn = () => B.settings.blockAds !== false || B.settings.blockTrackers !== false;
// Off on a site you turned it off for, and on its subdomains (main decides the same way)
function blockingOffHere(url) {
  for (let h = hostname(url); h; h = h.includes('.') ? h.slice(h.indexOf('.') + 1) : '') if (B.settings.blockingOff?.[h]) return true;
  return false;
}
// The shield while blocking: filled with a gradient of the accent, with a checkmark in white or black, whichever
// reads on the accent (--on-accent, set in applyTheme)
let shieldIds = 0;
function shieldOnIcon(size) {
  const id = `shield-grad-${shieldIds += 1}`;
  const shape = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';
  return `<svg class="ic shield-on" width="${size}" height="${size}" viewBox="0 0 24 24">
    <defs><linearGradient id="${id}" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" style="stop-color: color-mix(in srgb, var(--accent) 62%, #fff)"/>
      <stop offset="1" style="stop-color: color-mix(in srgb, var(--accent) 78%, #000)"/>
    </linearGradient></defs>
    <path d="${shape}" fill="url(#${id})" stroke="url(#${id})" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8.6 12.1l2.4 2.4 4.5-4.8" fill="none" stroke="var(--on-accent, #fff)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
const blockedText = (n) => (n === 1 ? '1 ad or tracker blocked' : `${n} ads and trackers blocked`);

// ---------- the shield on the address bar ----------
function updateShield() {
  const tab = activeTab();
  const btn = $('#btn-shield');
  btn.hidden = !tab || !/^https?:/.test(tab.url) || !blockingOn();
  if (btn.hidden) return;
  const off = blockingOffHere(tab.url);
  const n = off ? 0 : tab.blocked || 0;
  btn.classList.toggle('off', off);
  btn.innerHTML = (off ? icon('shield-off', 14) : shieldOnIcon(16)) + (n ? `<span class="url-shield-n">${n > 99 ? '99+' : n}</span>` : '');
  btn.title = off ? `Ads and trackers aren’t blocked on ${hostname(tab.url)}` : n ? `${blockedText(n)} on this page` : 'Blocking ads and trackers';
}

// the shield opens the site's settings, where blocking can be turned off for it
function toggleShieldPanel() {
  if (EXT.menu) { closeUrlMenu(); return; }
  openUrlMenu();
  openSitePanel();
}

// ---------- the site's settings (address bar menu) ----------
function siteBlockingHtml() {
  if (!blockingOn()) {
    return `<div class="um-head">Ads and trackers</div>
      <div class="site-row"><span class="site-ic">${icon('shield-off', 16)}</span>
        <span class="site-label">Blocking is turned off in Settings</span>
        <button class="btn small" data-act="site-blocking-settings">Settings</button></div>`;
  }
  const off = SITE.panel.blockingOff;
  const n = activeTab()?.blocked || 0;
  return `<div class="um-head">Ads and trackers</div>
    <div class="site-row">
      <span class="site-ic">${off ? icon('shield-off', 16) : shieldOnIcon(18)}</span>
      <span class="site-label">Block ads and trackers<span class="site-sub" id="site-blocked">${off ? 'Off on this site' : `${blockedText(n)} on this page`}</span></span>
      <button class="switch ${off ? '' : 'on'}" data-act="site-blocking" role="switch" aria-checked="${!off}" title="${off ? 'Turn on for this site' : 'Turn off for this site'}"></button>
    </div>`;
}

async function toggleSiteBlocking() {
  const off = !SITE.panel.blockingOff;
  await window.ultima.blockerSetSite({ url: activeTab().url, off });
  SITE.panel.blockingOff = off;
  SITE.panel.reload = true; // pages load anew with or without blocking
  renderUrlMenu();
}

// ---------- Settings → Privacy ----------
function blockerSettingsGroups() {
  const st = B.blocker;
  const lists = st?.lists || [];
  const fetched = lists.length && lists.every((l) => l.updated);
  const oldest = Math.min(...lists.map((l) => l.updated));
  const failed = lists.some((l) => l.error);
  const listsDesc = st?.updating ? 'Updating…'
    : fetched ? `${st.rules.toLocaleString()} rules, updated ${timeAgo(oldest)}.${failed ? ' The last update failed.' : ''}`
      : `Some lists ${failed ? 'couldn’t be downloaded' : 'haven’t downloaded yet'}.`;
  const off = Object.keys(B.settings.blockingOff || {}).sort();
  return [
    sGroup('Ads and trackers', [
      sRow('Block ads', 'Hide ads on web pages.', sSwitch('blockAds')),
      sRow('Block trackers', 'Stop sites from following you around the web.', sSwitch('blockTrackers')),
      sRow('Filter lists', esc(listsDesc), `<button class="btn" data-blocker-update ${st?.updating ? 'disabled' : ''}>${icon('reload', 14)} Update now</button>`),
    ]),
    off.length ? sGroup('Sites where blocking is off', off.map((host) => sRow(esc(host), '', `<button class="btn" data-blocking-on="${esc(host)}">Turn on</button>`))) : '',
    sGroup('Tracking protection', [
      sRow('Remove tracking from links', 'Strip tracking codes from links you open.', sSwitch('cleanLinks')),
      sRow('Ask sites not to sell or share my data', 'Sends Global Privacy Control to every site.', sSwitch('globalPrivacyControl')),
      sRow('Block third-party cookies', 'Some sign-ins and embedded videos may stop working.', sSwitch('blockThirdPartyCookies')),
    ]),
  ].join('');
}

async function refreshBlockerStatus() {
  B.blocker = await window.ultima.blockerStatus();
  rerenderIfShowing('settings');
}

async function updateBlockerLists() {
  B.blocker = { ...B.blocker, updating: true };
  rerenderIfShowing('settings');
  B.blocker = await window.ultima.blockerUpdate();
  rerenderIfShowing('settings');
  toast(B.blocker.lists.some((l) => l.error) ? 'Couldn’t update the filter lists' : 'Filter lists updated');
}

function initBlocking() {
  $('#btn-shield').addEventListener('click', (e) => { e.stopPropagation(); toggleShieldPanel(); });
  // how many requests were blocked on a tab's page so far (counted again from 0 as each page loads)
  window.ultima.on('blocked-count', ({ webContentsId, count }) => {
    const tab = B.tabs.find((t) => ready(t) && t.webview.getWebContentsId() === webContentsId);
    if (!tab) return;
    tab.blocked = count;
    if (tab !== activeTab()) return;
    updateShield();
    const sub = SITE.panel && !SITE.panel.blockingOff && $('#site-blocked');
    if (sub) sub.textContent = `${blockedText(count)} on this page`;
  });
  window.ultima.on('blocker-changed', refreshBlockerStatus);
  refreshBlockerStatus();
}
