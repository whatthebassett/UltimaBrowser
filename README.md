# Ultima Browser

A Chromium-based desktop browser (castLabs Electron for Content Security 44 / Chromium 152, for Widevine) with vertical tabs, a keyboard-first **Control Palette**, and one-click import from your other browsers.

```bash
npm install
npm start          # run in development
npm run dist       # build a Windows installer into dist/
```

### Netflix and other protected video (Widevine)

Ultima runs on [castLabs' Electron for Content Security](https://github.com/castlabs/electron-releases), a build of Electron with Google's Widevine DRM. It installs Widevine on first launch (the window waits up to 10 seconds for it) and keeps it updated. Streaming services like Netflix also require the app to carry a production **VMP signature**, which castLabs' free EVS service provides. One-time setup (needs Python 3):

```bash
npm run evs:install   # the EVS command-line client
npm run evs:signup    # create your free EVS account (or: npm run evs:login)
```

After that, `npm run dist` signs each build automatically (`build/vmp-sign.js`; set `ULTIMA_SKIP_VMP=1` to build without). To play protected video while developing with `npm start`, run `npm run vmp-sign`, and run it again whenever `npm install` replaces Electron. To check, open the [Widevine VMP Lab](https://castlabs.github.io/wv-vmp-lab/) in Ultima.

## Features

- **Vertical tabs**: **Essentials** (an icon grid shared by every space) on top, then each space's **pinned tabs**, then regular tabs. Closing an essential or pinned tab (× or `Ctrl+W`) only *unloads* it to free memory — it stays in the sidebar and reloads when clicked; right-click for Unload, Reset to pinned page, or Remove. Drag tabs between the three areas, middle-click to close, right-click for tab actions. Resizable sidebar, plus a compact icon-only mode (`Ctrl+Shift+B`).
- **Spaces**: separate sets of tabs for Personal, Work, Play and anything else you add, each with its own icon and color (the frosted sidebar takes on the space color). Switch with the icons at the bottom of the sidebar, `Ctrl+Alt+1…9`, `Ctrl+Alt+←/→` or a two-finger sideways swipe on the sidebar. Drag a tab onto a space icon to move it there. A space can keep **separate sign-ins and cookies**, so you can be logged into different accounts per space.
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
- **Passwords**: stored encrypted with the OS keychain (`safeStorage`). Fill one from the toolbar key button, the palette, or by right-clicking a login field.
- **Space themes** (Arc-style): each space gets its own theme — drag 1–3 color dots on a color wheel to make a gradient, type exact hex colors, set lightness, intensity and film grain, pick Auto/Light/Dark for that space, or start from a preset. Open it from a space's ⋯ menu, right-click a space icon, or the Control Palette.
- **Loading animation**: a moving gradient inside the address bar while a page loads, fading out when it finishes. Pick its colors in Settings → Appearance (Space, Accent, Aurora, Sunset, Ocean, Candy, Rainbow, Mono) or turn it off.
- **Frosted glass**: on Windows 11 22H2+ the sidebar is one see-through frosted pane from top to bottom (Acrylic, a live blur of whatever is behind the window) in every theme. Settings → Window material switches to Mica, which tints with your wallpaper instead. macOS uses native vibrancy, and older systems fall back to solid colors. The Ultima theme also sets the native light/dark mode, so sites that follow `prefers-color-scheme` match it.
- **All Ultima, no native chrome**: right-click menus everywhere (pages, links, images, text boxes, tabs, spaces, the sidebar) are Ultima's own, with icons, submenus, your current shortcuts and keyboard navigation. Confirmation dialogs, permission prompts and tooltips are Ultima's too, and the whole UI uses **Inter** (bundled in `src/renderer/fonts`, OFL license) — web pages keep their own fonts.
- **Settings**: tabs down the left (General, Appearance, Spaces, Address bar, Keyboard shortcuts, Passwords, Privacy, Import, About) with search across all of them; each tab has its own address, e.g. `ultima://settings#spaces`.
- Session restore with lazy-loaded tabs, find in page, zoom, downloads, per-site permission prompts, dark/light/system themes with accent colors, and a choice of search engine.

## Keyboard

Every shortcut is editable in **Settings → Keyboard shortcuts** (or `Ctrl+/`). That covers global shortcuts, the keys inside the Control Palette, find bar and text boxes, and commands that have no shortcut by default. Click + to record one and × to remove one; a combo already in use moves to the new command, with Undo. Single keys (like `K` or `Shift+K`) are allowed: they fire only when you are not typing in a text box, in a page or in Ultima. These are the defaults:

| Keys | Action |
|---|---|
| `Ctrl+K` / `Ctrl+Shift+P` | Control Palette |
| `Ctrl+T` / `Ctrl+L` | New tab / edit address |
| `Ctrl+W` / `Ctrl+Shift+T` | Close / reopen tab |
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
src/extension-compat.js fills gaps in Electron's extension APIs inside extension workers and pages
src/preload.js        the window.ultima bridge
src/renderer/         UI: tabs.js (sidebar + webviews), palette.js, pages.js (ultima:// pages), app.js
```

User data lives in `%APPDATA%\Ultima Browser`.

## Known limits

- Chrome and Edge open tabs aren't imported, because their session files use a binary format.
- Chromium cookies and saved passwords are encrypted for that browser alone, so passwords come in through a CSV export.
- Protected video (Netflix, Disney+…) needs the VMP signing setup above. Like Chrome, Ultima uses Widevine's software path, which Netflix typically limits to 720p.
- castLabs builds its Electron about once a month, so Chromium security fixes can reach Ultima a few weeks after standard Electron.
- No extension support yet.
