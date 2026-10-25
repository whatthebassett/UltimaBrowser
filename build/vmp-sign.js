// electron-builder afterSign hook: VMP-signs the packaged app with castLabs EVS, so streaming services that require a
// production Widevine signature (Netflix, Disney+, Prime Video…) accept Ultima. It runs after code signing, the order
// Windows needs. One-time setup: `npm run evs:install`, then `npm run evs:signup` (or `evs:login` on another machine).
// Without it the build stops here, since the installer would not play those sites; set ULTIMA_SKIP_VMP=1 to build
// anyway (protected video then only works on test servers).
const { execFileSync } = require('child_process');

exports.default = async function vmpSign(context) {
  if (process.env.ULTIMA_SKIP_VMP) {
    console.warn('  • VMP signing skipped (ULTIMA_SKIP_VMP): Netflix and similar sites won’t play in this build');
    return;
  }
  const python = process.env.ULTIMA_PYTHON || 'python';
  try {
    execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  } catch (err) {
    throw new Error(`VMP signing failed (${err.message.split('\n')[0]}).\n`
      + 'Set up castLabs EVS once with `npm run evs:install` and `npm run evs:signup` (or `npm run evs:login`),\n'
      + 'or build without it by setting ULTIMA_SKIP_VMP=1.');
  }
};
