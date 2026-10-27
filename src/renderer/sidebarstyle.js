// Sidebar style (Settings → Appearance → Sidebar): the sidebar's font, text size and tab height, the same in
// every space and window. applyTheme sets them as CSS variables (--sb-font, --sb-text, --sb-row; see styles.css), so a
// change shows at once everywhere. The font is one of a few built-in choices or any font installed on the computer.
const SIDEBAR_FONTS = [ // [setting, label, CSS font stack]
  ['inter', 'Inter (default)', 'var(--font)'],
  ['system', 'System', 'system-ui, "Segoe UI Variable Text", "Segoe UI", -apple-system, sans-serif'],
  ['serif', 'Serif', 'Georgia, "Iowan Old Style", "Times New Roman", serif'],
  ['mono', 'Monospace', '"Cascadia Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace'],
];
const SIDEBAR_TEXT_SIZES = [[11, 'Extra small'], [12, 'Small'], [13, 'Default'], [14, 'Large'], [15, 'Larger'], [16, 'Largest']];
const SIDEBAR_ROWS = { compact: 28, default: 34, roomy: 40 }; // tab height, px
const SB_STYLE = { fonts: null }; // the installed font families, read once

// An installed font is saved as "font:<family>"; Inter (and its emoji) fill in whatever it lacks, or all of it once
// the font is uninstalled.
function sidebarFontStack(value) {
  const preset = SIDEBAR_FONTS.find(([k]) => k === value);
  if (preset) return preset[2];
  const family = String(value || '').startsWith('font:') ? value.slice(5).replace(/["\\]/g, '') : '';
  return family ? `"${family}", var(--font)` : 'var(--font)';
}

function applySidebarStyle() {
  const s = B.settings;
  const root = document.documentElement.style;
  root.setProperty('--sb-font', sidebarFontStack(s.sidebarFont));
  root.setProperty('--sb-text', `${Math.max(11, Math.min(16, Number(s.sidebarTextSize) || 13))}px`);
  root.setProperty('--sb-row', `${SIDEBAR_ROWS[s.sidebarDensity] || SIDEBAR_ROWS.default}px`);
}

// ---------- settings ----------
// The installed fonts (the Local Font Access API), read the first time the setting shows; the dropdown then fills in
// without redrawing the page.
async function loadInstalledFonts() {
  SB_STYLE.fonts = [];
  try {
    SB_STYLE.fonts = [...new Set((await window.queryLocalFonts()).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch { /* not available: the built-in choices only */ }
  for (const select of $$('select[data-sb-font]')) select.innerHTML = sidebarFontOptions();
}

// every choice is shown in its own font (dropdown.js reads data-font)
function sidebarFontOptions() {
  const current = B.settings.sidebarFont || 'inter';
  const opt = (v, label) => `<option value="${esc(v)}" data-font="${esc(sidebarFontStack(v))}" ${v === current ? 'selected' : ''}>${esc(label)}</option>`;
  const installed = [...(SB_STYLE.fonts || [])];
  const chosen = current.startsWith('font:') ? current.slice(5) : null;
  if (chosen && !installed.includes(chosen)) installed.unshift(chosen); // picked before, and since uninstalled (or still loading)
  return [
    ...SIDEBAR_FONTS.map(([k, label]) => opt(k, label)),
    installed.length ? '<option disabled data-heading>Installed fonts</option>' : '',
    ...installed.map((f) => opt(`font:${f}`, f)),
  ].join('');
}

function sidebarStyleRows() {
  if (!SB_STYLE.fonts) loadInstalledFonts();
  const s = B.settings;
  const changed = (s.sidebarFont || 'inter') !== 'inter' || (Number(s.sidebarTextSize) || 13) !== 13 || (s.sidebarDensity || 'default') !== 'default';
  return [
    sRow('Font', 'The typeface of tab names, folders and the rest of the sidebar: a built-in one, or any font installed on your computer.',
      `<select class="field" data-setting="sidebarFont" data-sb-font>${sidebarFontOptions()}</select>`),
    sRow('Text size', 'How big the sidebar’s text is.', sPick('sidebarTextSize', SIDEBAR_TEXT_SIZES, 13)),
    sRow('Tab height', 'How tall tabs, folders and the New Tab row are. Compact fits more tabs; Roomy is easier to click.',
      sSeg('sidebarDensity', [['compact', 'Compact'], ['default', 'Default'], ['roomy', 'Roomy']])),
    changed && sRow('Back to the default style', '', '<button class="btn" data-sb-style-reset>Reset sidebar style</button>'),
  ];
}
