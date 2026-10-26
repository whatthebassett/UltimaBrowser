// Patch notes, newest first, shown in Settings → About. Add an entry for each release (version as in package.json).
// The first release describes what Ultima is (intro + features, no labels); later ones list changes by section.
// Each item is [what, a sentence on it]; sections without items are left out.
const PATCH_NOTES = [
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
