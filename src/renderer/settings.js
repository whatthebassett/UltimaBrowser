// ultima://settings#<tab> — tabbed settings with a left-hand list of tabs and search across all of them.
const ACCENTS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#a3a3a3'];

// ---------- building blocks ----------
const sRow = (title, desc, control, extra = '') => `<div class="s-row" ${extra}>
    <div class="s-text"><div class="s-title">${title}</div>${desc ? `<div class="s-desc">${desc}</div>` : ''}</div>
    <div class="s-control">${control}</div></div>`;
const sGroup = (title, rows) => `<section class="s-group">${title ? `<h3 class="s-group-title">${esc(title)}</h3>` : ''}
    <div class="s-card">${rows.filter(Boolean).join('')}</div></section>`;
const sSwitch = (key) => `<button class="switch ${B.settings[key] !== false && B.settings[key] ? 'on' : ''}" data-switch="${key}" role="switch" aria-checked="${Boolean(B.settings[key])}"></button>`;
const sSeg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, label, ic]) => `<button data-v="${v}" class="${B.settings[key] === v ? 'on' : ''}">${ic ? icon(ic, 14) : ''}${label}</button>`).join('')}</div>`;

// ---------- default browser ----------
// B.defaultBrowser: { isDefault } once asked; asked again whenever Ultima gets focus back (e.g. from Windows Settings)
async function refreshDefaultBrowser() {
  const before = B.defaultBrowser?.isDefault;
  B.defaultBrowser = await window.ultima.defaultBrowserStatus();
  if (B.defaultBrowser.isDefault !== before) rerenderIfShowing('settings');
}

async function makeDefaultBrowser() {
  const r = await window.ultima.makeDefaultBrowser();
  if (r.isDefault) toast('Ultima is your default browser');
  else if (r.openedSettings) toast('Windows Settings is open — click “Set default” for Ultima Browser there');
  else toast('Couldn’t make Ultima the default browser');
  refreshDefaultBrowser();
}

function defaultBrowserRow() {
  if (!B.defaultBrowser) refreshDefaultBrowser();
  const d = B.defaultBrowser;
  return sRow('Default browser',
    d?.isDefault ? 'Links you open from other apps, like email and chat, open in Ultima.' : 'Make Ultima open the links you click in other apps, like email and chat.',
    !d ? '<span class="s-value">Checking…</span>'
      : d.isDefault ? `<span class="s-value s-ok">${icon('check', 14)} Ultima is your default browser</span>`
        : `<button class="btn primary" data-run="make-default-browser">Make default</button>`);
}

// ---------- light / dark mode ----------
// A space's own Light or Dark (its theme editor) wins over this setting, which would otherwise look like a dead control.
const MODE_NAMES = { light: 'Light', dark: 'Dark' };
const modeOverride = () => { const sp = activeSpace(); return MODE_NAMES[sp?.theme?.mode] ? sp : null; };

function modeRow() {
  const sp = modeOverride();
  return sRow('Mode', sp
    ? `<span class="s-warn">${esc(sp.icon)} ${esc(sp.name)} uses its own ${MODE_NAMES[sp.theme.mode]} mode, so this doesn’t change it.</span> Spaces set to Auto in their theme follow this.`
    : 'Each space can override this with its own light or dark mode in its theme.',
  `${sp ? `<button class="btn" data-space-follow="${esc(sp.id)}">Follow this setting</button>` : ''}${sSeg('theme', [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System']])}`);
}

// the space goes back to Auto, so it follows the app's mode again
function followAppMode(sp) {
  spaceTheme(sp).mode = 'auto';
  applyTheme();
  renderSpaces();
  saveSession();
  toast(`${sp.name} now follows the app’s mode`);
  rerenderIfShowing('settings');
}

// ---------- downloads ----------
// B.downloadDir: { dir, isDefault, missing? } from the main process, which owns the folder (it saves the choice)
async function refreshDownloadDir() {
  B.downloadDir = await window.ultima.downloadDir();
  rerenderIfShowing('settings');
}

async function chooseDownloadDir() {
  const r = await window.ultima.chooseDownloadDir(); // the system folder picker
  if (!r) return;
  B.downloadDir = r;
  toast('Downloads will go to the new folder');
  rerenderIfShowing('settings');
}

async function resetDownloadDir() {
  B.downloadDir = await window.ultima.resetDownloadDir();
  toast('Downloads will go to your Downloads folder');
  rerenderIfShowing('settings');
}

function downloadRows() {
  if (!B.downloadDir) refreshDownloadDir();
  const d = B.downloadDir;
  const where = !d ? 'Checking…'
    : d.missing ? `“${esc(d.missing)}” isn’t available, so downloads go to ${esc(d.dir)} for now.`
      : esc(d.dir);
  return [
    sRow('Location', `<span class="s-path" title="${esc(d?.dir || '')}">${where}</span>`,
      `${d && (!d.isDefault || d.missing) ? '<button class="btn" data-dl-reset>Use Downloads folder</button>' : ''}<button class="btn" data-dl-choose>${icon('folder', 14)} Change…</button>`),
    sRow('Ask where to save each file', 'Pick the folder and file name every time you download something.', sSwitch('askWhereToSave')),
  ];
}

// ---------- tabs ----------
const SETTINGS_TABS = [
  {
    id: 'general', title: 'General', icon: 'settings', desc: 'Default browser, startup, downloads and search.',
    render: () => [
      sGroup('Default browser', [defaultBrowserRow()]),
      sGroup('Startup', [
        sRow('Restore tabs from last time', 'Tabs come back unloaded and load when you open them.', sSwitch('restoreSession')),
      ]),
      sGroup('Downloads', downloadRows()),
      sGroup('Search', [
        sRow('Search engine', 'Used by the Control Palette and the new tab page.',
          `<select class="field" data-setting="searchEngine">${Object.entries(SEARCH_ENGINES).map(([k, e]) => `<option value="${k}" ${B.settings.searchEngine === k ? 'selected' : ''}>${e.name}</option>`).join('')}</select>`),
      ]),
    ].join(''),
  },
  {
    id: 'appearance', title: 'Appearance', icon: 'sun', desc: 'How Ultima looks.',
    render: () => {
      const s = B.settings;
      return [
        sGroup('Theme', [
          modeRow(),
          sRow('Accent color', 'Buttons, highlights and selections.', `<div class="swatches">${ACCENTS.map((c) => `<button class="swatch ${s.accent === c ? 'on' : ''}" data-accent="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`),
        ]),
        B.backdrops ? sGroup('Window', [
          sRow('Window material', 'Acrylic shows a frosted blur of whatever is behind the window. Mica tints it with your wallpaper.', sSeg('windowMaterial', [['acrylic', 'Acrylic'], ['mica', 'Mica']])),
          s.windowMaterial === 'acrylic' ? sRow('Glass tint', 'How smoky the see-through sidebar is. Raise it if bright windows behind Ultima glare through.',
            `<input type="range" data-setting="glassTint" data-number min="0" max="90" step="5" value="${s.glassTint ?? 45}">`) : '',
        ]) : '',
        sGroup('Bookmarks bar', [
          sRow('Show bookmarks bar', `Your bookmarks and folders under the toolbar, as in Chrome. The star adds pages to it.${keyText('toggle-bookmarks-bar') ? ` Toggle it with ${esc(keyText('toggle-bookmarks-bar'))}.` : ''}`, sSwitch('showBookmarksBar')),
          sRow('Center bookmarks', 'Lines up the bar’s bookmarks in the middle instead of on the left.', sSwitch('centerBookmarksBar')),
          sRow('Import a bookmarks bar', 'Copies the bookmarks and folders on the bar of Chrome, Edge, Brave or Vivaldi onto Ultima’s.',
            `<button class="btn" data-run="import-bookmarks-bar">${icon('import', 14)} Import…</button>`),
        ]),
        sGroup('Sidebar', [
          sRow('Essentials size', 'How tall the Essentials tiles at the top of the sidebar are. They always share the sidebar’s width, up to 4 a row.',
            `<input type="range" data-setting="essentialsHeight" data-number min="36" max="72" step="4" value="${s.essentialsHeight ?? 44}">`),
          sRow('Compact sidebar', `Show only icons.${keyText('toggle-sidebar') ? ` Toggle any time with ${esc(keyText('toggle-sidebar'))}.` : ''}`, sSwitch('sidebarCollapsed')),
          sRow('Hide sidebar', `The page uses the whole window. Point at the left edge of the window to slide the sidebar in.${keyText('toggle-sidebar-hidden') ? ` Toggle any time with ${esc(keyText('toggle-sidebar-hidden'))}.` : ''}`, sSwitch('sidebarHidden')),
        ]),
      ].join('');
    },
  },
  {
    id: 'spaces', title: 'Spaces', icon: 'layers', desc: 'Your spaces, their themes and their sign-ins.',
    render: () => [
      sGroup('', B.spaces.map((sp) => sRow(
        `<span class="s-space">${sp.icon}</span>${esc(sp.name)}${sp.id === B.activeSpaceId ? ' <span class="s-badge">Current</span>' : ''}`,
        `${spaceTheme(sp).colors.length === 1 ? 'Solid color' : `${spaceTheme(sp).colors.length}-color gradient`} · ${({ auto: 'follows app mode', light: 'always light', dark: 'always dark' })[spaceTheme(sp).mode]}${sp.separate ? ' · own sign-ins' : ''}`,
        `<span class="s-theme-chip" data-chip="${sp.id}" style="background:${themeBackground({ ...spaceTheme(sp), intensity: 100 })}"></span>
         <button class="btn" data-space-theme="${sp.id}">${icon('palette', 14)} Edit theme</button>
         <button class="icon-btn" data-space-menu="${sp.id}" title="More">${icon('more', 16)}</button>`,
      ))),
      `<div class="s-actions"><button class="btn" data-run="new-space">${icon('plus', 14)} New space</button></div>`,
      sGroup('Sign-ins', [
        ...B.spaces.map((sp) => sRow(`Separate sign-ins for ${sp.icon} ${esc(sp.name)}`, 'Its own cookies and logins, so you can use different accounts there.',
          `<button class="switch ${sp.separate ? 'on' : ''}" data-space-separate="${sp.id}" role="switch"></button>`)),
      ]),
    ].join(''),
  },
  {
    id: 'address-bar', title: 'Address bar', icon: 'search', desc: 'The address bar and its loading animation.',
    render: () => {
      const s = B.settings;
      return sGroup('Loading animation', [
        sRow('Show while pages load', 'A moving gradient inside the address bar until the page has loaded.', sSwitch('loadingIndicator')),
        sRow('Colors', '“Space” follows each space’s theme. “Custom” uses colors you pick. Click one to preview it in the address bar.',
          `<div class="loader-swatches ${s.loadingIndicator === false ? 'off' : ''}">${Object.entries(LOADER_THEMES).map(([k, t]) => `<button class="loader-swatch ${(s.loadingTheme || 'space') === k ? 'on' : ''}" data-loader="${k}"><span style="--sw:${loaderBackground(loaderColors(k))}"></span>${esc(t.name)}</button>`).join('')}</div>`,
          'data-stack'),
        s.loadingTheme === 'custom' && s.loadingIndicator !== false && sRow('Custom colors', 'Pick 2 to 5 colors. The gradient runs through them in order.', loaderCustomEditor(), 'data-stack'),
      ]);
    },
  },
  { id: 'sidebar', title: 'Sidebar', icon: 'sidebar', desc: 'Choose the buttons in your sidebar, and whether they sit at the top or the bottom.', embed: (el) => pageSidebarButtons(el) },
  {
    id: 'extensions', title: 'Extensions', icon: 'puzzle', desc: 'Chrome extensions, installed from the Chrome Web Store or a folder.',
    render: () => [
      sGroup('Installed', EXT.list.length ? EXT.list.map((e) => sRow(
        `${extIcon(e, 20)}${esc(e.name)} <span class="s-badge s-badge-quiet">${esc(e.version)}</span>${e.source === 'unpacked' ? ' <span class="s-badge s-badge-quiet">Unpacked</span>' : ''}`,
        e.error ? `<span class="s-error">Couldn’t start: ${esc(e.error)}</span>` : esc(e.description || ''),
        `${e.optionsPage ? `<button class="btn" data-ext-options="${esc(e.id)}">Options</button>` : ''}
         <button class="icon-btn ${e.pinned ? 'on' : ''}" data-ext-pin="${esc(e.id)}" title="${e.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}">${icon('pin', 15)}</button>
         <button class="icon-btn" data-ext-remove="${esc(e.id)}" title="Remove">${icon('trash', 15)}</button>
         <button class="switch ${e.enabled ? 'on' : ''}" data-ext-toggle="${esc(e.id)}" role="switch" title="${e.enabled ? 'Turn off' : 'Turn on'}"></button>`,
      )) : [sRow('No extensions yet', 'Add one from the Chrome Web Store below.', '')]),
      sGroup('Add extensions', [
        sRow('From the Chrome Web Store', 'Paste a link to an extension’s page, or its ID. On a store page you can also use “Add to Ultima” in the toolbar.',
          '<input class="field s-ext-input" data-ext-input placeholder="chromewebstore.google.com/detail/…" spellcheck="false"><button class="btn primary" data-ext-install>Install</button>', 'data-stack'),
        sRow('Browse the Chrome Web Store', '', '<button class="btn" data-ext-store>Open store</button>'),
        sRow('Load unpacked', 'For extensions you are developing. Ultima loads them straight from the folder you choose.', '<button class="btn" data-ext-unpacked>Choose folder…</button>'),
      ]),
      sGroup('Troubleshooting', [
        sRow('Extension log', 'Errors and warnings from your extensions, saved only on this computer. Open it when an extension misbehaves.', '<button class="btn" data-ext-log>Open log</button>'),
      ]),
      sGroup('Compatibility', [
        sRow('What works', 'Extensions that change pages (content scripts), use storage, background scripts, scripting or webRequest work. Ones that rely on Chrome-only features — Chrome sync, declarativeNetRequest blocking rules, context menus, side panels — may only partly work.', ''),
      ]),
    ].join(''),
  },
  { id: 'shortcuts', title: 'Keyboard shortcuts', icon: 'command', desc: 'Change, add or remove any shortcut in Ultima.', embed: (el, tab) => pageShortcuts(el, tab) },
  { id: 'passwords', title: 'Passwords', icon: 'key', desc: 'Saved logins, encrypted with your Windows account.', embed: (el, tab) => pagePasswords(el, tab) },
  {
    id: 'privacy', title: 'Privacy', icon: 'shield', desc: 'What Ultima keeps on this computer, and what sites may do.',
    render: () => [
      sGroup('Clear browsing data', [
        sRow('History', 'Every page you have visited.', '<button class="btn" data-clear="history">Clear history</button>'),
        sRow('Cache', 'Saved copies of pages and images. Sites may load slower at first.', '<button class="btn" data-clear="cache">Clear cache</button>'),
        sRow('Cookies and site data', 'Signs you out of websites in every space.', '<button class="btn danger" data-clear="cookies">Delete</button>'),
      ]),
      sGroup('Site permissions', [
        sRow('Remembered decisions', 'Forget every Allow/Block choice for camera, location, notifications and more.', '<button class="btn" data-run-perm>Reset permissions</button>'),
      ]),
    ].join(''),
  },
  { id: 'import', title: 'Import', icon: 'import', desc: 'Bring bookmarks, history, tabs and passwords from other browsers.', embed: (el) => pageImport(el) },
  {
    id: 'about', title: 'About', icon: 'sparkle', desc: '',
    render: () => `<div class="s-about">${LOGO.replace('class="logo"', 'class="logo s-about-logo"')}
      <div class="s-about-name">Ultima Browser</div><div class="s-desc">Version ${esc(B.versions.app)}</div></div>
      ${sGroup('', [
        sRow('Chromium', '', `<span class="s-value">${esc(B.versions.chrome)}</span>`),
        sRow('Electron', '', `<span class="s-value">${esc(B.versions.electron)}</span>`),
        sRow('Node.js', '', `<span class="s-value">${esc(B.versions.node)}</span>`),
        sRow('Data folder', 'Settings, history, bookmarks and session.', '<span class="s-value">%APPDATA%\\Ultima Browser</span>'),
      ])}
      <section class="s-group"><h3 class="s-group-title">Patch notes</h3><div class="s-card pn">${patchNotesHtml(B.versions.app)}</div></section>`,
  },
];

const settingsTabId = (tab) => {
  const id = (tab.url.split('#')[1] || '').toLowerCase();
  return SETTINGS_TABS.some((t) => t.id === id) ? id : 'general';
};

// ---------- page ----------
function pageSettings(root, tab) {
  const current = settingsTabId(tab);
  root.innerHTML = `<div class="settings">
    <nav class="s-nav">
      <div class="s-nav-head">${LOGO}<span>Settings</span></div>
      <label class="s-search">${icon('search', 14)}<input id="s-query" placeholder="Search settings" spellcheck="false"></label>
      <div class="s-tabs">${SETTINGS_TABS.map((t) => `<button class="s-tab ${t.id === current ? 'on' : ''}" data-tab="${t.id}">${icon(t.icon, 16)}<span>${esc(t.title)}</span></button>`).join('')}</div>
    </nav>
    <main class="s-main" id="s-main"></main>
  </div>`;
  const main = $('#s-main', root);

  const show = (id) => {
    const t = SETTINGS_TABS.find((x) => x.id === id);
    $$('.s-tab', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    main.innerHTML = `<header class="s-header"><h1>${esc(t.title)}</h1>${t.desc ? `<p>${esc(t.desc)}</p>` : ''}</header><div class="s-body"></div>`;
    const body = $('.s-body', main);
    if (t.embed) { body.classList.add('s-embed'); t.embed(body, tab); } else body.innerHTML = t.render();
  };

  // search runs over every regular tab's rows at once
  const search = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    $$('.s-tab', root).forEach((b) => b.classList.remove('on'));
    const sections = SETTINGS_TABS.filter((t) => t.render).map((t) => {
      const box = h(`<div>${t.render()}</div>`);
      $$('.s-row', box).forEach((r) => { if (!words.every((w) => `${r.textContent} ${t.title}`.toLowerCase().includes(w))) r.remove(); });
      $$('.s-group', box).forEach((g) => { if (!$('.s-row', g)) g.remove(); });
      $$('.s-actions, .s-about', box).forEach((x) => x.remove());
      return $('.s-row', box) ? `<h2 class="s-result-head" data-tab="${t.id}">${icon(t.icon, 15)} ${esc(t.title)}</h2>${box.innerHTML}` : '';
    }).join('');
    const pages = SETTINGS_TABS.filter((t) => t.embed && words.every((w) => `${t.title} ${t.desc}`.toLowerCase().includes(w)))
      .map((t) => `<button class="s-jump" data-tab="${t.id}">${icon(t.icon, 15)} Open ${esc(t.title)} ${icon('forward', 13)}</button>`).join('');
    main.innerHTML = `<header class="s-header"><h1>Results for “${esc(q)}”</h1></header>
      <div class="s-body">${pages}${sections || (pages ? '' : '<div class="empty">No setting matches</div>')}</div>`;
  };

  const rerender = () => {
    const q = $('#s-query', root).value.trim();
    if (q) search(q); else show(settingsTabId(tab));
  };

  $('.s-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    $('#s-query', root).value = '';
    tab.url = `ultima://settings#${b.dataset.tab}`;
    saveSession();
    show(b.dataset.tab);
    root.scrollTop = 0;
  });
  $('#s-query', root).addEventListener('input', rerender);

  // one handler for every control on every tab
  main.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-tab]');
    if (!t) return;
    const d = t.dataset;
    if (d.tab && !t.classList.contains('s-tab')) {
      $('#s-query', root).value = '';
      tab.url = `ultima://settings#${d.tab}`;
      show(d.tab);
      return;
    }
    if (d.switch) applySettings({ [d.switch]: !(B.settings[d.switch] !== false && B.settings[d.switch]) });
    else if (d.v && t.parentElement.dataset.key) {
      applySettings({ [t.parentElement.dataset.key]: d.v });
      const sp = t.parentElement.dataset.key === 'theme' && modeOverride();
      if (sp) toast(`${sp.name} keeps its own ${MODE_NAMES[sp.theme.mode]} mode`, { label: 'Follow this setting', run: () => followAppMode(sp) });
    } else if (d.spaceFollow) { followAppMode(spaceById(d.spaceFollow)); return; }
    else if (d.accent) applySettings({ accent: d.accent });
    else if (d.loader) { applySettings({ loadingTheme: d.loader }); previewLoader(); }
    else if (t.hasAttribute('data-lc-add')) {
      const colors = customLoaderColors();
      // a new color carries the gradient on: well round the wheel from the last one
      const last = hexToHsl(colors[colors.length - 1]);
      applySettings({ loadingCustom: [...colors, hslToHex({ ...last, h: (last.h + 150) % 360 })] });
      previewLoader();
    } else if (d.lcRemove) {
      applySettings({ loadingCustom: customLoaderColors().filter((_, i) => i !== Number(d.lcRemove)) });
      previewLoader();
    }
    else if (d.spaceTheme) { openThemeEditor(spaceById(d.spaceTheme)); return; }
    else if (d.spaceMenu) { const r = t.getBoundingClientRect(); await spaceMenu(spaceById(d.spaceMenu), { x: r.right - 220, y: r.bottom + 4 }); }
    else if (d.spaceSeparate) { const sp = spaceById(d.spaceSeparate); setSpaceSeparate(sp, !sp.separate); }
    else if (d.run) { runCommand(d.run); return; }
    else if (d.extToggle) { const ext = EXT.list.find((x) => x.id === d.extToggle); await window.ultima.setExtensionEnabled({ id: ext.id, enabled: !ext.enabled }); return; }
    else if (d.extPin) { const ext = EXT.list.find((x) => x.id === d.extPin); await window.ultima.setExtensionPinned({ id: ext.id, pinned: !ext.pinned }); return; }
    else if (d.extOptions) { openExtension({ ...EXT.list.find((x) => x.id === d.extOptions), popup: null }, t); return; }
    else if (d.extRemove) {
      const ext = EXT.list.find((x) => x.id === d.extRemove);
      if (await confirmDialog(ext.source === 'unpacked' ? 'Its folder on your computer is left as it is.' : 'Its data in Ultima is deleted.', { title: `Remove ${ext.name}?`, ok: 'Remove', danger: true })) await window.ultima.removeExtension(ext.id);
      return;
    } else if (t.hasAttribute('data-ext-install')) {
      const input = $('[data-ext-input]', main);
      if (await installFromStore(input.value)) input.value = '';
      return;
    } else if (t.hasAttribute('data-ext-log')) { await window.ultima.openExtensionLog(); return; }
    else if (t.hasAttribute('data-ext-store')) { createTab({ url: STORE_HOME }); return; }
    else if (t.hasAttribute('data-ext-unpacked')) {
      try {
        const ext = await window.ultima.installUnpackedExtension();
        if (ext) toast(ext.error ? `${ext.name} couldn’t start: ${ext.error}` : `Loaded ${ext.name}`);
      } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
      return;
    } else if (t.hasAttribute('data-run-perm')) { await window.ultima.resetPermissions(); toast('Site permissions reset'); return; }
    else if (t.hasAttribute('data-dl-choose')) { chooseDownloadDir(); return; }
    else if (t.hasAttribute('data-dl-reset')) { resetDownloadDir(); return; }
    else if (d.clear) {
      if (d.clear === 'cookies' && !await confirmDialog('You will be signed out of websites in every space.', { title: 'Delete all cookies and site data?', ok: 'Delete', danger: true })) return;
      await window.ultima.clearData({ [d.clear]: true, partitions: B.spaces.filter((sp) => sp.separate).map((sp) => partitionFor(sp.id)) });
      toast(`${t.textContent.replace(/^(Clear|Delete) ?/, '') || 'Data'} cleared`);
      return;
    } else return;
    if (activeTab() === tab) rerender();
  });
  main.addEventListener('input', (e) => {
    const k = e.target.dataset.setting;
    if (k && e.target.type === 'range') applySettings({ [k]: Number(e.target.value) });
    // custom loading colors follow the picker live, without redrawing the page (that would close the picker)
    if (e.target.dataset.lc !== undefined) {
      const colors = [...customLoaderColors()];
      colors[Number(e.target.dataset.lc)] = e.target.value;
      applySettings({ loadingCustom: colors });
      e.target.parentElement.style.background = e.target.value;
      e.target.closest('.lc-stop').querySelector('.lc-hex').textContent = e.target.value.toUpperCase();
      const sw = $('[data-loader="custom"] span', main);
      if (sw) sw.style.setProperty('--sw', loaderBackground(colors));
    }
  });
  main.addEventListener('keydown', (e) => {
    if (e.target.matches('[data-ext-input]') && matchesKey(e, 'field.submit')) { e.preventDefault(); $('[data-ext-install]', main).click(); }
  });
main.addEventListener('change', (e) => {
    if (e.target.dataset.lc !== undefined) previewLoader();
    const k = e.target.dataset.setting;
    if (k && e.target.tagName === 'SELECT') applySettings({ [k]: e.target.value });
  });

  show(current);
}

// The custom loading gradient's color stops: a color picker each, plus add and remove.
function loaderCustomEditor() {
  const colors = customLoaderColors();
  return `<div class="loader-custom">${colors.map((c, i) => `
      <div class="lc-stop">
        <label class="lc-chip" style="background:${c}" title="Change color ${i + 1}"><input type="color" value="${c}" data-lc="${i}" aria-label="Color ${i + 1}"></label>
        <span class="lc-hex">${c.toUpperCase()}</span>
        ${colors.length > 2 ? `<button class="icon-btn lc-remove" data-lc-remove="${i}" title="Remove this color">${icon('close', 12)}</button>` : ''}
      </div>`).join('')}
    ${colors.length < 5 ? `<button class="lc-add" data-lc-add title="Add a color">${icon('plus', 16)}</button>` : ''}
  </div>`;
}

// Keeps a space's theme preview on the Spaces tab in step while its theme is being edited.
function refreshSettingsSpaceChip(space) {
  const chip = document.querySelector(`.s-theme-chip[data-chip="${space.id}"]`);
  if (chip) chip.style.background = themeBackground({ ...spaceTheme(space), intensity: 100 });
}
