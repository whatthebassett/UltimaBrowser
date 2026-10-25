// Renders the disk image background (background.html) to build/background.png (540×380) and background@2x.png
// (1080×760), which electron-builder merges into one Retina image. Run with `npm run dmg-background`.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 540;
const H = 380;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true } });
  for (const scale of [1, 2]) {
    win.setContentSize(W * scale, H * scale);
    await win.loadFile(path.join(__dirname, 'background.html'));
    win.webContents.setZoomFactor(scale);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: W * scale, height: H * scale });
    const out = path.join(__dirname, '..', scale === 1 ? 'background.png' : 'background@2x.png');
    fs.writeFileSync(out, image.toPNG());
    const { width, height } = image.getSize();
    console.log(`  ${path.relative(path.join(__dirname, '..', '..'), out).replace(/\\/g, '/')}  ${width}×${height}`);
  }
  win.destroy();
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
