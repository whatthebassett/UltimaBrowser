// Builds the cinematic installer, dist/Ultima Browser Setup <version>.exe:
//   1. the app, packaged and VMP-signed by electron-builder (dist/win-unpacked; see build/vmp-sign.js)
//   2. packed into a zip
//   3. the setup program (installer/, .NET Framework 4.8 + WebView2), with Ultima's icon and font
//   4. joined into one exe: [setup][zip][manifest][lengths]["ULTIMAP1"] (read back by src/Payload.cs)
// Options: --reuse  use the app already in dist/win-unpacked instead of packaging it again.
// ULTIMA_SKIP_VMP=1 passes through to the signing step, as with electron-builder.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const obj = path.join(__dirname, 'obj');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const exeName = `${pkg.build.productName}.exe`;
const out = path.join(root, 'dist', `${pkg.build.productName} Setup ${pkg.version}.exe`);
const reuse = process.argv.includes('--reuse');

const step = (msg) => console.log(`\n▸ ${msg}`);
// (npx is a .cmd script on Windows, so it needs the shell; everything else runs directly)
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: cmd === 'npx' && process.platform === 'win32', ...opts });
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

fs.mkdirSync(obj, { recursive: true });

// 1. the app
if (reuse && fs.existsSync(path.join(unpacked, exeName))) step('Using the app already in dist/win-unpacked');
else {
  step('Packaging Ultima (electron-builder, VMP-signed)');
  run('npx', ['electron-builder', '--win', '--dir']);
}
if (!fs.existsSync(path.join(unpacked, exeName))) throw new Error(`${exeName} wasn't found in dist/win-unpacked`);
if (!fs.existsSync(path.join(unpacked, `${exeName}.sig`))) console.warn('  ! no VMP signature next to the app: Netflix and similar sites won’t play in this build');

// 2. the zip
step('Packing the app');
const zip = path.join(obj, 'payload.zip');
fs.rmSync(zip, { force: true });
// Windows' own tar (bsdtar) makes zips; a GNU tar earlier on PATH (Git Bash) can't, and reads "C:" as a host
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', unpacked, '.'], { stdio: 'inherit' });
const unpackedBytes = walk(unpacked).reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`  ${mb(unpackedBytes)} → ${mb(fs.statSync(zip).size)}`);

// 3. the setup program: its icon and the scene's font, then the build
step('Building the setup program');
const extra = path.join(obj, 'ui-extra', 'fonts');
fs.rmSync(path.join(obj, 'ui-extra'), { recursive: true, force: true });
fs.mkdirSync(extra, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src', 'renderer', 'fonts'))) {
  if (/^inter\.css$|latin-wght-normal\.woff2$|latin-ext-wght-normal\.woff2$|LICENSE/.test(f)) fs.copyFileSync(path.join(root, 'src', 'renderer', 'fonts', f), path.join(extra, f));
}
fs.copyFileSync(path.join(root, 'assets', 'icon.ico'), path.join(obj, 'setup.ico')); // made by build/make-icons.js
run('dotnet', ['build', '-c', 'Release', '-nologo', '-v', 'minimal'], { cwd: __dirname });
const setupExe = path.join(__dirname, 'bin', 'Release', 'UltimaSetup.exe');

// 4. one exe
step('Assembling the installer');
const manifest = Buffer.from(JSON.stringify({
  ProductName: pkg.build.productName,
  Version: pkg.version,
  ExeName: exeName,
  AppId: pkg.build.appId,
  Publisher: 'UltimaBass',
  RegistryKey: pkg.build.productName.replace(/\s+/g, ''),
  UnpackedBytes: unpackedBytes,
}), 'utf8');
const trailer = Buffer.alloc(24);
trailer.writeBigInt64LE(BigInt(manifest.length), 0);
trailer.writeBigInt64LE(BigInt(fs.statSync(zip).size), 8);
trailer.write('ULTIMAP1', 16, 'ascii');
fs.mkdirSync(path.dirname(out), { recursive: true });
// assembled beside the old one, then swapped in: Defender or Explorer (reading its icon) often holds a fresh exe for a
// moment, so the swap waits that out
const tmp = `${out}.part`;
const pause = () => execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
const retry = (what, fn) => {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code) || i === 40) throw new Error(`${what} stayed in use (is it running?): ${e.message}`);
      pause();
    }
  }
};
retry(path.relative(root, tmp), () => fs.rmSync(tmp, { force: true }));
// written through one handle, start to finish: reopening it to append gives a scanner a moment to grab it
const fd = fs.openSync(tmp, 'w');
try { for (const part of [fs.readFileSync(setupExe), fs.readFileSync(zip), manifest, trailer]) fs.writeSync(fd, part); } finally { fs.closeSync(fd); }
retry(path.relative(root, out), () => fs.renameSync(tmp, out));
console.log(`\n✓ ${path.relative(root, out)}  (${mb(fs.statSync(out).size)})`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
