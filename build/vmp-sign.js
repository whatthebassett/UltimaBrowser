// VMP-signs the packaged app with castLabs EVS, so streaming services that require a production Widevine signature
// (Netflix, Disney+, Prime Video…) accept Ultima. Where it runs depends on the platform:
//   Windows: electron-builder's afterSign hook (this file), after code signing
//   macOS:   the afterPack hook (vmp-sign-mac.js), before code signing, as castLabs requires there
// One-time setup: `npm run evs:install`, then `npm run evs:signup` (or `evs:login` on another machine). On a CI machine,
// EVS_ACCOUNT_NAME and EVS_PASSWD (with EVS_NO_ASK=1) sign without a login step.
// Without it the build stops, since the app would not play those sites; set ULTIMA_SKIP_VMP=1 to build anyway
// (protected video then only works on test servers).
const { execFileSync } = require('child_process');

function signPackage(appOutDir) {
  if (process.env.ULTIMA_SKIP_VMP) {
    console.warn('  • VMP signing skipped (ULTIMA_SKIP_VMP): Netflix and similar sites won’t play in this build');
    return;
  }
  const python = process.env.ULTIMA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  try {
    execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir], { stdio: 'inherit' });
  } catch (err) {
    throw new Error(`VMP signing failed (${err.message.split('\n')[0]}).\n`
      + 'Set up castLabs EVS once with `npm run evs:install` and `npm run evs:signup` (or `npm run evs:login`),\n'
      + 'or build without it by setting ULTIMA_SKIP_VMP=1.');
  }
}

exports.signPackage = signPackage;

// afterSign: everything but macOS (signed in afterPack instead)
exports.default = async function vmpSign(context) {
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas') return;
  signPackage(context.appOutDir);
};
