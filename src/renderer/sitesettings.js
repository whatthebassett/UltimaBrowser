// Site settings (definitions in sitepermissions.js, enforced in main.js): what each site may do, its cookies and
// stored data. Shown for the current site in the address bar menu and for every site in Settings → Site settings.
const SITE = { panel: null }; // the address bar menu's site view: { origin, record, defaults, cookies, reload }

const siteOrigin = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };
const siteHost = (origin) => { try { return new URL(origin).host; } catch { return origin; } };

const SITE_CHOICE = { allow: 'Allow', block: 'Block', ask: 'Ask' };
const choiceOf = (v) => (v === true ? 'allow' : v === false ? 'block' : 'ask');

// One permission's picker: the site's own choice, or "Default (…)" for whatever every site gets
function sitePicker(p, record, defaults, attrs) {
  const own = SITE_PERMS.storedFor(record, p.key);
  const fallback = SITE_CHOICE[choiceOf(SITE_PERMS.defaultFor(p.key, defaults))];
  const opt = (v, label) => `<option value="${v}" ${(own === undefined ? '' : choiceOf(own)) === v ? 'selected' : ''}>${label}</option>`;
  return `<select class="field site-pick" ${attrs}>${opt('', `${fallback} (default)`)}${opt('allow', 'Allow')}${opt('block', 'Block')}</select>`;
}

// The permission rows for one site (both places use these)
function siteRowsHtml(origin, record, defaults) {
  return SITE_PERMS.SITE_PERMISSIONS.map((p) => `<div class="site-row">
      <span class="site-ic">${icon(p.icon, 16)}</span>
      <span class="site-label">${esc(p.label)}</span>
      ${sitePicker(p, record, defaults, `data-site-key="${p.key}" data-origin="${esc(origin)}"`)}
    </div>`).join('');
}

// Applies a picker change; returns the definition, so callers can offer a reload where one is needed
async function changeSitePermission(origin, key, choice) {
  await window.ultima.siteSet({ origin, key, value: choice === 'allow' ? true : choice === 'block' ? false : null });
  if (key === 'sound') B.tabs.filter((t) => siteOrigin(t.url) === origin).forEach(applySiteSound);
  return SITE_PERMS.BY_KEY[key];
}

// ---------- sound: a site with its sound blocked stays muted in every tab ----------
async function applySiteSound(tab) {
  const origin = siteOrigin(tab.url);
  const site = origin ? await window.ultima.siteGet(origin) : null;
  tab.siteMuted = Boolean(site) && SITE_PERMS.effective(site.record, 'sound', site.defaults) === false;
  if (ready(tab)) tab.webview.setAudioMuted(Boolean(tab.muted || tab.siteMuted));
}

// ---------- the address bar menu's site view ----------
// The row at the top of the menu: the site, whether the connection is secure, and the way into its settings
function urlMenuSiteRow() {
  const tab = activeTab();
  const origin = siteOrigin(tab?.url);
  if (!origin) return '';
  const secure = origin.startsWith('https:');
  return `<button class="um-site" data-act="site">
      <span class="um-site-ic ${secure ? '' : 'warn'}">${icon(secure ? 'lock' : 'unlock', 16)}</span>
      <span class="um-site-text"><span class="um-site-host">${esc(siteHost(origin))}</span>
        <span class="um-site-sub">${secure ? 'Connection is secure' : 'Connection isn’t secure'} · Site settings</span></span>
      ${icon('forward', 14)}
    </button>`;
}

// ---------- clearing a site's cache, cookies and data, in every space ----------
const SITE_CLEAR = {
  cache: { what: { cache: true }, done: 'Cache' },
  cookies: {
    what: { cookies: true }, done: 'Cookies', ok: 'Delete cookies',
    title: (host) => `Delete cookies for ${host}?`, confirm: 'You’ll be signed out of it in every space.',
  },
  all: {
    what: { cache: true, cookies: true, storage: true }, done: 'Data', ok: 'Clear data',
    title: (host) => `Clear data for ${host}?`, confirm: 'You’ll be signed out of it in every space, and its cache and anything it saved on this computer are deleted.',
  },
};

// Asks first for cookies and everything (they sign you out); resolves whether it was cleared
async function clearSiteData(origin, kind) {
  const k = SITE_CLEAR[kind];
  if (k.confirm && !await confirmDialog(k.confirm, { title: k.title(siteHost(origin)), ok: k.ok, danger: true })) return false;
  await window.ultima.siteClearData({ origin, ...k.what });
  toast(`${k.done} for ${siteHost(origin)} cleared`);
  return true;
}

// From the site view: the menu closes (the reloading page takes focus, which would close it anyway) and the page
// reloads so it starts fresh. After clearing the cache it skips the page's in-memory copies too, which a plain reload
// would still use.
async function clearSiteFromPanel(kind) {
  const { origin } = SITE.panel;
  if (!await clearSiteData(origin, kind)) return;
  closeUrlMenu();
  const tab = activeTab();
  if (!ready(tab) || siteOrigin(tab.url) !== origin) return;
  if (SITE_CLEAR[kind].what.cache) tab.webview.reloadIgnoringCache();
  else tab.webview.reload();
}

async function openSitePanel() {
  const tab = activeTab();
  const origin = siteOrigin(tab?.url);
  if (!origin) return;
  const [site, data, blocking] = await Promise.all([window.ultima.siteGet(origin), window.ultima.siteData({ origin, partition: tab.webview?.partition }), window.ultima.blockerSite(tab.url)]);
  SITE.panel = {
    origin, record: site.record, defaults: site.defaults, cookies: data?.cookies ?? 0, blockingOff: blocking.off,
    reload: SITE.panel?.origin === origin && SITE.panel.reload,
  };
  renderUrlMenu();
}

function closeSitePanel() { SITE.panel = null; }

function sitePanelHtml() {
  const { origin, record, defaults, cookies, reload } = SITE.panel;
  const secure = origin.startsWith('https:');
  return `
    <div class="um-site-top">
      <button class="icon-btn" data-act="site-back" title="Back">${icon('back', 16)}</button>
      <span class="um-site-ic ${secure ? '' : 'warn'}">${icon(secure ? 'lock' : 'unlock', 16)}</span>
      <span class="um-site-text"><span class="um-site-host">${esc(siteHost(origin))}</span>
        <span class="um-site-sub">${secure ? 'Connection is secure' : 'Connection isn’t secure: don’t enter passwords or card details'}</span></span>
    </div>
    ${reload ? `<div class="site-reload">${icon('reload', 14)}<span>Reload the page to use the new settings</span><button class="btn small" data-act="site-reload">Reload</button></div>` : ''}
    ${siteBlockingHtml()}
    <div class="um-head">Cookies and site data</div>
    <div class="site-row">
      <span class="site-ic">${icon('cookie', 16)}</span>
      <span class="site-label">${cookies === 1 ? '1 cookie' : `${cookies} cookies`} in this space</span>
    </div>
    <div class="site-clear">
      <button class="btn small" data-act="site-clear-cache" title="Saved copies of its pages and images">Clear cache</button>
      <button class="btn small" data-act="site-clear-cookies" title="Signs you out of it in every space">Delete cookies</button>
      <button class="btn small danger" data-act="site-clear-all" title="Its cache, cookies and everything else it saved">Clear all data</button>
    </div>
    <div class="um-head">Permissions</div>
    <div class="site-rows">${siteRowsHtml(origin, record, defaults)}</div>
    <div class="site-foot">
      <button class="um-link" data-act="site-reset" ${Object.keys(record).length ? '' : 'disabled'}>${icon('eraser', 14)} Reset permissions</button>
      <button class="um-link" data-act="site-all">${icon('settings', 14)} All site settings</button>
    </div>`;
}

// clicks and picker changes inside the site view (called from the menu's own handlers)
async function onSitePanelAction(act) {
  const { origin } = SITE.panel;
  if (act === 'site-back') { closeSitePanel(); renderUrlMenu(); }
  else if (act === 'site-blocking') toggleSiteBlocking(); // blocking.js
  else if (act === 'site-blocking-settings') { closeUrlMenu(); openSettingsTab('privacy'); }
  else if (act === 'site-reload') { SITE.panel.reload = false; activeTab()?.webview?.reload(); renderUrlMenu(); }
  else if (act === 'site-reset') {
    await window.ultima.siteReset(origin);
    B.tabs.filter((t) => siteOrigin(t.url) === origin).forEach(applySiteSound);
    SITE.panel.reload = true;
    toast(`Permissions for ${siteHost(origin)} reset`);
    openSitePanel();
  } else if (act.startsWith('site-clear-')) clearSiteFromPanel(act.slice('site-clear-'.length));
  else if (act === 'site-all') { closeUrlMenu(); openSettingsTab('sites'); }
}

async function onSitePanelChange(select) {
  const p = await changeSitePermission(select.dataset.origin, select.dataset.siteKey, select.value);
  // permissions already granted, and JavaScript, images and pop-ups, take effect for pages loaded from now on
  if (p.reload || p.kind === 'ask' || p.key === 'popups') SITE.panel.reload = true;
  openSitePanel();
}

// ---------- Settings → Site settings ----------
function openSettingsTab(id) {
  const existing = B.tabs.find((t) => t.url.startsWith('ultima://settings'));
  if (existing) { existing.url = `ultima://settings#${id}`; activateTab(existing.id); rerenderIfShowing('settings'); }
  else createTab({ url: `ultima://settings#${id}` });
}

const summaryOf = (record) => SITE_PERMS.SITE_PERMISSIONS
  .map((p) => [p, SITE_PERMS.storedFor(record, p.key)])
  .filter(([, v]) => v !== undefined)
  .map(([p, v]) => `${p.label}: ${v ? 'Allow' : 'Block'}`)
  .join(' · ');

async function pageSiteSettings(el) {
  const open = new Set(); // sites expanded for editing
  let filter = '';

  const render = async () => {
    const { sites, defaults } = await window.ultima.siteList();
    const shown = sites.filter((s) => !filter || s.origin.toLowerCase().includes(filter)).sort((a, b) => siteHost(a.origin).localeCompare(siteHost(b.origin)));
    el.innerHTML = [
      sGroup('Default behavior', SITE_PERMS.SITE_PERMISSIONS.map((p) => sRow(
        `<span class="site-title">${icon(p.icon, 15)} ${esc(p.label)}</span>`,
        esc(p.note || (p.kind === 'ask' ? 'Sites ask before they can.' : '')),
        `<select class="field site-pick" data-site-default="${p.key}">${(p.kind === 'ask' ? [['ask', 'Ask'], ['block', 'Block']] : [['allow', 'Allow'], ['block', 'Block']])
          .map(([v, label]) => `<option value="${v}" ${choiceOf(SITE_PERMS.defaultFor(p.key, defaults)) === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`,
      ))),
      `<section class="s-group"><h3 class="s-group-title">Sites with their own settings</h3>
        ${sites.length > 6 ? `<label class="s-search site-filter">${icon('search', 14)}<input data-site-filter placeholder="Find a site" value="${esc(filter)}" spellcheck="false"></label>` : ''}
        <div class="s-card">${shown.length ? shown.map((s) => `
          <div class="site-entry ${open.has(s.origin) ? 'open' : ''}">
            <div class="s-row">
              <div class="s-text"><div class="s-title">${esc(siteHost(s.origin))}</div><div class="s-desc">${esc(summaryOf(s.record))}</div></div>
              <div class="s-control">
                <button class="btn" data-site-edit="${esc(s.origin)}">${open.has(s.origin) ? 'Done' : 'Edit'}</button>
                <button class="icon-btn" data-site-reset="${esc(s.origin)}" title="Reset permissions">${icon('trash', 15)}</button>
              </div>
            </div>
            ${open.has(s.origin) ? `<div class="site-rows site-edit">${siteRowsHtml(s.origin, s.record, defaults)}</div>` : ''}
          </div>`).join('') : sRow(sites.length ? 'No matching sites' : 'No sites yet', sites.length ? '' : 'When you allow or block something for a site, it shows up here.', '')}
        </div>
      </section>`,
      sites.length ? `<div class="s-actions"><button class="btn danger" data-site-reset-all>Reset all sites</button></div>` : '',
    ].join('');
    if (filter) { const input = $('[data-site-filter]', el); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }
  };

  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.siteDefault) { await window.ultima.siteDefault({ key: t.dataset.siteDefault, value: t.value === 'block' ? false : null }); B.tabs.forEach(applySiteSound); render(); }
    else if (t.dataset.siteKey) { await changeSitePermission(t.dataset.origin, t.dataset.siteKey, t.value); render(); }
  });
  el.addEventListener('input', (e) => { if (e.target.dataset.siteFilter !== undefined) { filter = e.target.value.trim().toLowerCase(); render(); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.siteEdit) { const o = b.dataset.siteEdit; if (open.has(o)) open.delete(o); else open.add(o); render(); }
    else if (b.dataset.siteReset) {
      await window.ultima.siteReset(b.dataset.siteReset);
      B.tabs.forEach(applySiteSound);
      toast(`Permissions for ${siteHost(b.dataset.siteReset)} reset`);
      render();
    } else if (b.hasAttribute('data-site-reset-all')) {
      if (!await confirmDialog('Every site goes back to the defaults above.', { title: 'Reset all sites?', ok: 'Reset', danger: true })) return;
      await window.ultima.resetPermissions();
      B.tabs.forEach(applySiteSound);
      toast('All site permissions reset');
      render();
    }
  });
  render();
}

function initSiteSettings() {
  window.ultima.on('popup-blocked', ({ origin, site }) => {
    toast(`Pop-up blocked on ${site}`, { label: 'Always allow', run: () => window.ultima.siteSet({ origin, key: 'popups', value: true }) });
  });
}
