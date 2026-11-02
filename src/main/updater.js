// Ultima keeps itself up to date from its GitHub releases (.github/workflows/build.yml publishes them on a version tag).
// Soon after start and every few hours it asks GitHub for the latest release; a newer one downloads quietly to
// <userData>/updates and installs when Ultima quits, or right away with "Restart to update".
//   Windows: the release's setup program, run with --silent (installer/: it waits for Ultima to close, installs over it
//            in the same folder and, for a restart, starts it again).
//   macOS:   the release's Apple Silicon zip, unpacked beside the download; a small script swaps the app over once
//            Ultima has quit (the app is ad-hoc signed, so macOS's own updater (Squirrel) can't be used).
// Only installed copies update: not `npm start`, not dist/win-unpacked. ULTIMA_UPDATE_FEED points the check at
// another releases URL (for testing).
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'whatthebassett/UltimaBrowser';
const FEED = process.env.ULTIMA_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`;
const FIRST_CHECK = 30 * 1000;
const EVERY = 4 * 60 * 60 * 1000;
const RESTART_MARK = 'update-restart'; // left in userData by "Restart to update": the next start counts as a restart

// "1.10.2" is newer than "1.9"
function isNewer(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// the release file this copy installs from (GitHub turns the spaces in their names into dots)
function assetFor(release) {
  const pick = (re) => (release.assets || []).find((a) => re.test(a.name));
  if (process.platform === 'win32') return pick(/Setup[ .][\d.]+\.exe$/i);
  if (process.platform === 'darwin' && process.arch === 'arm64') return pick(/-arm64\.zip$/i);
  return null;
}

// <something>/Ultima Browser.app on a Mac, the install folder on Windows
function appLocation(app) {
  if (process.platform === 'darwin') return path.resolve(path.dirname(app.getPath('exe')), '..', '..');
  return path.dirname(app.getPath('exe'));
}

function canUpdate(app) {
  if (process.env.ULTIMA_UPDATE_FEED) return true;
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return fs.existsSync(path.join(appLocation(app), 'Uninstall Ultima Browser.exe'));
  // run straight from Downloads, macOS runs a read-only copy somewhere random ("App Translocation"): nothing to replace
  if (process.platform === 'darwin') return process.arch === 'arm64' && !app.getPath('exe').includes('/AppTranslocation/');
  return false;
}

function initUpdater({ app, net, broadcast }) {
  const dir = path.join(app.getPath('userData'), 'updates');
  const current = app.getVersion();
  const enabled = canUpdate(app);
  // status: idle · checking · downloading · ready · current · error · off
  let state = { status: enabled ? 'idle' : 'off', current, version: null, progress: 0 };
  let ready = null; // { version, file } once downloaded (and unpacked, on a Mac)
  let checking = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    broadcast('update-state', state);
  };

  // the last download, if it's still newer than this copy; older ones are cleared away
  function readyOnDisk() {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'ready.json'), 'utf8'));
      if (isNewer(saved.version, current) && fs.existsSync(saved.file)) return saved;
    } catch { /* none */ }
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }

  async function download(asset, file) {
    const res = await net.fetch(asset.browser_download_url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const part = `${file}.part`;
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    const total = asset.size || Number(res.headers.get('content-length')) || 0;
    let got = 0;
    let shown = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((r) => { out.once('drain', r); });
        if (total && got / total - shown >= 0.01) { shown = got / total; set({ progress: shown }); }
      }
      await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
    } catch (err) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw err;
    }
    // GitHub gives each release file's SHA-256: a damaged or swapped download is thrown away
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '')?.[1];
    if ((asset.size && got !== asset.size) || (digest && digest.toLowerCase() !== hash.digest('hex'))) {
      fs.rmSync(part, { force: true });
      throw new Error('The download was damaged');
    }
    fs.renameSync(part, file);
  }

  // macOS: the zip unpacked beside it, ready to swap in
  async function unpack(zip) {
    const into = path.join(dir, 'app');
    fs.rmSync(into, { recursive: true, force: true });
    await new Promise((resolve, reject) => { execFile('/usr/bin/ditto', ['-x', '-k', zip, into], (err) => (err ? reject(err) : resolve())); });
    const bundle = fs.readdirSync(into).find((f) => f.endsWith('.app'));
    if (!bundle) throw new Error('No app in the update');
    fs.rmSync(zip, { force: true });
    return path.join(into, bundle);
  }

  async function runCheck() {
    if (!enabled) return state;
    if (ready) return state;
    set({ status: 'checking' });
    try {
      const res = await net.fetch(FEED, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const release = await res.json();
      const version = String(release.tag_name || '').replace(/^v/i, '');
      const asset = assetFor(release);
      if (release.draft || release.prerelease || !isNewer(version, current) || !asset) { set({ status: 'current', version: null }); return state; }
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      set({ status: 'downloading', version, progress: 0 });
      let file = path.join(dir, asset.name);
      await download(asset, file);
      if (process.platform === 'darwin') file = await unpack(file);
      ready = { version, file };
      fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify(ready));
      set({ status: 'ready', version, progress: 1 });
    } catch (err) {
      set({ status: 'error', error: String(err?.message || err) });
    }
    return state;
  }
  const check = () => { checking ||= runCheck().finally(() => { checking = null; }); return checking; };

  // hands over to the installer, which waits for Ultima to close; with restart, Ultima starts again afterwards
  function startInstall(restart) {
    if (!ready) return false;
    const update = ready;
    ready = null; // once only, even if quitting comes through here again
    if (restart) fs.writeFileSync(path.join(app.getPath('userData'), RESTART_MARK), String(Date.now()));
    if (process.platform === 'win32') {
      const args = ['--silent', '--dir', appLocation(app)];
      // keeps your choice: a desktop shortcut stays only if you have one
      if (!fs.existsSync(path.join(app.getPath('desktop'), 'Ultima Browser.lnk'))) args.push('--no-desktop-shortcut');
      if (restart) args.push('--launch');
      spawn(update.file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      // swap the app once this process (and so Ultima) has ended, putting the old one back if that fails
      const script = `while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$3.old"
if mv "$3" "$3.old"; then if mv "$2" "$3"; then rm -rf "$3.old"; else mv "$3.old" "$3"; fi; fi
xattr -dr com.apple.quarantine "$3" 2>/dev/null
[ "$4" = 1 ] && open "$3"`;
      spawn('/bin/sh', ['-c', script, 'ultima-update', String(process.pid), update.file, appLocation(app), restart ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  }

  if (enabled) {
    ready = readyOnDisk();
    if (ready) state = { ...state, status: 'ready', version: ready.version, progress: 1 };
    setTimeout(check, FIRST_CHECK);
    setInterval(check, EVERY);
  }

  return {
    state: () => state,
    check,
    // "Restart to update": quit now; the installer starts the new Ultima
    restart() { if (startInstall(true)) app.quit(); },
    // Ultima is quitting: a downloaded update installs now (call from will-quit)
    installOnQuit() { startInstall(false); },
    // started by "Restart to update": counts as a restart (your windows and tabs come back), once
    restarted() {
      const mark = path.join(app.getPath('userData'), RESTART_MARK);
      try {
        const at = Number(fs.readFileSync(mark, 'utf8'));
        fs.rmSync(mark, { force: true });
        return Date.now() - at < 10 * 60 * 1000;
      } catch { return false; }
    },
  };
}

module.exports = { initUpdater, isNewer };
