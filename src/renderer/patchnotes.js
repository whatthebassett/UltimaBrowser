// Patch notes, newest first, shown in Settings → About. Add an entry for each release (version as in package.json).
// The first release describes what Ultima is (intro + features, no labels); later ones list changes by section.
// Each item is [what, one short plain sentence on it]; sections without items are left out.
const PATCH_NOTES = [
  {
    version: '0.2.2',
    date: '2026-10-29',
    new: [
      ['Tear off tabs', 'Drag a tab out of the window to give it a window of its own, or onto another window’s tabs to move it there.'],
      ['Swipe to go back', 'Swipe sideways with two fingers on a touchpad to go back or forward.'],
      ['Pull to reload', 'Swipe down past the top of a page with two fingers to reload it.'],
    ],
    fixed: [
      ['Closing the window with Ctrl+W', 'Ctrl+W on your last New Tab closes the window again, even with other spaces open.'],
    ],
  },
  {
    version: '0.2.1',
    date: '2026-10-28',
    new: [
      ['Horizontal tabs', 'Tabs across the top, with the address bar under them. Press Alt+S to switch.'],
      ['Three kinds of address bar', 'The Control Palette, an extended address bar, or a classic one. Pick in Settings → Address bar.'],
      ['Back and Forward history', 'Press and hold Back or Forward to jump to any page in the tab’s history.'],
      ['Full screen with F11', 'Press F11 to fill the screen with the page.'],
    ],
    improved: [
      ['Quick dropdowns', 'Waypoints, History and Downloads open as dropdowns from their buttons.'],
      ['Loading line', 'Show page loading as a thin line under the toolbar instead.'],
      ['Smoother full screen', 'Full screen fades in and out.'],
      ['Title badge', 'The page title in the top bar sits in a bold badge.'],
      ['Task manager window', 'The task manager opens in its own window.'],
      ['Folder animation', 'Folders slide open and closed.'],
      ['Scrollbars', 'Thin, rounded scrollbars that match Ultima.'],
      ['Spaces with the mouse', 'The mouse’s back and forward buttons switch spaces over the sidebar.'],
      ['Closing tabs in folders', 'Closing a tab in a folder opens the next one in that folder.'],
    ],
    fixed: [
      ['Mouse back and forward buttons', 'Your mouse’s side buttons work everywhere again.'],
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-27',
    new: [
      ['Automatic tab groups', 'Tabs from the same app or site gather in a folder. Set it up in Settings → Productivity.'],
      ['Accessibility settings', 'Zoom, text size, contrast, color filters and more, in Settings → Accessibility.'],
      ['Welcome film', 'A short guided setup the first time you open Ultima. Replay it from Settings → About.'],
      ['Task manager', 'Press Shift+Esc to see what each tab uses and end the ones you don’t need.'],
      ['Sidebar style', 'Pick the sidebar’s font, text size and tab height in Settings → Appearance.'],
      ['Performance settings', 'Turn hardware acceleration on or off in Settings → General.'],
      ['Glance', 'Alt+click or press and hold a link to preview it without leaving the page.'],
      ['Ad and tracker blocking', 'Ads and trackers are blocked. Turn it off for a site from the shield in the address bar.'],
      ['Tracking protection', 'Links lose their tracking codes, and sites are asked not to sell your data.'],
      ['Multiple windows', 'Press Ctrl+N for a new window. Spaces, Essentials and pinned tabs stay in sync.'],
      ['Private windows and tabs', 'Ctrl+Shift+N for a private window, Alt+Shift+N for a private tab.'],
      ['Essentials per space', 'Give any space its own Essentials from its menu.'],
      ['Pinned folders', 'Folders work in the pinned area too.'],
    ],
    improved: [
      ['Bookmarks are now Waypoints', 'Same features, new name.'],
      ['Page menu quick actions', 'Copy, Paste, Waypoints and Reload sit as buttons at the top of the right-click menu.'],
      ['Split views', 'A cleaner close button and an easier-to-see divider.'],
      ['Settings in sections', 'Settings pages are grouped so they’re quicker to find.'],
      ['Sidebar settings in one place', 'All sidebar options now live in Settings → Appearance.'],
      ['Dropdowns', 'Dropdowns use Ultima’s own menus and work with the keyboard.'],
      ['Pinned tabs stay put', 'Pinned tabs and Essentials come back even without restoring tabs.'],
      ['Closing the last tab', 'Leaves a new tab page instead of opening a pinned tab.'],
      ['Clearing a site’s data', 'Clear a site’s cache, cookies or all its data from the address bar menu.'],
    ],
    fixed: [
      ['Folders and split views after a restart', 'They now come back when Ultima restarts.'],
    ],
  },
  {
    version: '0.1.3',
    date: '2026-10-26',
    fixed: [
      ['Network and site sign-ins', 'Ultima now asks for your username and password instead of quietly refusing.'],
    ],
  },
  {
    version: '0.1.2',
    date: '2026-10-26',
    new: [
      ['Site settings', 'Choose what each site may do, from the address bar menu or Settings → Site settings.'],
    ],
    improved: [
      ['Camera and microphone', 'Each is now its own permission.'],
    ],
    fixed: [
      ['Signing in to Google', 'Google no longer says Ultima may not be secure.'],
    ],
  },
  {
    version: '0.1.1',
    date: '2026-10-25',
    fixed: [
      ['Copying a page’s address', 'Copy page URL and Copy link work again.'],
      ['Netflix on Mac', 'Protected video now plays on Mac.'],
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-25',
    title: 'The first release of Ultima',
    intro: 'A browser that keeps your tabs organized, gives each part of your life its own space, and puts everything a keystroke away.',
    features: [
      ['Spaces', 'Keep work, home and play apart, each with its own tabs and colors.'],
      ['Essentials', 'Pin the sites you use most at the top of the sidebar.'],
      ['Control Palette', 'Press Ctrl+K to open pages, find tabs and run commands.'],
      ['Split view and folders', 'Put up to four tabs side by side, and group tabs into folders.'],
      ['Hide the sidebar', 'Give the page the whole window.'],
      ['Tab History', 'See every page a tab has been through and jump back.'],
      ['Easy import', 'Bring bookmarks and history from other browsers. Chrome extensions work too.'],
    ],
  },
];

const PATCH_SECTIONS = [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed']];

function patchNotesHtml(current) {
  const date = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const list = (items) => `<ul class="pn-list">${items.map(([what, more]) => `<li><b>${esc(what)}</b>${more ? ` — ${esc(more)}` : ''}</li>`).join('')}</ul>`;
  const head = (n) => `<div class="pn-head"><span class="pn-version">Version ${esc(n.version)}</span>${n.version === current ? '<span class="s-badge">Current</span>' : ''}
      <span class="pn-date">${esc(date(n.date))}</span></div>${n.title ? `<div class="pn-title">${esc(n.title)}</div>` : ''}`;
  const body = (n) => (n.intro ? `<p class="pn-intro">${esc(n.intro)}</p>` : '')
    + (n.features?.length ? `<div class="pn-section">${list(n.features)}</div>` : '')
    + PATCH_SECTIONS.filter(([k]) => n[k]?.length).map(([k, label]) => `<div class="pn-section">
      <div class="pn-label pn-${k}">${label}</div>${list(n[k])}</div>`).join('');
  // the newest release open, the rest folded away
  return PATCH_NOTES.map((n, i) => (i === 0
    ? `<div class="pn-release">${head(n)}${body(n)}</div>`
    : `<details class="pn-release"><summary>${head(n)}</summary>${body(n)}</details>`)).join('');
}
