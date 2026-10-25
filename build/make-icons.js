// Makes every Ultima icon from the artwork in logos/: run `npm run icons` after changing it. Each picture is cropped to a
// square round its visible pixels, then each size is drawn from the full resolution picture, so the small taskbar sizes
// stay crisp.
//   logos/1_purple_gradient_badge_transparent.png  the app icon: a white U on a purple badge, which holds up on a dark
//                                                   taskbar where the bare purple emblem disappeared
//     assets/icon.ico            exe, window and taskbar icon (16…256)
//     assets/icon.png            256 px, for electron-builder and anything that wants a PNG
//     assets/icon-mac.png        1024 px on Apple's icon grid (the badge at ~80%, as macOS icons sit), for the .icns
//   logos/ultima_browser_emblem_transparent.png    the bare emblem
//     src/renderer/logo.png      the logo in the sidebar and settings
//     installer/ui/emblem.png    the installer's title card
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pictures = {
  badge: { file: path.join(root, 'logos', '1_purple_gradient_badge_transparent.png'), margin: 1.03 },
  emblem: { file: path.join(root, 'logos', 'ultima_browser_emblem_transparent.png'), margin: 1.08 },
};
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// [size, picture, share of the canvas the picture fills (1 = edge to edge)]
const pngs = { [path.join(root, 'assets', 'icon.png')]: [256, 'badge'], [path.join(root, 'assets', 'icon-mac.png')]: [1024, 'badge', 0.805], [path.join(root, 'src', 'renderer', 'logo.png')]: [128, 'emblem'], [path.join(root, 'installer', 'ui', 'emblem.png')]: [640, 'emblem'] };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-icons-'));

// [size, file, picture, fill]
const jobs = [...icoSizes.map((s) => [s, path.join(tmp, `${s}.png`), 'badge', 1]), ...Object.entries(pngs).map(([out, [s, pic, fill = 1]]) => [s, out, pic, fill])];
const ps = `Add-Type -AssemblyName System.Drawing
  # a picture and the square round its visible pixels, with room to spare (margin: the square's size over theirs)
  function Load($file, $margin) {
    $b = [System.Drawing.Bitmap]::FromFile($file)
    $data = $b.LockBits((New-Object System.Drawing.Rectangle 0, 0, $b.Width, $b.Height), 'ReadOnly', 'Format32bppArgb')
    $bytes = New-Object byte[] ($data.Stride * $b.Height); [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length); $b.UnlockBits($data)
    $minX = $b.Width; $minY = $b.Height; $maxX = 0; $maxY = 0
    for ($y = 0; $y -lt $b.Height; $y++) { $row = $y * $data.Stride; for ($x = 0; $x -lt $b.Width; $x++) {
      if ($bytes[$row + $x * 4 + 3] -gt 8) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }; if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y } } } }
    $side = [int]([Math]::Max($maxX - $minX + 1, $maxY - $minY + 1) * $margin)
    return @{ Bitmap = $b; Crop = (New-Object System.Drawing.Rectangle ([int](($minX + $maxX - $side) / 2)), ([int](($minY + $maxY - $side) / 2)), $side, $side) }
  }
  $pictures = @{ ${Object.entries(pictures).map(([k, p]) => `'${k}' = (Load '${p.file}' ${p.margin})`).join('; ')} }
  foreach ($job in @(${jobs.map(([s, out, pic, fill]) => `@(${s}, '${out}', '${pic}', ${fill})`).join(', ')})) {
    $s = $job[0]; $pic = $pictures[$job[2]]; $w = [int]($s * $job[3]); $o = [int](($s - $w) / 2)
    $d = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($d)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
    $g.DrawImage($pic.Bitmap, (New-Object System.Drawing.Rectangle $o, $o, $w, $w), $pic.Crop, [System.Drawing.GraphicsUnit]::Pixel)
    $d.Save($job[1], [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $d.Dispose() }
  foreach ($p in $pictures.Values) { $p.Bitmap.Dispose() }`;
execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });

// The .ico: PNG-compressed entries, as Windows has read since Vista
const images = icoSizes.map((s) => fs.readFileSync(path.join(tmp, `${s}.png`)));
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s % 256, e);
  header.writeUInt8(s % 256, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), Buffer.concat([header, ...images]));
fs.rmSync(tmp, { recursive: true, force: true });

for (const f of ['assets/icon.ico', ...Object.keys(pngs).map((p) => path.relative(root, p))]) {
  console.log(`  ${f.replace(/\\/g, '/')}  ${(fs.statSync(path.join(root, f)).size / 1024).toFixed(0)} KB`);
}
