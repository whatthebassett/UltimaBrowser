# Ultima Browser

A Chromium-based desktop browser (castLabs Electron for Content Security 44 / Chromium 152, for Widevine) with vertical tabs, a keyboard-first **Control Palette**, and one-click import from your other browsers.

```bash
npm install
npm start          # run in development
npm run dist       # build the Windows installer into dist/ (needs the .NET SDK)
```

### The installer

`npm run dist` builds **`dist/Ultima Browser Setup <version>.exe`**, Ultima's own installer: a small native window (`installer/`, .NET Framework 4.8 — built into Windows 10/11 — with WebView2) that plays the install as a short film while it really installs. A logo reveal, a scored title card, feature shots over a warp-speed starfield with the real progress below, then a finale with **Launch Ultima**. The score is synthesized live (`installer/ui/audio.js`), with a mute button; Windows' reduce-motion setting gets a calm version.

- Installs per user (no admin rights) to `%LOCALAPPDATA%\Programs\Ultima Browser`, with Start menu and desktop shortcuts carrying Ultima's AppUserModelID, and an entry in Settings → Apps. Updating keeps your data; the uninstaller (same film, shorter) keeps it too unless you tick the box.
- Command line: `--silent`, `--dir "<folder>"`, `--no-desktop-shortcut`, `--launch`; the uninstaller takes `--uninstall [--silent] [--delete-data]`.
- The app inside is the VMP-signed one from electron-builder, so Netflix keeps working. `node installer/build.js --reuse` skips repackaging it.
- Design the scenes in a browser: open `installer/ui/index.html` through any local server (it plays a pretend install; `?mode=uninstall`, `?installed=0.0.9`, `?running=1`, `?fail=1`, `?seconds=10`).
- `npm run dist:nsis` still builds electron-builder's classic NSIS installer.

### macOS

The Mac version (Apple Silicon) is built on GitHub's Mac machines, since a Mac app can only be built on macOS: **Actions → Build → Run workflow** (`.github/workflows/build.yml`) builds Windows and Mac together and keeps both installers as downloads; pushing a version tag (`git tag v0.1.0 && git push --tags`) also publishes them as a GitHub Release. On a Mac, `npm run dist:mac` does the same locally.

- You get `Ultima Browser-<version>-arm64.dmg` (a drag-to-Applications window, its background from `build/dmg/`, re-rendered with `npm run dmg-background`) and a `.zip`.
- The app is ad-hoc signed, not with an Apple Developer ID, so on first launch macOS asks people to allow it in System Settings → Privacy & Security → **Open Anyway**. Signing and notarizing with a Developer ID can be added later.
- For Netflix, add your EVS login as the repository secrets `EVS_ACCOUNT_NAME` and `EVS_PASSWD`; without them the builds still run, without the VMP signature. On macOS it's applied before code signing (`build/vmp-sign-mac.js`), the order castLabs requires there.

The exe, window and taskbar icon is made from `logos/1_purple_gradient_badge_transparent.png`; the logo in the sidebar and settings and the installer's emblem from `logos/ultima_browser_emblem_transparent.png`. After changing either, run `npm run icons`.

### Netflix and other protected video (Widevine)

Ultima runs on [castLabs' Electron for Content Security](https://github.com/castlabs/electron-releases), a build of Electron with Google's Widevine DRM. It installs Widevine on first launch (the window waits up to 10 seconds for it) and keeps it updated. Streaming services like Netflix also require the app to carry a production **VMP signature**, which castLabs' free EVS service provides. One-time setup (needs Python 3):

```bash
npm run evs:install   # the EVS command-line client
npm run evs:signup    # create your free EVS account (or: npm run evs:login)
```

After that, `npm run dist` signs each build automatically (`build/vmp-sign.js`; set `ULTIMA_SKIP_VMP=1` to build without). To play protected video while developing with `npm start`, run `npm run vmp-sign`, and run it again whenever `npm install` replaces Electron. To check, open the [Widevine VMP Lab](https://castlabs.github.io/wv-vmp-lab/) in Ultima.

## Features

- **Vertical tabs**: **Essentials** (an icon grid shared by every space) on top, then each space's **pinned tabs**, then regular tabs. Closing an essential or pinned tab (× or `Ctrl+W`) only *unloads* it to free memory — it stays in the sidebar and reloads when clicked; right-click for Unload, Reset to pinned page, or Remove. Drag tabs between the three areas, middle-click to close, right-click for tab actions. **Folders** (right-click a tab → Add tab to new folder) gather regular or pinned tabs; drag a folder into the pinned area, or right-click it → Pin folder, to pin it with its tabs. Resizable sidebar, plus a compact icon-only mode (`Ctrl+Shift+B`).
- **Spaces**: separate sets of tabs for Personal, Work, Play and anything else you add, each with its own icon and color (the frosted sidebar takes on the space color). Switch with the icons at the bottom of the sidebar, `Ctrl+Alt+1…9`, `Ctrl+Alt+←/→` or a two-finger sideways swipe on the sidebar. Drag a tab onto a space icon to move it there. A space can keep **separate sign-ins and cookies**, so you can be logged into different accounts per space, and can have **its own Essentials** instead of the shared ones (space menu → Own Essentials, or Settings → Spaces); turning that off keeps them as pinned tabs in the space.
- **Windows**: open as many as you like (`Ctrl+N`, or a link's right-click menu). Every window shares the same sidebar — spaces, Essentials and pinned tabs stay in sync — and keeps its own regular tabs. Quitting (`Ctrl+Shift+Q`) brings every window back next time; closing windows one by one brings back the last.
- **Private browsing**: a private window (`Ctrl+Shift+N`) or a private tab in any window (`Alt+Shift+N`, or "Open link in private tab"). Private pages browse in memory only: no history, nothing saved for next time, no extensions, and their cookies and site data are deleted when the last private page closes. Downloads and bookmarks are kept.
- **Glance**: Alt+click, Shift+click, or press and hold a link to open it in a preview that grows out of the link over the page. It's a real page you can use; open it as a tab (the page carries over without reloading), put it in split view, or close it with Esc, the ×, or a click beside it. Choose which gesture opens one (or turn it off) in Settings → General.
- **Automatic tab groups** (Settings → Productivity): tabs of the same work app (Google Docs, Sheets, Drive, Gmail, Word, Excel, PowerPoint, Outlook, Teams, SharePoint, Jira, Confluence, Slack, Notion, Figma, GitHub, Linear, Asana and more) or the same website gather in a folder named and colored for it once a space has 2 or more (adjustable). Work apps can be grouped per app or per suite (Google Workspace, Microsoft 365, Atlassian); other sites are named from a list of well-known sites or from what their tabs' titles share. Renamed folders keep your name, and a tab you take out stays out. In `src/renderer/autogroup.js`.
- **Accessibility** (Settings → Accessibility): default page zoom, text size and minimum text size; page contrast and brightness, grayscale, inverted colors and color-blindness corrections (protanopia, deuteranopia, tritanopia); a strong highlight on the focused item and underlined links in pages; caret browsing (a text cursor in pages, `F7`); and higher contrast and reduced motion in Ultima itself. In `src/renderer/accessibility.js` and `src/caret-preload.js`.
- **Control Palette** (`Ctrl+K`): one box for URLs, web search, open tabs, bookmarks, history and every browser command. `Ctrl+T` opens it in "new tab" mode and `Ctrl+L` edits the current address. Start with `>` to search commands only.
- **Import** from Chrome, Edge, Brave, Vivaldi, Firefox and Zen. Profiles are detected automatically:
  | | Chromium (Chrome, Edge, Brave, Vivaldi) | Gecko (Firefox, Zen) |
  |---|---|---|
  | Bookmarks | ✓ | ✓ |
  | History (latest 25k) | ✓ | ✓ |
  | Open & pinned tabs | – | ✓ (including Zen essentials) |
  | Cookies (stay signed in) | – (encrypted per-browser) | ✓ |
  | Passwords | CSV export | CSV export |

  You can also import a bookmarks HTML file, which covers Safari, Opera, Arc and others.
- **Extensions**: install Chrome extensions straight from the Chrome Web Store (an “Add to Ultima” button appears on store pages, or paste a link in Settings → Extensions) or load an unpacked folder. Pinned extensions get toolbar buttons with their popups. Built on Electron’s extension support plus a compatibility layer that fills in what Electron lacks (`storage.sync`/`managed`, windows, opening tabs, and harmless stand-ins for other Chrome-only APIs) — Dark Reader and Bitwarden both run. Features that truly need a missing API (e.g. declarativeNetRequest blocking, page-navigation events, context-menu items) may not work.
- **Address bar menu** (`⋯` in the address bar, or `Alt+E`): History, Downloads and Extensions, your extensions with pin toggles, and “Add to Ultima” on Web Store pages.
- **Ad and tracker blocking**: Ultima's own blocker (`src/main/blocker.js`) reads EasyList and EasyPrivacy plus uBlock Origin's lists (filters, privacy, quick fixes, unbreak), downloaded while Ultima runs and kept up to date, with a short built-in list until the first download. It blocks requests in every space and in private browsing, hides the boxes ads leave behind (element hiding as a user style sheet), applies procedural rules (`:has-text`, `:upward`, `:remove`…) and runs uBlock-style scriptlets (`json-prune`, `set-constant`, `abort-on-property-read`…, in `src/blocker-preload.js`), which is what takes sponsored posts out of social feeds and ads out of YouTube. The shield in the address bar counts what it blocked on the page and opens the site's settings, where blocking can be turned off for that site. **Tracking protection** also takes tracking codes (`utm_…`, `fbclid`, `gclid`…) out of the links you open, sends Global Privacy Control, and can block third-party cookies. All of it is in Settings → Privacy.
- **Passwords**: stored encrypted with the OS keychain (`safeStorage`). Fill one from the toolbar key button, the palette, or by right-clicking a login field.
- **Site settings**: per site, choose Ask/Allow/Block for location, camera, microphone, notifications, clipboard, screen sharing and more, and Allow/Block for pop-ups, sound, images and JavaScript; see and clear a site's cookies and data. Open the current site's from the top of the address bar menu, or every site's (with defaults for all of them) in Settings → Site settings. Definitions are shared by the UI and main process in `src/renderer/sitepermissions.js`.
- **Space themes** (Arc-style): each space gets its own theme — drag 1–3 color dots on a color wheel to make a gradient, type exact hex colors, set lightness, intensity and film grain, pick Auto/Light/Dark for that space, or start from a preset. Open it from a space's ⋯ menu, right-click a space icon, or the Control Palette.
- **Loading animation**: a moving gradient inside the address bar while a page loads, fading out when it finishes. Pick its colors in Settings → Appearance (Space, Accent, Aurora, Sunset, Ocean, Candy, Rainbow, Mono) or turn it off.
- **Frosted glass**: on Windows 11 22H2+ the sidebar is one see-through frosted pane from top to bottom (Acrylic, a live blur of whatever is behind the window) in every theme. Settings → Window material switches to Mica, which tints with your wallpaper instead. macOS uses native vibrancy, and older systems fall back to solid colors. The Ultima theme also sets the native light/dark mode, so sites that follow `prefers-color-scheme` match it.
- **All Ultima, no native chrome**: right-click menus everywhere (pages, links, images, text boxes, tabs, spaces, the sidebar) are Ultima's own, with icons, submenus, your current shortcuts and keyboard navigation. So are dropdowns: every `<select>` in the UI opens Ultima's own menu (`src/renderer/dropdown.js`). Confirmation dialogs, permission prompts and tooltips are Ultima's too, and the whole UI uses **Inter** (bundled in `src/renderer/fonts`, OFL license) — web pages keep their own fonts.
- **Settings**: tabs down the left (General, Appearance, Spaces, Address bar, Keyboard shortcuts, Passwords, Privacy, Import, About) with search across all of them; each tab has its own address, e.g. `ultima://settings#spaces`.
- Session restore with lazy-loaded tabs, find in page, zoom, downloads, per-site permission prompts, dark/light/system themes with accent colors, and a choice of search engine.

## Keyboard

Every shortcut is editable in **Settings → Keyboard shortcuts** (or `Ctrl+/`). That covers global shortcuts, the keys inside the Control Palette, find bar and text boxes, and commands that have no shortcut by default. Click + to record one and × to remove one; a combo already in use moves to the new command, with Undo. Single keys (like `K` or `Shift+K`) are allowed: they fire only when you are not typing in a text box, in a page or in Ultima. These are the defaults (on a Mac, Ctrl is ⌘, except switching tabs, which stays Ctrl+Tab since ⌘Tab switches apps, and History, which is ⌘Y since ⌘H hides the app):

| Keys | Action |
|---|---|
| `Ctrl+K` / `Ctrl+Shift+P` | Control Palette |
| `Ctrl+T` / `Ctrl+L` | New tab / edit address |
| `Ctrl+W` / `Ctrl+Shift+T` | Close / reopen tab (`Ctrl+W` with no tabs left closes the window) |
| `Ctrl+N` / `Ctrl+Shift+N` / `Alt+Shift+N` | New window / private window / private tab |
| `Ctrl+Shift+Q` | Quit (every window comes back next time; ⌘Q on a Mac) |
| `Ctrl+Tab`, `Ctrl+1…9` | Switch tabs |
| `Ctrl+D` | Bookmark |
| `Ctrl+F` | Find in page |
| `Ctrl+H`, `Ctrl+Shift+O`, `Ctrl+J`, `Ctrl+,` | History, bookmarks, downloads, settings |
| `Ctrl+Shift+B` | Toggle sidebar |
| `Ctrl+Alt+1…9`, `Ctrl+Alt+←/→` | Switch space |
| `Ctrl+Shift+C` | Copy URL |
| `F12` | Developer tools |
| `Ctrl+/` | Keyboard shortcuts |

## Layout

```
src/main/main.js      window, webview hardening, shortcuts, context menus, downloads, permissions, IPC
src/main/data.js      history, bookmarks, encrypted passwords
src/main/importer.js  browser detection + bookmarks/history/tabs/cookies/CSV/HTML import
src/main/extensions.js Chrome extensions: Web Store download, CRX unpacking, registry, loading into every session
src/main/blocker.js   the ad and tracker blocker: filter list parsing, request matching, element hiding, list updates
src/blocker-preload.js, src/gpc-preload.js  page preloads: scriptlets, ad hiding, procedural rules; navigator.globalPrivacyControl
src/glance-preload.js the page side of Glance (the gestures); src/renderer/glance.js shows the preview
src/caret-preload.js  caret browsing: the text cursor in pages
src/extension-compat.js fills gaps in Electron's extension APIs inside extension workers and pages
src/preload.js        the window.ultima bridge
src/renderer/         UI: tabs.js (sidebar + webviews), palette.js, pages.js (ultima:// pages), app.js
installer/            the cinematic installer: src/ (C# host: install, uninstall, shortcuts), ui/ (the film), build.js
build/make-icons.js   every icon, from the artwork in logos/ (Windows .ico, the Mac icon, the in-app logo)
.github/workflows/    the Windows + Mac build on GitHub Actions
```

User data lives in `%APPDATA%\Ultima Browser`.

## Known limits

- Chrome and Edge open tabs aren't imported, because their session files use a binary format.
- Chromium cookies and saved passwords are encrypted for that browser alone, so passwords come in through a CSV export.
- Protected video (Netflix, Disney+…) needs the VMP signing setup above. Like Chrome, Ultima uses Widevine's software path, which Netflix typically limits to 720p.
- castLabs builds its Electron about once a month, so Chromium security fixes can reach Ultima a few weeks after standard Electron.
- No extension support yet.
- The ad blocker supports the common uBlock Origin scriptlets, not all of them (no HTML filtering, redirect resources or `$removeparam`), so a site that relies on one it lacks can still show ads. Sites change their ad tricks often; the lists catch up within hours to days.
