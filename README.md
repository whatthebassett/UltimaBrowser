<div align="center">

<img src="logos/ultima_browser_emblem_transparent.png" alt="Ultima" width="128">

# Ultima Browser

**The browser that moves at your speed.**

Vertical tabs, orbits for every part of your life, a built-in ad blocker and a palette that finds anything,
all on the Chromium engine your favorite sites already work with.

### [⬇ Download Ultima](https://github.com/whatthebassett/UltimaBrowser/releases/latest)

Windows 10 and 11 &nbsp;·&nbsp; macOS on Apple Silicon &nbsp;·&nbsp; Free

<br>

<img src="docs/images/browser.jpg" alt="Ultima with vertical tabs, Essentials and a tab folder" width="860">

</div>

<br>

## What's new in 0.6.0

Phishing warnings, a much quicker start, and opt-in crash reports. If you're already on Ultima, it updates itself next time you close it, or now from Settings → About.

### Dangerous site warnings

Open a known phishing site and Ultima stops it before it loads, with a **Dangerous site ahead** page in its place. **Back to safety** or **Continue anyway**, your call.

- The check runs on your computer against [Phishing.Database](https://github.com/mitchellkrogza/Phishing.Database)'s list of active phishing domains, which Ultima keeps up to date in the background. Nothing you visit gets sent off to be looked up.
- Downloads from those sites are blocked too.
- Try it at `phishing-test.ultimabrowser.invalid`.
- On by default; turn it off in Settings → Privacy.

### Faster start

Ultima opens about twice as fast. The window no longer waits on extensions or Widevine before it appears, the ad blocker loads from a saved copy instead of re-parsing its filter lists every launch, and a couple of slow startup checks are gone. In our testing the window's up in about half a second, and it opens with your theme and tabs already drawn.

### Crash reports

Ultima can send crash and error reports to help us fix things faster. Off unless you turn it on in Settings → Privacy. No IP addresses and no browsing history, though a crash dump can include bits of whatever was open at the time.

### Mini player

- Only opens when you send a video to it, not whenever a background tab starts playing.
- Portrait videos resize properly and the player stays on screen.
- Docked in the sidebar, it has a handle to set its height so your tabs stay visible.

### Also new

- Ultima's own icons for the minimize, maximize and close buttons, with snap layouts still working.
- Fixed dragging the window from the row of buttons at the top of the sidebar.

[Every release](https://github.com/whatthebassett/UltimaBrowser/releases)

<br>

## Your tabs, standing tall

Tabs live down the side, where long titles fit and dozens of tabs stay readable. Prefer them across the top? Switch to **horizontal tabs** in a click. The sites you use every day sit at the top as **Essentials**, one click away in every space. **Pinned tabs** stay put, folders keep projects together, and Ultima can even **group tabs for you**: your Google Docs, Jira tickets or Slack channels gather in their own named folder on their own.

## An orbit for everything

<img src="docs/images/spaces.jpg" alt="Making an orbit your own" width="100%">

Keep **Work**, **Personal** and **Play** apart, each with its own tabs, its own color gradient, and if you like, its own sign-ins, so your work and personal accounts never mix. Swipe between orbits with two fingers or a shortcut.

## Everything, one keystroke away

Press **Ctrl+K** and the **Control Palette** finds open tabs, history, Waypoints (your bookmarks) and every command in Ultima. Or type an address, or just search.

## Peek before you leap

**Glance** opens a link in a preview right over the page, with Alt+click, Shift+click or a long press. Read it, use it, then close it, keep it as a tab, or put it **side by side** in split view.

## Fewer ads, no one following you

Ultima blocks ads and trackers out of the box, including video ads and sponsored posts, using the same lists as uBlock Origin. It takes the tracking codes out of links you open and asks sites not to sell your data. One click on the shield turns it off for a site you want to support. Known phishing sites get a warning before they load.

## Ready from the first minute

<img src="docs/images/essentials.jpg" alt="Picking your Essentials" width="100%">

A short welcome sets Ultima up with you: light or dark, your colors, your first orbit, and **Essentials** picked from popular sites like Google Drive, Microsoft 365, Slack, Spotify, Apple Music, Netflix and dozens more. It brings over your bookmarks, history and open tabs from Chrome, Edge, Brave, Vivaldi or Firefox in one click, too.

## And a lot more

- **Movie night, sorted.** Netflix, Disney+, Prime Video and other streaming services play right in Ultima.
- **Chrome extensions.** Install them straight from the Chrome Web Store.
- **Read and translate.** Reader view strips an article down to its words, and one click translates a page into your language.
- **Screenshots** of part of a page, what's on screen, or the whole page, copied and saved in one go.
- **Private windows and tabs** that leave nothing behind when you close them.
- **Passwords** saved on your computer, encrypted with your Windows account or Mac Keychain.
- **Make it yours.** Accent colors, frosted-glass sidebar, your choice of font and tab size, and every keyboard shortcut is yours to change.
- **Accessibility** built in: page zoom, text size, contrast, color filters for color blindness, caret browsing and reduced motion.
- **Task manager** (Shift+Esc) to see what each tab uses and end the ones that misbehave.
- **Crash reports,** only if you want them, so problems get fixed sooner.
- **More than one window**, all sharing your orbits and Essentials, and everything comes back when you reopen Ultima.

<br>

## Install

**Windows 10 or 11**

1. Download **Ultima Browser Setup.exe** from the [latest release](https://github.com/whatthebassett/UltimaBrowser/releases/latest).
2. Open it and click **Install**. It installs just for you; no administrator rights needed.
3. If Windows shows *“Windows protected your PC”*, click **More info → Run anyway**. Ultima is new and not yet signed with a paid certificate.

**macOS (Apple Silicon)**

1. Download the **.dmg** from the [latest release](https://github.com/whatthebassett/UltimaBrowser/releases/latest) and drag Ultima to Applications.
2. The first time you open it, macOS asks you to allow it: go to **System Settings → Privacy & Security** and click **Open Anyway**.

**Updating:** Ultima updates itself. New versions download in the background and install when you close Ultima, or right away from **Settings → About → Restart to update**. Your tabs, Waypoints, passwords and settings stay right where they are.

## Roadmap

What's still to come, roughly in order.

**Safety**
- [x] Warnings for phishing sites and their downloads, checked on your computer.
- [ ] Warnings for malware sites and dangerous files.
- [ ] Signed installers, so Windows and macOS stop warning on first install.

**Everyday browsing**
- [x] Translate pages.
- [x] Reader view for articles.
- [x] Screenshots of a page or part of one.
- [x] Bring over open tabs from Chrome and Edge.

**Passwords and forms**
- [ ] Fill logins inside embedded sign-in forms.
- [ ] Save and fill addresses and payment cards.

**Extensions**
- [ ] Userscript managers like Tampermonkey.
- [ ] Extensions that act on the current tab when you click them (activeTab), like Google Translate.
- [ ] Extension shortcuts that work when Ultima isn't in front.

**Your stuff everywhere**
- [ ] Sync Waypoints, passwords, orbits and settings across your devices, end-to-end encrypted.

**Under the hood**
- [x] Opt-in crash reports.
- [x] Automated tests for tabs, sessions, the ad blocker and import.

## Questions

**Is Ultima free?** Yes.

**Where is my data kept?** On your computer, in your user folder. Ultima has no account and no cloud; your history, Waypoints and passwords never leave your PC.

**Will my sites work?** Ultima runs on Chromium, the engine behind Chrome and Edge, so sites work as they do there.

**Why is Netflix limited to 720p?** Like Chrome, Ultima uses the software version of Widevine, which Netflix caps at 720p on desktop browsers.

**How do I uninstall it?** Windows: Settings → Apps → Ultima Browser → Uninstall. Your data is kept unless you choose to delete it.

<br>

<div align="center">

**[Download Ultima](https://github.com/whatthebassett/UltimaBrowser/releases/latest)** &nbsp;·&nbsp; [What's new](https://github.com/whatthebassett/UltimaBrowser/releases) &nbsp;·&nbsp; [For developers](DEVELOPING.md)

</div>
