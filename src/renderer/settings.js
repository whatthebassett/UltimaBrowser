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
    d?.isDefault ? 'Links from other apps open in Ultima.' : 'Open links from other apps in Ultima.',
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
    ? `<span class="s-warn">${esc(sp.icon)} ${esc(sp.name)} uses its own ${MODE_NAMES[sp.theme.mode]} mode.</span> Spaces set to Auto follow this.`
    : 'Spaces can set their own in their theme.',
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

// a dropdown of numbers or words for one setting
const sPick = (key, opts, fallback) => `<select class="field" data-setting="${key}" ${typeof opts[0][0] === 'number' ? 'data-number' : ''}>${opts.map(([v, label]) => `<option value="${v}" ${(B.settings[key] ?? fallback) === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
// a slider in percent, with its value beside it
const sPercent = (key, min, max, step) => `<input type="range" data-setting="${key}" data-number min="${min}" max="${max}" step="${step}" value="${B.settings[key] ?? 100}"><span class="s-range-out" data-out="${key}">${B.settings[key] ?? 100}%</span>`;
const PAGE_ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300].map((z) => [z, `${z}%`]);
const TEXT_SIZES = [[9, 'Very small'], [12, 'Small'], [16, 'Medium'], [20, 'Large'], [24, 'Very large']];
const MIN_FONT_SIZES = [[0, 'None'], ...[9, 10, 12, 14, 16, 18, 20, 24].map((n) => [n, `${n} px`])];
const COLOR_FILTERS = [['none', 'None'], ['grayscale', 'Grayscale'], ['invert', 'Inverted colors'],
  ['protanopia', 'Red-weak (protanopia)'], ['deuteranopia', 'Green-weak (deuteranopia)'], ['tritanopia', 'Blue-weak (tritanopia)']];

// ---------- performance ----------
// B.hardwareAcceleration is what this run started with: a changed setting waits for a restart.
function performanceRows() {
  const want = B.settings.hardwareAcceleration !== false;
  return [
    sRow('Sleeping tabs', 'Tabs you haven’t used in a while unload to save memory, and load again when you open them.', sSwitch('sleepTabs')),
    B.settings.sleepTabs && sRow('Put tabs to sleep after', 'How long a tab sits in the background first.',
      `<select class="field" data-setting="sleepTabsAfter" data-number>${SLEEP_AFTER.map(([v, label]) => `<option value="${v}" ${Number(B.settings.sleepTabsAfter || 900) === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`),
    sRow('Hardware acceleration', 'Smoother pages and video. Turn it off if pages flicker or look garbled.', sSwitch('hardwareAcceleration')),
    want !== B.hardwareAcceleration && sRow(`Restart to turn it ${want ? 'on' : 'off'}`, 'Your tabs come back after the restart. Private ones close.',
      '<button class="btn primary" data-relaunch>Restart Ultima</button>'),
    sRow('Task manager', `See what each tab uses, and end the ones you don’t need.${keyText('task-manager') ? ` Shortcut: ${esc(keyText('task-manager'))}.` : ''}`,
      `<button class="btn" data-run="task-manager">${icon('activity', 14)} Open task manager</button>`),
  ];
}

// what opens a link in a glance (glance-preload.js asks main, which reads settings.glanceTrigger)
const GLANCE_TRIGGERS = [['any', 'Alt+click, Shift+click or click and hold'], ['alt', 'Alt+click'], ['shift', 'Shift+click'], ['hold', 'Click and hold'], ['off', 'Off']];

// The two tab layouts as little pictures of Ultima, in your colors: clicking one switches to it (tablayout.js)
function tabLayoutCards() {
  const current = tabsAcross() ? 'horizontal' : 'vertical';
  const tabs = (n, active) => Array.from({ length: n }, (_, i) => `<i class="${i === active ? 'on' : ''}"></i>`).join('');
  const card = (mode, label, sub, art) => `<button class="tl-card ${current === mode ? 'on' : ''}" data-tab-layout="${mode}" role="radio" aria-checked="${current === mode}">
    <span class="tl-art tl-${mode}" aria-hidden="true">${art}</span>
    <span class="tl-text"><span class="tl-label">${label}${current === mode ? ` ${icon('check', 13)}` : ''}</span><span class="tl-sub">${sub}</span></span></button>`;
  return `<div class="tl-cards" role="radiogroup" aria-label="Tab layout">
    ${card('vertical', 'Vertical', 'Tabs down the side',
      `<span class="tl-side"><span class="tl-url"></span><span class="tl-ess"><b></b><b></b><b></b></span><span class="tl-list">${tabs(5, 1)}</span></span><span class="tl-page"><span class="tl-hero"></span></span>`)}
    ${card('horizontal', 'Horizontal', 'Tabs across the top',
      `<span class="tl-strip"><span class="tl-ess"><b></b><b></b></span><span class="tl-list">${tabs(4, 1)}</span></span><span class="tl-bar"><span class="tl-url"></span></span><span class="tl-page"><span class="tl-hero"></span></span>`)}
  </div>`;
}

// The three kinds of address bar as little pictures (palette.js): clicking one picks it
function addressModeCards() {
  const current = addressMode();
  const rows = (n) => '<i></i>'.repeat(n);
  const card = (mode, label, sub, art) => `<button class="tl-card ${current === mode ? 'on' : ''}" data-address-mode="${mode}" role="radio" aria-checked="${current === mode}">
    <span class="tl-art ab-art ab-${mode}" aria-hidden="true"><span class="ab-top"><span class="ab-url"></span></span><span class="tl-page"><span class="tl-hero"></span></span>${art}</span>
    <span class="tl-text"><span class="tl-label">${label}${current === mode ? ` ${icon('check', 13)}` : ''}</span><span class="tl-sub">${sub}</span></span></button>`;
  return `<div class="tl-cards three" role="radiogroup" aria-label="Address bar">
    ${card('palette', 'Control Palette', 'Opens in the middle of the window', `<span class="ab-dim"></span><span class="ab-pal"><b></b>${rows(3)}</span>`)}
    ${card('extended', 'Extended address bar', 'Opens from the address bar', `<span class="ab-pal"><b></b>${rows(3)}</span>`)}
    ${card('classic', 'Traditional', 'Type in the bar, with suggestions below', `<span class="ab-caret"></span><span class="ab-drop">${rows(3)}</span>`)}
  </div>`;
}

// ---------- tabs ----------
// An extension that used APIs Ultima only stands in for: which ones, by namespace (see extension-compat.js)
function extPartly(e) {
  const names = [...new Set((e.unsupported || []).map((n) => `chrome.${n.split('.')[0]}`))];
  if (!names.length) return '';
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `<br><span class="s-partly">Partly works: Ultima doesn’t have ${esc(list)} yet.</span>`;
}

const SETTINGS_TABS = [
  {
    id: 'general', title: 'General', icon: 'settings', desc: 'Default browser, startup, glance, downloads, search and performance.',
    render: () => [
      sGroup('Default browser', [defaultBrowserRow()]),
      sGroup('Startup', [
        sRow('Restore tabs from last time', 'Tabs come back unloaded and load when you open them.', sSwitch('restoreSession')),
      ]),
      sGroup('Glance', [
        sRow('Open links in a glance with', 'Preview a link over the page without leaving it.',
          `<select class="field" data-setting="glanceTrigger">${GLANCE_TRIGGERS.map(([v, label]) => `<option value="${v}" ${(B.settings.glanceTrigger || 'any') === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`),
      ]),
      sGroup('Downloads', downloadRows()),
      sGroup('Search', [
        sRow('Search engine', 'Used by the Control Palette and the new tab page.',
          `<select class="field" data-setting="searchEngine">${Object.entries(SEARCH_ENGINES).map(([k, e]) => `<option value="${k}" ${B.settings.searchEngine === k ? 'selected' : ''}>${e.name}</option>`).join('')}</select>`),
      ]),
      sGroup('Performance', performanceRows()),
    ].join(''),
  },
  {
    id: 'appearance', title: 'Appearance', icon: 'sun', desc: 'Theme, window, tabs, Waypoints bar and sidebar.',
    jumps: [['Sidebar buttons', 'sidebar-buttons', 'customize add remove reorder toolbar top bottom divider']],
    render: () => {
      const s = B.settings;
      const style = sidebarStyleRows(); // sidebarstyle.js
      const resetStyle = style.pop();
      return [
        sGroup('Theme', [
          modeRow(),
          sRow('Accent color', 'Buttons, highlights and selections.', `<div class="swatches">${ACCENTS.map((c) => `<button class="swatch ${s.accent === c ? 'on' : ''}" data-accent="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`),
        ]),
        B.backdrops ? sGroup('Window', [
          sRow('Window material', 'Acrylic blurs what’s behind the window. Mica tints it with your wallpaper.', sSeg('windowMaterial', [['acrylic', 'Acrylic'], ['mica', 'Mica']])),
          s.windowMaterial === 'acrylic' ? sRow('Glass tint', 'How smoky the sidebar’s glass is.',
            `<input type="range" data-setting="glassTint" data-number min="0" max="90" step="5" value="${s.glassTint ?? 45}">`) : '',
        ]) : '',
        sGroup('Tabs', [
          sRow('Tab layout', `Click one to switch.${keyText('toggle-tab-layout') ? ` Shortcut: ${esc(keyText('toggle-tab-layout'))}.` : ''}`,
            tabLayoutCards(), 'data-stack'),
        ]),
        sGroup('Waypoints bar', [
          sRow('Show Waypoints bar', `Your Waypoints under the toolbar.${keyText('toggle-bookmarks-bar') ? ` Shortcut: ${esc(keyText('toggle-bookmarks-bar'))}.` : ''}`, sSwitch('showBookmarksBar')),
          sRow('Center Waypoints', 'Put them in the middle of the bar.', sSwitch('centerBookmarksBar')),
          sRow('Import a bookmarks bar', 'Copy the bookmarks bar from Chrome, Edge, Brave or Vivaldi.',
            `<button class="btn" data-run="import-bookmarks-bar">${icon('import', 14)} Import…</button>`),
        ]),
        sGroup(tabsAcross() ? 'Tabs and toolbar' : 'Sidebar', [
          ...style,
          sRow('Waypoints, History and Downloads', 'Open them as a dropdown or a full page.',
            sSeg('widgetOpen', [['dropdown', 'Dropdown'], ['page', 'Page']])),
          // (sizes and modes of the sidebar itself, which horizontal tabs don't have)
          !tabsAcross() && sRow('Essentials size', 'How tall the Essentials tiles are.',
            `<input type="range" data-setting="essentialsHeight" data-number min="36" max="72" step="4" value="${s.essentialsHeight ?? 44}">`),
          !tabsAcross() && sRow('Compact sidebar', `Show only icons.${keyText('toggle-sidebar') ? ` Shortcut: ${esc(keyText('toggle-sidebar'))}.` : ''}`, sSwitch('sidebarCollapsed')),
          !tabsAcross() && sRow('Hide sidebar', `Point at the left edge to bring it back.${keyText('toggle-sidebar-hidden') ? ` Shortcut: ${esc(keyText('toggle-sidebar-hidden'))}.` : ''}`, sSwitch('sidebarHidden')),
          resetStyle,
        ]),
        `<div data-anchor="sidebar-buttons">${sGroup(tabsAcross() ? 'Toolbar buttons' : 'Sidebar buttons', [
          sRow(tabsAcross() ? 'Toolbar buttons' : 'Sidebar buttons', tabsAcross() ? 'Drag buttons onto the toolbar.' : 'Drag buttons onto the top or bottom of the sidebar, with dividers between them.',
            `<button class="btn" data-run="customize-sidebar">${icon('sidebar', 14)} Edit ${tabsAcross() ? 'toolbar' : 'sidebar'}</button>`),
        ])}</div>`,
      ].join('');
    },
  },
  {
    id: 'productivity', title: 'Productivity', icon: 'bolt', desc: 'Features that keep your tabs in order.',
    render: () => {
      const on = Boolean(B.settings.autoGroup);
      return sGroup('Automatic tab groups', [
        sRow('Group tabs automatically', 'Tabs from the same app or site gather in a folder.', sSwitch('autoGroup')),
        on && sRow('Group when there are at least', 'Tabs from one app or site.', sPick('autoGroupMin', [[2, '2 tabs'], [3, '3 tabs'], [4, '4 tabs'], [5, '5 tabs']], 2)),
        on && sRow('Work apps', 'A folder for each app, or one for each suite like Google Workspace or Microsoft 365.',
          sPick('autoGroupWork', [['app', 'A folder for each app'], ['suite', 'A folder for each suite']], 'app')),
        on && sRow('Other websites too', 'Group tabs from any site, not just work apps.', sSwitch('autoGroupSites')),
        on && sRow('Group open tabs now', 'Puts the tabs you already have into groups.', '<button class="btn" data-autogroup-now>Group tabs</button>'),
      ]);
    },
  },
  {
    id: 'accessibility', title: 'Accessibility', icon: 'accessibility', desc: 'Zoom, text size, page colors, focus and motion.',
    render: () => {
      const s = B.settings;
      const colorsChanged = (s.pageContrast ?? 100) !== 100 || (s.pageBrightness ?? 100) !== 100 || (s.colorFilter || 'none') !== 'none';
      return [
        sGroup('Zoom and text', [
          sRow('Page zoom', 'The default size of pages.', sPick('pageZoom', PAGE_ZOOMS, 100)),
          sRow('Text size', 'For pages that don’t set their own.', sPick('textSize', TEXT_SIZES, 16)),
          sRow('Minimum text size', 'Text on pages is never smaller than this.', sPick('minFontSize', MIN_FONT_SIZES, 0)),
        ]),
        sGroup('Page colors', [
          sRow('Contrast', 'Stronger or softer contrast on pages.', sPercent('pageContrast', 50, 200, 10)),
          sRow('Brightness', 'Makes pages lighter or darker.', sPercent('pageBrightness', 40, 150, 5)),
          sRow('Color filter', 'Grayscale, inverted, or filters for color blindness.', sPick('colorFilter', COLOR_FILTERS, 'none')),
          colorsChanged && sRow('Back to normal colors', '', '<button class="btn" data-a11y-reset>Reset page colors</button>'),
        ]),
        sGroup('Focus and links', [
          sRow('Highlight the focused item', 'A thick outline around whatever the keyboard is on.', sSwitch('focusHighlight')),
          sRow('Underline links', 'Always underline links on pages.', sSwitch('underlineLinks')),
          sRow('Caret browsing', `Move through pages with a text cursor and the arrow keys.${keyText('caret-browsing') ? ` Shortcut: ${esc(keyText('caret-browsing'))}.` : ''}`, sSwitch('caretBrowsing')),
        ]),
        sGroup('Ultima', [
          sRow('Increase contrast', 'Stronger text and edges, and less glass, in Ultima.', sSwitch('uiContrast')),
          sRow('Reduce motion', 'Turn off Ultima’s animations. Always on if Windows animations are off.', sSwitch('reduceMotion')),
        ]),
      ].join('');
    },
  },
  {
    id: 'spaces', title: 'Spaces', icon: 'layers', desc: 'Your spaces, their themes, sign-ins and Essentials.',
    render: () => [
      sGroup('', B.spaces.map((sp) => sRow(
        `<span class="s-space">${sp.icon}</span>${esc(sp.name)}${sp.id === B.activeSpaceId ? ' <span class="s-badge">Current</span>' : ''}`,
        `${spaceTheme(sp).colors.length === 1 ? 'Solid color' : `${spaceTheme(sp).colors.length}-color gradient`} · ${({ auto: 'follows app mode', light: 'always light', dark: 'always dark' })[spaceTheme(sp).mode]}${sp.separate ? ' · own sign-ins' : ''}${sp.ownEssentials ? ' · own Essentials' : ''}`,
        `<span class="s-theme-chip" data-chip="${sp.id}" style="background:${themeBackground({ ...spaceTheme(sp), intensity: 100 })}"></span>
         <button class="btn" data-space-theme="${sp.id}">${icon('palette', 14)} Edit theme</button>
         <button class="icon-btn" data-space-menu="${sp.id}" title="More">${icon('more', 16)}</button>`,
      ))),
      `<div class="s-actions"><button class="btn" data-run="new-space">${icon('plus', 14)} New space</button></div>`,
      sGroup('Sign-ins', [
        ...B.spaces.map((sp) => sRow(`Separate sign-ins for ${sp.icon} ${esc(sp.name)}`, 'Use different accounts in this space.',
          `<button class="switch ${sp.separate ? 'on' : ''}" data-space-separate="${sp.id}" role="switch"></button>`)),
      ]),
      sGroup('Essentials', [
        ...B.spaces.map((sp) => sRow(`Own Essentials for ${sp.icon} ${esc(sp.name)}`, 'Give this space its own Essentials.',
          `<button class="switch ${sp.ownEssentials ? 'on' : ''}" data-space-essentials="${sp.id}" role="switch"></button>`)),
      ]),
    ].join(''),
  },
  {
    id: 'address-bar', title: 'Address bar', icon: 'search', desc: 'The address bar and the loading animation.',
    render: () => {
      const s = B.settings;
      return sGroup('When you click the address bar', [
        sRow('Address bar', `Click one to choose. ${keyText('palette') ? `${esc(keyText('palette'))} always opens the Control Palette.` : ''}`, addressModeCards(), 'data-stack'),
      ]) + sGroup('Loading animation', [
        sRow('Show while pages load', 'A moving gradient until the page has loaded.', sSwitch('loadingIndicator')),
        s.loadingIndicator !== false && sRow('Style', 'In the address bar, or a line under the toolbar.',
          sSeg('loadingStyle', [['bar', 'Address bar'], ['line', 'Line']])),
        sRow('Colors', 'Match each space, or pick your own. Click one to preview.', loaderSwatches(), 'data-stack'),
        s.loadingTheme === 'custom' && s.loadingIndicator !== false && sRow('Custom colors', 'Pick 2 to 5 colors, and drag them to change the order. Save them to keep them as a choice.', loaderCustomEditor(), 'data-stack'),
        savedLoader(s.loadingTheme) && s.loadingIndicator !== false && sRow('Your colors', 'Give them a name. Pick 2 to 5 colors, and drag them to change the order.', loaderCustomEditor(savedLoader(s.loadingTheme)), 'data-stack'),
      ]);
    },
  },
  {
    id: 'extensions', title: 'Extensions', icon: 'puzzle', desc: 'Chrome extensions, installed from the Chrome Web Store or a folder.',
    render: () => [
      sGroup('Installed', EXT.list.length ? EXT.list.map((e) => sRow(
        `${extIcon(e, 20)}${esc(e.name)} <span class="s-badge s-badge-quiet">${esc(e.version)}</span>${e.source === 'unpacked' ? ' <span class="s-badge s-badge-quiet">Unpacked</span>' : ''}${e.updateReady ? ` <span class="s-badge" title="Version ${esc(e.updateReady)} starts when Ultima restarts">Update ready</span>` : ''}`,
        e.error ? `<span class="s-error">Couldn’t start: ${esc(e.error)}</span>` : `${esc(e.description || '')}${extPartly(e)}`,
        `${e.optionsPage ? `<button class="btn" data-ext-options="${esc(e.id)}">Options</button>` : ''}
         <button class="icon-btn ${e.pinned ? 'on' : ''}" data-ext-pin="${esc(e.id)}" title="${e.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}">${icon('pin', 15)}</button>
         <button class="icon-btn" data-ext-remove="${esc(e.id)}" title="Remove">${icon('trash', 15)}</button>
         <button class="switch ${e.enabled ? 'on' : ''}" data-ext-toggle="${esc(e.id)}" role="switch" title="${e.enabled ? 'Turn off' : 'Turn on'}"></button>`,
      )) : [sRow('No extensions yet', 'Add one from the Chrome Web Store below.', '')]),
      sGroup('Add extensions', [
        sRow('From the Chrome Web Store', 'Paste an extension’s link or ID.',
          '<input class="field s-ext-input" data-ext-input placeholder="chromewebstore.google.com/detail/…" spellcheck="false"><button class="btn primary" data-ext-install>Install</button>', 'data-stack'),
        sRow('Browse the Chrome Web Store', '', '<button class="btn" data-ext-store>Open store</button>'),
        sRow('Load unpacked', 'Load an extension from a folder, for developers.', '<button class="btn" data-ext-unpacked>Choose folder…</button>'),
      ]),
      sGroup('Updates', [
        sRow('Keep extensions up to date', 'New versions download by themselves and start when Ultima restarts.', '<button class="btn" data-ext-updates>Check now</button>'),
      ]),
      sGroup('Troubleshooting', [
        sRow('Extension log', 'Errors and warnings from your extensions.', '<button class="btn" data-ext-log>Open log</button>'),
      ]),
      sGroup('Compatibility', [
        sRow('What works', 'Most extensions work. Ones that need Chrome-only features, like sync, may only partly work.', ''),
      ]),
    ].join(''),
  },
  { id: 'shortcuts', title: 'Keyboard shortcuts', icon: 'command', desc: 'Change, add or remove any shortcut in Ultima.', embed: (el, tab) => pageShortcuts(el, tab) },
  { id: 'passwords', title: 'Passwords', icon: 'key', desc: 'Saved logins, encrypted with your Windows account.', embed: (el, tab) => pagePasswords(el, tab) },
  {
    id: 'privacy', title: 'Privacy', icon: 'shield', desc: 'Ads, trackers, browsing data and site permissions.',
    render: () => [
      blockerSettingsGroups(), // blocking.js
      sGroup('Clear browsing data', [
        sRow('History', 'Every page you have visited.', '<button class="btn" data-clear="history">Clear history</button>'),
        sRow('Cache', 'Saved copies of pages and images. Sites may load slower at first.', '<button class="btn" data-clear="cache">Clear cache</button>'),
        sRow('Cookies and site data', 'Signs you out of websites in every space.', '<button class="btn danger" data-clear="cookies">Delete</button>'),
      ]),
      sGroup('Site permissions', [
        sRow('Site settings', 'Choose what each site can do.', '<button class="btn" data-tab="sites">Open site settings</button>'),
      ]),
    ].join(''),
  },
  { id: 'sites', title: 'Site settings', icon: 'globe', desc: 'Choose what sites can do.', embed: (el) => pageSiteSettings(el) },
  { id: 'import', title: 'Import', icon: 'import', desc: 'Bring bookmarks, history, tabs and passwords from other browsers.', embed: (el) => pageImport(el) },
  {
    id: 'about', title: 'About', icon: 'sparkle', desc: '',
    render: () => `<div class="s-about">${LOGO.replace('class="logo"', 'class="logo s-about-logo"')}
      <div class="s-about-name">Ultima Browser</div><div class="s-desc">Version ${esc(B.versions.app)}</div></div>
      ${sGroup('', [
        sRow('Chromium', '', `<span class="s-value">${esc(B.versions.chrome)}</span>`),
        sRow('Electron', '', `<span class="s-value">${esc(B.versions.electron)}</span>`),
        sRow('Node.js', '', `<span class="s-value">${esc(B.versions.node)}</span>`),
        sRow('Data folder', 'Settings, history, Waypoints and session.', `<span class="s-value">${esc(B.dataFolder || '')}</span>`),
        sRow('Welcome', 'Watch the welcome and setup again.', `<button class="btn" data-run="welcome">${icon('sparkle', 14)} Replay welcome</button>`),
      ])}
      <section class="s-group"><h3 class="s-group-title">Patch notes</h3><div class="s-card pn">${patchNotesHtml(B.versions.app)}</div></section>`,
  },
];

// The list on the left, in sections. A tab left out of them goes at the end of the last.
const SETTINGS_SECTIONS = [
  ['Basics', ['general', 'appearance', 'accessibility']],
  ['Browsing', ['spaces', 'address-bar', 'productivity', 'shortcuts', 'extensions']],
  ['Privacy and security', ['privacy', 'sites', 'passwords']],
  ['Ultima', ['import', 'about']],
];
function settingsSections() {
  const listed = new Set(SETTINGS_SECTIONS.flatMap(([, ids]) => ids));
  const rest = SETTINGS_TABS.filter((t) => !listed.has(t.id)).map((t) => t.id);
  return SETTINGS_SECTIONS.map(([title, ids], i) => [title, [...ids, ...(i === SETTINGS_SECTIONS.length - 1 ? rest : [])]
    .map((id) => SETTINGS_TABS.find((t) => t.id === id)).filter(Boolean)]);
}

const SETTINGS_MOVED = { sidebar: 'appearance' }; // pages that became part of another (old links and tabs)
const settingsTabId = (tab) => {
  const part = (tab.url.split('#')[1] || '').split('/')[0].toLowerCase();
  const id = SETTINGS_MOVED[part] || part;
  return SETTINGS_TABS.some((t) => t.id === id) ? id : 'general';
};
// the place a link points to inside its tab (settings#appearance/sidebar-buttons), or what an old link's page became
const settingsAnchor = (tab) => {
  const [part, anchor] = (tab.url.split('#')[1] || '').toLowerCase().split('/');
  return anchor || (part === 'sidebar' ? 'sidebar-buttons' : null);
};

// ---------- page ----------
function pageSettings(root, tab) {
  const current = settingsTabId(tab);
  root.innerHTML = `<div class="settings">
    <nav class="s-nav">
      <div class="s-nav-head">${LOGO}<span>Settings</span></div>
      <label class="s-search">${icon('search', 14)}<input id="s-query" placeholder="Search settings" spellcheck="false"></label>
      <div class="s-tabs">${settingsSections().map(([title, tabs]) => `<div class="s-tabs-head">${esc(title)}</div>${tabs.map((t) => `<button class="s-tab ${t.id === current ? 'on' : ''}" data-tab="${t.id}">${icon(t.icon, 16)}<span>${esc(t.title)}</span></button>`).join('')}`).join('')}</div>
    </nav>
    <main class="s-main" id="s-main"></main>
  </div>`;
  const main = $('#s-main', root);

  const show = (id) => {
    const t = SETTINGS_TABS.find((x) => x.id === id);
    $$('.s-tab', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    main.innerHTML = `<header class="s-header"><h1>${esc(t.title)}</h1>${t.desc ? `<p>${esc(t.desc)}</p>` : ''}</header><div class="s-body"></div>`;
    const body = $('.s-body', main);
    if (t.embed) { body.classList.add('s-embed'); t.embed(body, tab); } else { body.innerHTML = t.render(); t.mount?.(body, tab); }
  };
  const scrollToAnchor = (anchor) => { if (anchor) $(`[data-anchor="${anchor}"]`, main)?.scrollIntoView({ block: 'start' }); };

  // search runs over every regular tab's rows at once
  const search = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    $$('.s-tab', root).forEach((b) => b.classList.remove('on'));
    const sections = settingsSections().flatMap(([, tabs]) => tabs).filter((t) => t.render).map((t) => {
      const box = h(`<div>${t.render()}</div>`);
      $$('.s-row', box).forEach((r) => { if (!words.every((w) => `${r.textContent} ${t.title}`.toLowerCase().includes(w))) r.remove(); });
      $$('.s-group', box).forEach((g) => { if (!$('.s-row', g)) g.remove(); });
      $$('.s-actions, .s-about', box).forEach((x) => x.remove());
      return $('.s-row', box) ? `<h2 class="s-result-head" data-tab="${t.id}">${icon(t.icon, 15)} ${esc(t.title)}</h2>${box.innerHTML}` : '';
    }).join('');
    const pages = SETTINGS_TABS.filter((t) => t.embed && words.every((w) => `${t.title} ${t.desc}`.toLowerCase().includes(w)))
      .map((t) => `<button class="s-jump" data-tab="${t.id}">${icon(t.icon, 15)} Open ${esc(t.title)} ${icon('forward', 13)}</button>`).join('')
      // parts of a tab that aren't rows of settings (the sidebar buttons editor), found by their name
      + SETTINGS_TABS.flatMap((t) => (t.jumps || []).filter(([title, , more]) => words.every((w) => `${title} ${more}`.toLowerCase().includes(w)))
        .map(([title, anchor]) => `<button class="s-jump" data-tab="${t.id}" data-anchor="${anchor}">${icon(t.icon, 15)} Open ${esc(title)} ${icon('forward', 13)}</button>`)).join('');
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
      tab.url = `ultima://settings#${d.tab}${d.anchor ? `/${d.anchor}` : ''}`;
      show(d.tab);
      scrollToAnchor(d.anchor);
      return;
    }
    if (d.switch) {
      applySettings({ [d.switch]: !(B.settings[d.switch] !== false && B.settings[d.switch]) });
      if (d.switch === 'autoGroup' && B.settings.autoGroup) autoGroupAll(); // turned on: the open tabs group now
    } else if (t.hasAttribute('data-autogroup-now')) {
      const n = autoGroupAll();
      toast(n ? `Made ${n === 1 ? 'a group' : `${n} groups`}` : 'No new groups: no app or site has enough ungrouped tabs');
      return;
    } else if (t.hasAttribute('data-relaunch')) { await window.ultima.relaunch(); return; }
    else if (t.hasAttribute('data-sb-style-reset')) applySettings({ sidebarFont: 'inter', sidebarTextSize: 13, sidebarDensity: 'default' });
    else if (t.hasAttribute('data-a11y-reset')) applySettings({ pageContrast: 100, pageBrightness: 100, colorFilter: 'none' });
    else if (d.v && t.parentElement.dataset.key) {
      applySettings({ [t.parentElement.dataset.key]: d.v });
      if (t.parentElement.dataset.key === 'loadingStyle') previewLoader(); // shows the new style at once
      const sp = t.parentElement.dataset.key === 'theme' && modeOverride();
      if (sp) toast(`${sp.name} keeps its own ${MODE_NAMES[sp.theme.mode]} mode`, { label: 'Follow this setting', run: () => followAppMode(sp) });
    } else if (d.spaceFollow) { followAppMode(spaceById(d.spaceFollow)); return; }
    else if (d.accent) applySettings({ accent: d.accent });
    else if (d.tabLayout) applySettings({ tabLayout: d.tabLayout });
    else if (d.addressMode) { applySettings({ addressBarMode: d.addressMode }); updateChrome(); }
    else if (d.loader) { applySettings({ loadingTheme: d.loader }); previewLoader(); }
    else if (t.hasAttribute('data-lc-save')) saveCustomLoader();
    else if (d.loaderRemove) removeSavedLoader(d.loaderRemove);
    else if (t.hasAttribute('data-lc-add')) {
      const colors = editedLoaderColors();
      // a new color carries the gradient on: well round the wheel from the last one
      const last = hexToHsl(colors[colors.length - 1]);
      setEditedLoaderColors([...colors, hslToHex({ ...last, h: (last.h + 150) % 360 })]);
      previewLoader();
    } else if (d.lcRemove) {
      setEditedLoaderColors(editedLoaderColors().filter((_, i) => i !== Number(d.lcRemove)));
      previewLoader();
    }
    else if (d.spaceTheme) { openThemeEditor(spaceById(d.spaceTheme)); return; }
    else if (d.spaceMenu) { const r = t.getBoundingClientRect(); await spaceMenu(spaceById(d.spaceMenu), { x: r.right - 220, y: r.bottom + 4 }); }
    else if (d.spaceSeparate) { const sp = spaceById(d.spaceSeparate); setSpaceSeparate(sp, !sp.separate); }
    else if (d.spaceEssentials) { const sp = spaceById(d.spaceEssentials); setSpaceEssentials(sp, !sp.ownEssentials); }
    else if (d.run) { runCommand(d.run); return; }
    else if (d.extToggle) { const ext = EXT.list.find((x) => x.id === d.extToggle); await window.ultima.setExtensionEnabled({ id: ext.id, enabled: !ext.enabled }); return; }
    else if (d.extPin) { const ext = EXT.list.find((x) => x.id === d.extPin); await window.ultima.setExtensionPinned({ id: ext.id, pinned: !ext.pinned }); return; }
    else if (d.extOptions) { openExtensionOptions(EXT.list.find((x) => x.id === d.extOptions)); return; }
    else if (d.extRemove) {
      const ext = EXT.list.find((x) => x.id === d.extRemove);
      if (await confirmDialog(ext.source === 'unpacked' ? 'Its folder on your computer is left as it is.' : 'Its data in Ultima is deleted.', { title: `Remove ${ext.name}?`, ok: 'Remove', danger: true })) await window.ultima.removeExtension(ext.id);
      return;
    } else if (t.hasAttribute('data-ext-install')) {
      const input = $('[data-ext-input]', main);
      if (await installFromStore(input.value)) input.value = '';
      return;
    } else if (t.hasAttribute('data-ext-log')) { await window.ultima.openExtensionLog(); return; }
    else if (t.hasAttribute('data-ext-updates')) {
      t.disabled = true;
      try {
        const ready = await window.ultima.checkExtensionUpdates();
        toast(ready.length ? `Updates ready for ${ready.join(', ')}. They start when Ultima restarts.` : 'Your extensions are up to date.');
      } catch { toast('Couldn’t check for updates. Try again later.'); }
      t.disabled = false;
      return;
    }
    else if (t.hasAttribute('data-ext-store')) { createTab({ url: STORE_HOME }); return; }
    else if (t.hasAttribute('data-ext-unpacked')) {
      try {
        const ext = await window.ultima.installUnpackedExtension();
        if (ext) toast(ext.error ? `${ext.name} couldn’t start: ${ext.error}` : `Loaded ${ext.name}`);
      } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
      return;
    } else if (t.hasAttribute('data-blocker-update')) { updateBlockerLists(); return; }
    else if (d.blockingOn) { await window.ultima.blockerSetSite({ url: `https://${d.blockingOn}/`, off: false }); return; }
    else if (t.hasAttribute('data-run-perm')) { await window.ultima.resetPermissions(); toast('Site permissions reset'); return; }
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
    if (k && e.target.type === 'range') {
      applySettings({ [k]: Number(e.target.value) });
      const out = $(`[data-out="${k}"]`, main);
      if (out) out.textContent = `${e.target.value}%`;
    }
    // custom loading colors follow the picker live, without redrawing the page (that would close the picker)
    if (e.target.dataset.lc !== undefined) {
      const colors = [...editedLoaderColors()];
      colors[Number(e.target.dataset.lc)] = e.target.value;
      setEditedLoaderColors(colors);
      e.target.parentElement.style.background = e.target.value;
      e.target.closest('.lc-stop').querySelector('.lc-hex').textContent = e.target.value.toUpperCase();
      const sw = $(`[data-loader="${editedLoaderKey()}"] span`, main);
      if (sw) sw.style.setProperty('--sw', loaderBackground(colors));
    }
    // a saved set's name, as it's typed (its swatch too); an empty name isn't kept
    if (e.target.dataset.lcName !== undefined) {
      const saved = savedLoader(B.settings.loadingTheme);
      const name = e.target.value.trim();
      if (saved && name) {
        updateSavedLoader(saved.id, { name });
        const sw = $(`[data-loader="saved:${saved.id}"]`, main);
        if (sw) sw.lastChild.textContent = name;
        const x = $(`[data-loader-remove="${saved.id}"]`, main);
        if (x) { x.dataset.tip = `Remove ${name}`; x.setAttribute('aria-label', `Remove ${name}`); }
      }
    }
  });
  // loading color stops drag sideways to a new place (the others slide aside); a click still opens the picker
  main.addEventListener('pointerdown', (e) => {
    const chip = e.button === 0 && e.target.closest('.lc-chip');
    if (chip) dragLoaderStop(e, chip.closest('.lc-stop'), () => { if (activeTab() === tab) rerender(); });
  });
  main.addEventListener('keydown', (e) => {
    if (e.target.matches('[data-ext-input]') && matchesKey(e, 'field.submit')) { e.preventDefault(); $('[data-ext-install]', main).click(); }
    if (e.target.matches('[data-lc-name]') && matchesKey(e, 'field.submit')) { e.preventDefault(); e.target.blur(); }
  });
main.addEventListener('change', (e) => {
    if (e.target.dataset.lc !== undefined) previewLoader();
    if (e.target.dataset.lcName !== undefined && !e.target.value.trim()) e.target.value = savedLoader(B.settings.loadingTheme)?.name || '';
    const k = e.target.dataset.setting;
    if (k && e.target.tagName === 'SELECT') {
      applySettings({ [k]: 'number' in e.target.dataset ? Number(e.target.value) : e.target.value });
      // shows or hides "Reset page colors" and "Reset sidebar style"
      if ((k === 'colorFilter' || k === 'sidebarFont' || k === 'sidebarTextSize') && activeTab() === tab) rerender();
    }
  });

  show(current);
  scrollToAnchor(settingsAnchor(tab));
}

// The loading color choices: the built-in ones, then the ones you saved (each with a × to remove it), then Custom.
function loaderSwatches() {
  const current = B.settings.loadingTheme || 'space';
  const swatch = (key, name) => `<button class="loader-swatch ${current === key ? 'on' : ''}" data-loader="${esc(key)}"><span style="--sw:${loaderBackground(loaderColors(key))}"></span>${esc(name)}</button>`;
  const builtIn = Object.entries(LOADER_THEMES).filter(([k]) => k !== 'custom').map(([k, t]) => swatch(k, t.name));
  const saved = savedLoaders().map((t) => `<div class="loader-saved">${swatch(`saved:${t.id}`, t.name)}
    <button class="icon-btn ls-remove" data-loader-remove="${esc(t.id)}" title="Remove ${esc(t.name)}" aria-label="Remove ${esc(t.name)}">${icon('close', 12)}</button></div>`);
  return `<div class="loader-swatches ${B.settings.loadingIndicator === false ? 'off' : ''}">${[...builtIn, ...saved, swatch('custom', LOADER_THEMES.custom.name)].join('')}</div>`;
}

// The colors the editor under the choices is changing: Custom's, or the saved set that's picked.
const editedLoaderKey = () => (savedLoader(B.settings.loadingTheme) ? B.settings.loadingTheme : 'custom');
const editedLoaderColors = () => savedLoader(B.settings.loadingTheme)?.colors.filter(isHex).slice(0, 5) || customLoaderColors();
const updateSavedLoader = (id, change) => applySettings({ loadingSaved: savedLoaders().map((t) => (t.id === id ? { ...t, ...change } : t)) });
function setEditedLoaderColors(colors) {
  const saved = savedLoader(B.settings.loadingTheme);
  if (saved) updateSavedLoader(saved.id, { colors });
  else applySettings({ loadingCustom: colors });
}

// Keeps the Custom colors as a choice of their own (Custom 1, Custom 2… until you name it), picks it, and puts you in
// its name.
function saveCustomLoader() {
  const saved = savedLoaders();
  let n = saved.length + 1;
  while (saved.some((t) => t.name === `Custom ${n}`)) n += 1;
  const entry = { id: Math.random().toString(36).slice(2, 10), name: `Custom ${n}`, colors: [...customLoaderColors()] };
  applySettings({ loadingSaved: [...saved, entry], loadingTheme: `saved:${entry.id}` });
  previewLoader();
  setTimeout(() => { const f = $('[data-lc-name]'); f?.focus(); f?.select(); }); // (once the page shows its editor)
}

// Takes saved colors away (Undo puts them back where they were); if they were in use, Space takes over.
function removeSavedLoader(id) {
  const saved = savedLoaders();
  const index = saved.findIndex((t) => t.id === id);
  if (index < 0) return;
  const gone = saved[index];
  const wasOn = B.settings.loadingTheme === `saved:${id}`;
  applySettings({ loadingSaved: saved.filter((t) => t.id !== id), ...(wasOn ? { loadingTheme: 'space' } : {}) });
  toast(`${gone.name} removed`, {
    label: 'Undo',
    run: () => {
      const now = savedLoaders();
      applySettings({ loadingSaved: [...now.slice(0, index), gone, ...now.slice(index)], ...(wasOn ? { loadingTheme: `saved:${id}` } : {}) });
      rerenderIfShowing('settings');
    },
  });
}

// Drags a color stop along its row. Past a few pixels it's a drag: the stop follows the pointer, the others slide
// aside to where it would land, and letting go puts the color there (the click that ends it doesn't open the picker).
function dragLoaderStop(e, stop, done) {
  const stops = $$('.lc-stop', stop.parentElement);
  const from = stops.indexOf(stop);
  if (stops.length < 2 || from < 0) return;
  const pitch = stops[1].getBoundingClientRect().left - stops[0].getBoundingClientRect().left;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let to = from;
  let dragging = false;
  const move = (ev) => {
    const dx = ev.clientX - x0;
    if (!dragging) {
      if (Math.hypot(dx, ev.clientY - y0) < 5) return;
      dragging = true;
      stop.classList.add('lc-dragging');
      document.body.classList.add('lc-moving');
      for (const s of stops) if (s !== stop) s.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
    }
    ev.preventDefault();
    const span = [-from * pitch - pitch / 2, (stops.length - 1 - from) * pitch + pitch / 2]; // held within the row
    const x = Math.max(span[0], Math.min(span[1], dx));
    stop.style.transform = `translateX(${x}px) scale(1.08)`;
    to = Math.max(0, Math.min(stops.length - 1, from + Math.round(x / pitch)));
    stops.forEach((s, i) => {
      if (s === stop) return;
      const shift = from < to && i > from && i <= to ? -pitch : from > to && i >= to && i < from ? pitch : 0;
      s.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    if (!dragging) return;
    const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', eat, true);
    setTimeout(() => window.removeEventListener('click', eat, true));
    document.body.classList.remove('lc-moving');
    const colors = [...editedLoaderColors()];
    if (to !== from) {
      colors.splice(to, 0, ...colors.splice(from, 1));
      setEditedLoaderColors(colors);
      previewLoader();
    }
    done();
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

// The loading gradient's color stops, Custom's or a saved set's: a color picker each, plus add and remove. Custom's
// has a button to keep them; a saved set's has its name above.
function loaderCustomEditor(saved = null) {
  const colors = editedLoaderColors();
  const name = saved ? `<input class="field lc-name" data-lc-name maxlength="30" spellcheck="false" autocomplete="off" aria-label="Name" value="${esc(saved.name)}">` : '';
  return `<div class="lc-wrap">${name}<div class="loader-custom">${colors.map((c, i) => `
      <div class="lc-stop">
        <label class="lc-chip" style="background:${c}" title="Change color ${i + 1}"><input type="color" value="${c}" data-lc="${i}" aria-label="Color ${i + 1}"></label>
        <span class="lc-hex">${c.toUpperCase()}</span>
        ${colors.length > 2 ? `<button class="icon-btn lc-remove" data-lc-remove="${i}" title="Remove this color">${icon('close', 12)}</button>` : ''}
      </div>`).join('')}
    ${colors.length < 5 ? `<button class="lc-add" data-lc-add title="Add a color">${icon('plus', 16)}</button>` : ''}
  </div>${saved ? '' : `<button class="btn" data-lc-save>${icon('plus', 14)} Save these colors</button>`}</div>`;
}

// Keeps a space's theme preview on the Spaces tab in step while its theme is being edited.
function refreshSettingsSpaceChip(space) {
  const chip = document.querySelector(`.s-theme-chip[data-chip="${space.id}"]`);
  if (chip) chip.style.background = themeBackground({ ...spaceTheme(space), intensity: 100 });
}
