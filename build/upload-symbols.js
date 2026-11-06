// Uploads Electron's debug symbols to Ultima's Sentry project, so native crash reports (see src/main/crashreports.js)
// show which functions crashed instead of bare addresses. Run it once for each Electron version Ultima ships with: now,
// and after every Electron upgrade.
//   $env:SENTRY_AUTH_TOKEN = "<token>"   (PowerShell; in Command Prompt: set SENTRY_AUTH_TOKEN=<token>) — an organization
//   token from Sentry → Settings → Organization Tokens; or save it once with `npx @sentry/cli login`
//   npm run upload-symbols                         this computer's platform (Windows x64 here)
//   npm run upload-symbols -- win32-x64 darwin-arm64   the platforms named
//   npm run upload-symbols -- --no-upload          download and unpack only (to check)
// Ultima runs on castLabs' Electron, which publishes the symbols with each release (electron-v<version>-<platform>-
// symbols.zip, Breakpad format); they're downloaded once into the system's temp folder and uploaded with sentry-cli.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ORG = 'ultima-apps';
const PROJECT = 'ultima-browser';
const SENTRY_CLI = '@sentry/cli@3.8.2';

const args = process.argv.slice(2);
const upload = !args.includes('--no-upload');
const platforms = args.filter((a) => !a.startsWith('--'));
if (!platforms.length) platforms.push(`${process.platform}-${process.arch}`);

const version = require('../node_modules/electron/package.json').version; // e.g. 44.9.3+wvcus
// the token: SENTRY_AUTH_TOKEN, or one saved by `npx @sentry/cli login` (in ~/.sentryclirc, which sentry-cli reads itself)
const token = process.env.SENTRY_AUTH_TOKEN;
const saved = (() => { try { return /^\s*token\s*=\s*\S/m.test(fs.readFileSync(path.join(os.homedir(), '.sentryclirc'), 'utf8')); } catch { return false; } })();
if (upload && !token && !saved) {
  console.error([
    'No Sentry token. Make an organization token in Sentry (Settings → Organization Tokens), then either:',
    '  PowerShell:      $env:SENTRY_AUTH_TOKEN = "<token>"   (then run this again in the same window)',
    '  Command Prompt:  set SENTRY_AUTH_TOKEN=<token>',
    `  or save it once: npx ${SENTRY_CLI} login`,
  ].join('\n'));
  process.exit(1);
}

async function download(url, file) {
  if (fs.existsSync(file)) { console.log(`  already downloaded: ${path.basename(file)}`); return; }
  console.log(`  downloading ${path.basename(file)}…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
}

(async () => {
  const dir = path.join(os.tmpdir(), 'ultima-electron-symbols', version);
  fs.mkdirSync(dir, { recursive: true });
  for (const platform of platforms) {
    const name = `electron-v${version}-${platform}-symbols.zip`;
    console.log(`Electron ${version}, ${platform}`);
    const zip = path.join(dir, name);
    await download(`https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(version)}/${name}`, zip);
    const out = path.join(dir, platform);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(out, { recursive: true });
      // Windows' own tar (10 and later) and macOS's read zips; on Windows it's named in full, as Git Bash puts its own tar first
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      execFileSync(tar, ['-xf', zip, '-C', out], { stdio: 'inherit' });
    }
    const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : e.name.endsWith('.sym') ? 1 : 0), 0);
    console.log(`  ${count(out)} symbol files in ${out}`);
    if (!upload) continue;
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', SENTRY_CLI, 'debug-files', 'upload', '--org', ORG, '--project', PROJECT, out], {
      stdio: 'inherit', shell: process.platform === 'win32',
    });
  }
  console.log(upload ? 'Done: native crash reports from this Electron version will be readable.' : 'Downloaded and unpacked; nothing uploaded.');
})().catch((err) => { console.error(err.message || err); process.exit(1); });
