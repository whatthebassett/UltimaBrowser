// Patch notes, newest first, shown in Settings → About. Add an entry for each release (version as in package.json).
// The first release describes what Ultima is (intro + features, no labels); later ones list changes by section.
// Each item is [what, one short plain sentence on it]; sections without items are left out.
// A big feature can get its own area at the top of its release (`highlights`): { title, icon, text: a few plain
// sentences on what it is, items: [what, one short sentence] for its parts }.
const PATCH_NOTES = [
  {
    version: '0.3.1',
    date: '2026-10-30',
    fixed: [
      ['Middle-clicking Waypoints', 'Middle-clicking a Waypoint in a folder’s menu opens it in a new tab.'],
      ['Middle-clicking closed pinned tabs', 'Middle-clicking a closed pinned tab removes it from the sidebar.'],
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-29',
    highlights: [
      {
        title: 'Chrome extensions, working properly',
        icon: 'puzzle',
        text: 'Far more Chrome extensions now work in Ultima, and they behave as they do in Chrome. Popups and options pages open every time instead of getting stuck loading, extensions that need Chrome-only features start up, and they run on every tab, including the ones Ultima reopens when it starts.',
        items: [
          ['Side panels', 'Extensions like Claude open their side panel next to the page.'],
          ['Updates', 'Extensions from the Chrome Web Store keep themselves up to date.'],
          ['Desktop apps', 'Extensions can talk to their desktop apps, like Bitwarden’s.'],
          ['Shortcuts', 'Extensions’ keyboard shortcuts work, and you can change them in Settings.'],
          ['Menu items', 'Extensions can add items to the right-click menu.'],
        ],
      },
      {
        title: 'A password manager, built in',
        icon: 'key',
        text: 'Ultima now saves your logins as you sign in, fills them in for you, and keeps them all in a vault you can search and organize. Nothing to install, and it works on every site.',
        items: [
          ['Password vault', 'See, search, add and edit every saved login, with folders and favorites.'],
          ['Pick a login', 'Click a login field to choose from every login you saved for that site.'],
          ['Save passwords', 'After you sign in, Ultima offers to save a new password or update a changed one.'],
          ['Password generator', 'Make a strong password or passphrase, and use it right in a sign-up form.'],
          ['Weak and reused passwords', 'The vault shows which passwords are weak or used on more than one site.'],
        ],
      },
      {
        title: 'Work with many tabs at once',
        icon: 'layers',
        text: 'Choose several tabs and act on them together. Ctrl+click tabs to add them one by one, or Shift+click to choose a whole run of them. Press Esc or click anywhere else to let them go.',
        items: [
          ['One menu for all of them', 'Right-click any of them to close, reload, unload, duplicate, pin or mute them all.'],
          ['Keep them together', 'Put them in a new folder, another space, a split view, a new window or a folder of Waypoints.'],
          ['Drag them together', 'Drag one and the rest come along, in the same order.'],
        ],
      },
    ],
    new: [
      ['Sleeping tabs', 'Tabs you haven’t used in a while can go to sleep to save memory. Turn it on in Settings → General.'],
      ['Screen sharing', 'Sites can share a tab, a window or your whole screen. You choose which.'],
    ],
    improved: [
      ['Page messages', 'Alerts and questions from pages and extensions look like the rest of Ultima.'],
      ['Pop-ups', 'Sites can’t open windows or tabs unless you click, as in Chrome.'],
      ['Sign-in windows', 'Windows like “Sign in with Microsoft” look like Ultima and show the site’s address.'],
      ['Blank spaces in the sidebar', 'They stretch with the sidebar, so your buttons stay in place when you resize it.'],
      ['Compact sidebar button', 'You can move it or take it off in Edit sidebar, like the other buttons.'],
      ['Ultima’s pages in split view', 'Settings, History, Downloads and Ultima’s other pages can sit beside any tab.'],
      ['Names for automatic folders', 'Work app folders are named for what their tabs share, like a Jira project or a document’s topic.'],
    ],
    fixed: [
      ['No more stray New Tabs', 'Closing your last tab closes the window, and an empty space shows the new tab page without adding a tab.'],
      ['Closing a tab opens the next one', 'Your tabs come first, even asleep ones, then open pinned tabs, then open Essentials. Closing the last one closes the window.'],
      ['Moving the window with horizontal tabs', 'There’s always room after the + button to drag the window, however many tabs are open.'],
      ['Sites asking for permission', 'Sites ask for things you haven’t decided on yet, like notifications, instead of acting as if you said no.'],
      ['Blocking JavaScript and images', 'Blocking now works on every site, including ones that work offline.'],
      ['Buttons at the top of a hidden sidebar', 'Pointing at them no longer slides the sidebar away.'],
      ['Sites broken by ad blocking', 'Sites like weather.com show their forecasts again with ads blocked.'],
      ['Frames inside pages', 'Ad blocking, saved logins and Ultima’s dialogs work inside a page’s frames too.'],
      ['Claude in Chrome', 'Its side panel connects: sites like claude.ai can now talk to their extension.'],
      ['Extension buttons on Ultima’s pages', 'Clicking an extension’s button on the new tab page no longer breaks it.'],
      ['Two questions at once', 'A site’s second question waits its turn instead of canceling the first.'],
      ['Recording a shortcut', 'Esc cancels it instead of becoming the shortcut.'],
      ['Downloads page', 'It no longer jumps to the top while a file downloads.'],
      ['Private browsing', 'Glances, site choices and sleeping tabs in private windows stay private.'],
      ['Renaming spaces with horizontal tabs', 'Rename space now works there too.'],
    ],
  },
  {
    version: '0.2.3',
    date: '2026-10-29',
    new: [
      ['Edit Waypoints as you add them', 'Adding a Waypoint opens a popup to change its name, link and folder, or remove it.'],
      ['Save your loading colors', 'Keep as many custom address bar colors as you like, name and change them, and remove the ones you don’t want.'],
      ['Reorder your colors', 'Drag a custom color to move it.'],
      ['Snow Cone', 'A new white, blue and pink choice for the address bar’s loading colors.'],
      ['Edit the sidebar in place', 'Drag buttons from a panel at the bottom straight onto the top or bottom of the sidebar.'],
      ['Sidebar button grids', 'Put as many buttons as you like at the top and bottom of the sidebar, in rows, with dividers and blank spaces between them.'],
    ],
    improved: [
      ['Back and Forward in the page menu', 'Back and Forward sit as buttons at the top of the right-click menu, and Copy and Paste are back in the list.'],
      ['Frosted notifications', 'Pop-up messages are frosted glass with a touch of your accent color.'],
      ['Spaces with horizontal tabs', 'One button shows the space you’re in. Click it for your spaces, or scroll over it to switch.'],
    ],
    fixed: [
      ['Opening web pages from files', 'Web pages you open from a file open in Ultima again, even while it’s running.'],
      ['New window from the taskbar', 'The taskbar’s right-click menu opens a new window, or a new private one.'],
      ['Opening new windows', 'A new window opens once, without a blank flash first.'],
    ],
  },
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
  const highlight = (f) => `<div class="pn-highlight">
      <div class="pn-hl-title">${f.icon ? `<span class="pn-hl-icon">${icon(f.icon, 16)}</span>` : ''}${esc(f.title)}</div>
      ${f.text ? `<p class="pn-hl-text">${esc(f.text)}</p>` : ''}${f.items?.length ? list(f.items) : ''}</div>`;
  const body = (n) => (n.intro ? `<p class="pn-intro">${esc(n.intro)}</p>` : '')
    + (n.highlights?.length ? `<div class="pn-highlights">${n.highlights.map(highlight).join('')}</div>` : '')
    + (n.features?.length ? `<div class="pn-section">${list(n.features)}</div>` : '')
    + PATCH_SECTIONS.filter(([k]) => n[k]?.length).map(([k, label]) => `<div class="pn-section">
      <div class="pn-label pn-${k}">${label}</div>${list(n[k])}</div>`).join('');
  // the newest release open, the rest folded away
  return PATCH_NOTES.map((n, i) => (i === 0
    ? `<div class="pn-release">${head(n)}${body(n)}</div>`
    : `<details class="pn-release"><summary>${head(n)}</summary>${body(n)}</details>`)).join('');
}
