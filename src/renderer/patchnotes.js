// Patch notes, newest first, shown in Settings → About. Add an entry for each release (version as in package.json).
// The first release describes what Ultima is (intro + features, no labels); later ones list changes by section.
// Each item is [what, a sentence on it]; sections without items are left out.
const PATCH_NOTES = [
  {
    version: '0.1.4',
    date: '2026-10-26',
    new: [
      ['Automatic tab groups', 'Tabs from the same work app (Google Docs, Sheets and Drive, Word, Excel and Teams, Jira, Confluence, Slack and many more) or the same website gather in a folder named for it. Group work apps by app or by suite, choose how many tabs it takes, or turn it off, in Settings → Productivity. Rename a folder and it keeps your name; take a tab out and it stays out.'],
      ['Accessibility settings', 'A new Accessibility page in Settings: page zoom, text size and a minimum text size; page contrast, brightness, grayscale, inverted colors and color-blindness filters; a strong outline on the focused item, underlined links, caret browsing (F7) to move through pages with a text cursor; and higher contrast and reduced motion in Ultima itself.'],
      ['Glance', 'Alt+click, Shift+click, or press and hold a link to preview it over the page without leaving it. The preview is the real page: use it, open it as a tab (nothing reloads), put it in split view, or press Esc to close it. Choose which gesture glances, or turn it off, in Settings → General.'],
      ['Ad and tracker blocking', 'Ultima blocks ads and the trackers that follow you from site to site, including YouTube’s video ads and the sponsored posts in Facebook, Instagram and X, and hides the empty boxes ads leave behind. The shield in the address bar shows how many it blocked on the page; click it to turn blocking off for a site. Turn ads and trackers on or off separately in Settings → Privacy.'],
      ['Tracking protection', 'Links you open lose their tracking codes (like utm_source and fbclid), and every site is asked not to sell or share your data (Global Privacy Control). You can also block third-party cookies in Settings → Privacy.'],
      ['More than one window', 'Open a new window with Ctrl+N, or a link in one from its right-click menu. Every window has the same spaces, Essentials and pinned tabs, kept in sync, and its own regular tabs. Quit with Ctrl+Shift+Q and every window comes back next time.'],
      ['Private windows and tabs', 'Ctrl+Shift+N opens a private window, and Alt+Shift+N a private tab in the window you’re in (or right-click a link). Private pages leave no history, aren’t saved for next time and run without extensions; their cookies and site data are deleted when the last one closes.'],
      ['Essentials for each space', 'Any space can have Essentials of its own instead of the ones your spaces share: choose Own Essentials in its menu, or in Settings → Spaces. They use that space’s sign-ins, and turning it off keeps them as pinned tabs there.'],
      ['Folders of pinned tabs', 'Folders work in the pinned area too. Drag a folder up there, or right-click it and choose Pin folder, and its tabs are pinned with it. Pinned folders, like pinned tabs, are in every window.'],
    ],
    fixed: [
      ['Tab folders and split views after a restart', 'Folders and split views come back when Ultima starts again. Before, restarting took your tabs out of their folders and split views apart.'],
    ],
    improved: [
      ['Dropdowns', 'Every dropdown in Ultima (search engine, site permissions and the rest) now opens Ultima’s own menu, with the current choice marked, instead of the system’s. Arrow keys, Enter, Esc and typing a letter work in it.'],
      ['Pinned tabs and Essentials stay put', 'They come back even with “Restore tabs from last time” turned off. Before, starting without restoring tabs lost them.'],
      ['Closing the last tab', 'Closing your last tab leaves a new tab page instead of waking one of your pinned tabs, and pressing Ctrl+W again there closes the window.'],
      ['Clearing a site’s data', 'A site’s settings, at the top of the address bar menu, can clear its cache, delete its cookies, or clear all of its data, and the page reloads fresh. Clearing all of a site’s data now empties its cache too.'],
    ],
  },
  {
    version: '0.1.3',
    date: '2026-10-26',
    fixed: [
      ['Signing in on school and office networks', 'When a network’s proxy or a website asks for a username and password, Ultima asks you, like other browsers do. Before, it quietly turned these requests down, which could leave a page stuck loading.'],
    ],
  },
  {
    version: '0.1.2',
    date: '2026-10-26',
    new: [
      ['Site settings', 'Choose what each site may do: location, camera, microphone, notifications, pop-ups, sound, images, JavaScript and more. Open the current site’s from the top of the address bar menu, or every site’s, with defaults for all of them, in Settings → Site settings. You can see and clear a site’s cookies and data there too.'],
    ],
    improved: [
      ['Camera and microphone', 'Each is its own permission now, so a site can have one without the other. Choices you already made apply to both.'],
    ],
    fixed: [
      ['Signing in to Google', 'Google no longer turns Ultima away with “This browser or app may not be secure.”'],
    ],
  },
  {
    version: '0.1.1',
    date: '2026-10-25',
    fixed: [
      ['Copying a page’s address', 'Copy page URL (Ctrl+Shift+C), Copy link on a tab, and Copy in the bookmark menus put the link on your clipboard, even while you’re on a page.'],
      ['Netflix and protected video on Mac', 'The Mac version is signed for Widevine, so streaming services play.'],
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-25',
    title: 'The first release of Ultima',
    intro: 'A browser built around the way you actually work: your tabs stay organized, every part of your life gets its own space, and everything is a keystroke away.',
    features: [
      ['A space for everything', 'Keep work, home and play apart, each with its own tabs, its own colors and, if you like, its own sign-ins. One swipe moves you between them.'],
      ['Your essentials, always one click away', 'Pin the sites you live in. They sit at the top of the sidebar in every space and always come back to where you pinned them.'],
      ['Everything at your fingertips', 'Press Ctrl+K to open a page, find a tab, search your history or run any command. Every shortcut is yours to change.'],
      ['Side by side', 'Put up to four tabs next to each other in split view, and gather related tabs into folders.'],
      ['Room to focus', 'Hide the sidebar completely and give the page the whole window. It slides back the moment you reach for it.'],
      ['Never lose your place', 'Tab History shows every page each tab has been through, so you can jump straight back.'],
      ['Bring everything with you', 'Move your bookmarks and history over from Chrome, Edge, Firefox and others in a click. Your Chrome extensions work here too.'],
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
