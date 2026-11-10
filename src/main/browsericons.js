// The browsers Ultima imports from (Settings → Import, the welcome screen) show with their own app icons, taken from
// where each is installed: on Windows the largest picture in the program's icon (browsers carry a 256px one), read
// straight from its .exe; on macOS the app's icon; on Linux the icon theme's. A browser that isn't installed (its
// profile can outlive it) has none, and the page draws one for it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { app, nativeImage } = require('electron');

const SIZE = 96; // px: sharp at the 38px the pages show them, at up to 250% display scaling

// Each browser and test channel (importer.js): on Windows its program and the folders it installs to (for everyone,
// or for you alone); on macOS its app; on Linux its icon's names (the distribution's package, then Flatpak's). A Beta
// or Nightly that isn't installed shows its browser's icon (a profile of one can outlive it, or share a folder with it).
const EXE = {
  chrome: ['chrome.exe'], edge: ['msedge.exe'], brave: ['brave.exe'], vivaldi: ['vivaldi.exe'], firefox: ['firefox.exe'], zen: ['zen.exe'],
  opera: ['opera.exe', 'launcher.exe'], arc: ['Arc.exe'],
};
// Store apps (Arc): their package's name; where it's installed is asked of Windows
const STORE = { arc: 'TheBrowserCompany.Arc' };
const WIN = {
  chrome: ['Google\\Chrome\\Application'],
  'chrome-beta': ['Google\\Chrome Beta\\Application'],
  'chrome-dev': ['Google\\Chrome Dev\\Application'],
  'chrome-canary': ['Google\\Chrome SxS\\Application'],
  edge: ['Microsoft\\Edge\\Application'],
  'edge-beta': ['Microsoft\\Edge Beta\\Application'],
  'edge-dev': ['Microsoft\\Edge Dev\\Application'],
  'edge-canary': ['Microsoft\\Edge SxS\\Application'],
  brave: ['BraveSoftware\\Brave-Browser\\Application'],
  'brave-beta': ['BraveSoftware\\Brave-Browser-Beta\\Application'],
  'brave-nightly': ['BraveSoftware\\Brave-Browser-Nightly\\Application'],
  vivaldi: ['Vivaldi\\Application'],
  'vivaldi-snapshot': ['Vivaldi Snapshot\\Application'],
  firefox: ['Mozilla Firefox'],
  'firefox-nightly': ['Firefox Nightly'],
  'firefox-dev': ['Firefox Developer Edition'],
  zen: ['Zen Browser', 'Zen'],
  'zen-twilight': ['Zen Twilight'],
  opera: ['Programs\\Opera'],
  'opera-gx': ['Programs\\Opera GX'],
  arc: [], // (STORE)
};
const MAC = {
  chrome: ['Google Chrome'], 'chrome-beta': ['Google Chrome Beta'], 'chrome-dev': ['Google Chrome Dev'], 'chrome-canary': ['Google Chrome Canary'],
  edge: ['Microsoft Edge'], 'edge-beta': ['Microsoft Edge Beta'], 'edge-dev': ['Microsoft Edge Dev'], 'edge-canary': ['Microsoft Edge Canary'],
  brave: ['Brave Browser'], 'brave-beta': ['Brave Browser Beta'], 'brave-nightly': ['Brave Browser Nightly'],
  vivaldi: ['Vivaldi'], 'vivaldi-snapshot': ['Vivaldi Snapshot'],
  firefox: ['Firefox'], 'firefox-nightly': ['Firefox Nightly'], 'firefox-dev': ['Firefox Developer Edition'],
  zen: ['Zen', 'Zen Browser'], 'zen-twilight': ['Zen Twilight'],
  opera: ['Opera'], 'opera-gx': ['Opera GX'], arc: ['Arc'], dia: ['Dia'], safari: ['Safari'],
};
const LINUX = {
  chrome: ['google-chrome', 'com.google.Chrome'], 'chrome-beta': ['google-chrome-beta'], 'chrome-dev': ['google-chrome-unstable'], 'chrome-canary': ['google-chrome-canary'],
  edge: ['microsoft-edge', 'com.microsoft.Edge'], 'edge-beta': ['microsoft-edge-beta'], 'edge-dev': ['microsoft-edge-dev'],
  brave: ['brave-browser', 'com.brave.Browser'], 'brave-beta': ['brave-browser-beta'], 'brave-nightly': ['brave-browser-nightly'],
  vivaldi: ['vivaldi', 'com.vivaldi.Vivaldi'], 'vivaldi-snapshot': ['vivaldi-snapshot'],
  firefox: ['firefox', 'org.mozilla.firefox'], 'firefox-nightly': ['firefox-nightly'], 'firefox-dev': ['firefox-developer-edition'],
  zen: ['zen-browser', 'zen', 'app.zen_browser.zen'], 'zen-twilight': ['zen-twilight'],
  opera: ['opera', 'com.opera.Opera'],
};
const familyOf = (browser) => browser.split('-')[0]; // chrome-beta → chrome

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const exec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
});

// ---- Windows: the icon inside an .exe ----
// An .exe keeps its icons as resources: an icon group (type 14) lists the pictures (type 3) in each size. The first
// group is the one Windows shows for the program.
function exeIcon(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 64 || buf.readUInt16LE(0) !== 0x5a4d) return null; // "MZ"
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) return null; // "PE\0\0"
  const sections = buf.readUInt16LE(pe + 6);
  const opt = pe + 24;
  const dataDirs = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96); // (64-bit, 32-bit)
  const rsrc = buf.readUInt32LE(dataDirs + 2 * 8);
  if (!rsrc) return null;
  const table = opt + buf.readUInt16LE(pe + 20);
  const offsetOf = (rva) => {
    for (let i = 0; i < sections; i += 1) {
      const s = table + i * 40;
      const va = buf.readUInt32LE(s + 12);
      if (rva >= va && rva < va + Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16))) return rva - va + buf.readUInt32LE(s + 20);
    }
    return -1;
  };
  const base = offsetOf(rsrc);
  if (base < 0) return null;
  const entries = (at) => {
    const n = buf.readUInt16LE(at + 12) + buf.readUInt16LE(at + 14);
    return Array.from({ length: n }, (_, i) => {
      const name = buf.readUInt32LE(at + 16 + i * 8);
      const to = buf.readUInt32LE(at + 20 + i * 8);
      return { id: name & 0x80000000 ? null : name, at: base + (to & 0x7fffffff), dir: Boolean(to & 0x80000000) };
    });
  };
  // a resource's bytes: past its name and language, whichever come first
  const bytesOf = (e) => {
    let x = e;
    while (x?.dir) [x] = entries(x.at);
    if (!x) return null;
    const at = offsetOf(buf.readUInt32LE(x.at));
    return at < 0 ? null : buf.subarray(at, at + buf.readUInt32LE(x.at + 4));
  };
  const top = entries(base);
  const groups = top.find((e) => e.id === 14 && e.dir);
  const icons = top.find((e) => e.id === 3 && e.dir);
  if (!groups || !icons) return null;
  const group = bytesOf(entries(groups.at)[0]);
  if (!group || group.length < 6) return null;
  const pics = Array.from({ length: group.readUInt16LE(4) }, (_, i) => {
    const e = 6 + i * 14;
    return { w: group[e] || 256, h: group[e + 1] || 256, colors: group[e + 2], planes: group.readUInt16LE(e + 4), bits: group.readUInt16LE(e + 6), id: group.readUInt16LE(e + 12) };
  }).sort((a, b) => b.w - a.w || b.bits - a.bits);
  for (const pic of pics) {
    const data = bytesOf(entries(icons.at).find((e) => e.id === pic.id));
    if (!data) continue;
    if (data.readUInt32BE(0) === 0x89504e47) return nativeImage.createFromBuffer(Buffer.from(data)); // a PNG
    // an older bitmap picture: made into a one-picture .ico, which Windows can read
    const ico = Buffer.alloc(22);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(1, 4);
    ico[6] = pic.w % 256; ico[7] = pic.h % 256; ico[8] = pic.colors;
    ico.writeUInt16LE(pic.planes, 10);
    ico.writeUInt16LE(pic.bits, 12);
    ico.writeUInt32LE(data.length, 14);
    ico.writeUInt32LE(22, 18);
    const tmp = path.join(os.tmpdir(), `ultima-icon-${process.pid}-${pic.id}.ico`);
    try { fs.writeFileSync(tmp, Buffer.concat([ico, data])); return nativeImage.createFromPath(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  }
  return null;
}

let registered = null; // the programs registered as browsers (Default Apps), read once
async function registeredBrowsers() {
  if (!registered) {
    registered = Promise.all(['HKLM\\SOFTWARE\\Clients\\StartMenuInternet', 'HKCU\\SOFTWARE\\Clients\\StartMenuInternet', 'HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet']
      .map((key) => exec('reg', ['query', key, '/s'])))
      .then((outs) => [...new Set(outs.join('\n').match(/[a-z]:\\[^"\r\n,]*?\.exe/gi) || [])]);
  }
  return registered;
}

// a Store app's programs, in the folder Windows installed its package to
async function storeAppExes(browser) {
  const name = STORE[familyOf(browser)];
  if (!name) return [];
  const dir = (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AppxPackage -Name '${name}' | Select-Object -First 1).InstallLocation`])).trim();
  return dir ? EXE[familyOf(browser)].map((e) => path.join(dir, e)).filter(exists) : [];
}

async function windowsIcon(browser) {
  const family = familyOf(browser);
  const exes = EXE[family].map((e) => e.toLowerCase());
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.LOCALAPPDATA].filter(Boolean);
  const reg = (await registeredBrowsers()).filter((p) => exes.includes(path.basename(p).toLowerCase()) && exists(p));
  // where this channel installs, or is registered from; then its browser's (any channel of it)
  const places = (b) => [
    ...roots.flatMap((r) => (WIN[b] || []).flatMap((d) => EXE[family].map((e) => path.join(r, d, e)))).filter(exists),
    ...reg.filter((p) => (WIN[b] || []).some((d) => path.dirname(p).toLowerCase().endsWith(`\\${d}`.toLowerCase()))),
  ];
  const found = [...new Set([...places(browser), ...places(family), ...reg, ...(await storeAppExes(browser))])];
  for (const file of found) {
    try { const img = exeIcon(file); if (img && !img.isEmpty()) return img; } catch { /* not readable: try the next */ }
  }
  for (const file of found) { // Windows' own copy of its icon, smaller
    try { const img = await app.getFileIcon(file, { size: 'large' }); if (!img.isEmpty()) return img; } catch { /* next */ }
  }
  return null;
}

async function macIcon(browser) {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  for (const name of new Set([...(MAC[browser] || []), ...(MAC[familyOf(browser)] || [])])) {
    for (const d of dirs) {
      const bundle = path.join(d, `${name}.app`);
      if (!fs.existsSync(bundle)) continue;
      try { const img = await nativeImage.createThumbnailFromPath(bundle, { width: SIZE * 2, height: SIZE * 2 }); if (!img.isEmpty()) return img; } catch { /* below */ }
      try { const img = await app.getFileIcon(bundle, { size: 'normal' }); if (!img.isEmpty()) return img; } catch { /* next */ }
    }
  }
  return null;
}

function linuxIcon(browser) {
  const bases = [path.join(os.homedir(), '.local/share'), '/usr/local/share', '/usr/share', '/var/lib/flatpak/exports/share', path.join(os.homedir(), '.local/share/flatpak/exports/share'), '/var/lib/snapd/desktop']
    .map((b) => path.join(b, 'icons/hicolor'));
  for (const name of new Set([...(LINUX[browser] || []), ...(LINUX[familyOf(browser)] || [])])) {
    for (const b of bases) {
      for (const size of ['256x256', '128x128', '96x96', '64x64', '48x48']) {
        const file = path.join(b, size, 'apps', `${name}.png`);
        if (exists(file)) return nativeImage.createFromPath(file);
      }
      const svg = path.join(b, 'scalable', 'apps', `${name}.svg`);
      if (exists(svg)) return `data:image/svg+xml;base64,${fs.readFileSync(svg).toString('base64')}`;
    }
    const pixmap = `/usr/share/pixmaps/${name}.png`;
    if (exists(pixmap)) return nativeImage.createFromPath(pixmap);
  }
  return null;
}

const cache = new Map(); // browser → Promise of a data: URL, or null
function iconFor(browser) {
  const known = { win32: WIN, darwin: MAC }[process.platform] || LINUX;
  if (!known[browser] && !known[familyOf(browser)]) return Promise.resolve(null);
  if (!cache.has(browser)) {
    cache.set(browser, (async () => {
      const img = process.platform === 'win32' ? await windowsIcon(browser) : process.platform === 'darwin' ? await macIcon(browser) : linuxIcon(browser);
      if (!img) return null;
      if (typeof img === 'string') return img;
      if (img.isEmpty()) return null;
      const { width } = img.getSize();
      return (width > SIZE ? img.resize({ width: SIZE, height: SIZE, quality: 'best' }) : img).toDataURL();
    })().catch(() => null));
  }
  return cache.get(browser);
}

// { browser: data: URL } for those that have one
async function browserIcons(browsers) {
  const list = [...new Set(browsers)];
  const icons = await Promise.all(list.map(iconFor));
  return Object.fromEntries(list.map((b, i) => [b, icons[i]]).filter(([, url]) => url));
}

module.exports = { browserIcons, exeIcon };
