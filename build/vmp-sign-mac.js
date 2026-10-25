// electron-builder afterPack hook: VMP-signs the macOS app before it is code-signed, the order castLabs requires on
// macOS (Windows signs after, in vmp-sign.js).
const { signPackage } = require('./vmp-sign');

exports.default = async function vmpSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  signPackage(context.appOutDir);
};
