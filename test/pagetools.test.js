// Page tools: screenshots (part of the page, what's on screen, the whole page) and Reader view.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, serve, removeProfile } = require('./harness');

// a PNG's size, from its header
const pngSize = (file) => { const b = fs.readFileSync(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };

let app;
let web;
let downloads;
before(async () => {
  web = await serve({
    // an article, with a site menu, an ad, a script and an inline handler around it
    '/article': () => `<!doctype html><html lang="en"><title>The quiet comet</title>
      <nav class="menu"><a href="/page/home">Site menu</a> <a href="/page/about">About us</a></nav>
      <aside class="ad">Buy a telescope today!</aside>
      <main><article><h1>The quiet comet</h1><p class="byline">By Ada Stone</p>
      ${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1}. The comet came back after seventy-six years, slower and dimmer than the stories said, and the town stayed up to watch it cross the sky above the hills. Nobody spoke much; the children counted the seconds between the flashes.</p>`).join('')}
      <p>Read <a href="/page/linked">what happened next</a>, or <a href="/page/other" onclick="document.title='clicked'">another story</a>.</p>
      <script>window.fromArticle = 1;</script></article></main>
      <footer>Copyright footer</footer>`,
    '/tall': '<!doctype html><title>Tall page</title><style>body{margin:0}div{height:1000px}</style><div style="background:#e33"></div><div style="background:#3a3"></div><div style="background:#36e"></div>',
  });
  downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-test-downloads-'));
  app = await launch({ settings: { downloadDir: downloads, autoGroup: false } });
  await app.ui((url) => { createTab({ url }); return true; }, `${web.origin}/tall`);
  await app.waitFor(() => activeTab()?.title === 'Tall page' && !activeTab().loading, { what: 'the page to load' });
});
after(async () => { await app?.close(); await web?.close(); removeProfile(downloads); });

test('the screenshot picker covers the page and goes away with Esc', async () => {
  await app.ui(() => { openScreenshot(); return true; });
  const cover = await app.ui(() => {
    const a = document.querySelector('.shot').getBoundingClientRect();
    const b = activeTab().webview.getBoundingClientRect();
    return [a.left === b.left, a.top === b.top, a.width === b.width, a.height === b.height];
  });
  assert.deepEqual(cover, [true, true, true, true]);
  await app.ui(() => { document.querySelector('.shot').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; });
  assert.equal(await app.ui(() => Boolean(document.querySelector('.shot'))), false);
});

test('takes the part of the page you pick, and saves it', async () => {
  const shot = await app.ui(() => captureScreenshot({ rect: { x: 10, y: 20, width: 200, height: 100 } }));
  assert.ok(shot, 'it was taken');
  assert.equal(path.dirname(shot.file), downloads);
  assert.match(shot.name, /^Screenshot \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d( \(\d+\))?\.png$/);
  const dpr = await app.ui(() => devicePixelRatio);
  const size = pngSize(shot.file);
  assert.ok(Math.abs(size.width - 200 * dpr) <= 2 && Math.abs(size.height - 100 * dpr) <= 2, `${size.width}×${size.height} at ${dpr}x`);
});

test('saves screenshots in the folder chosen for them, and back where downloads go', async () => {
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-test-shots-'));
  try {
    const page = await app.ui(() => activeTab().id);
    await app.ui((dir) => applySettings({ screenshotDir: dir }), mine);
    const shot = await app.ui(() => captureScreenshot({ rect: { x: 0, y: 0, width: 50, height: 50 } }));
    assert.equal(path.dirname(shot.file), mine);
    assert.equal(shot.folder, path.basename(mine));
    // Settings shows it, with a way back
    await app.ui(() => { openInternal('settings'); return true; });
    await app.waitFor((d) => document.querySelector('[data-shot-reset]') && document.body.innerText.includes(d), { what: 'the folder in Settings' }, mine);
    await app.ui(() => { document.querySelector('[data-shot-reset]').click(); return true; });
    await app.waitFor(() => B.screenshotDir?.isDefault && !document.querySelector('[data-shot-reset]'), { what: 'the folder to be reset' });
    const back = await app.ui((id) => { const s = activeTab(); activateTab(id); closeTab(s.id, { remove: true, animate: false }); return captureScreenshot({ rect: { x: 0, y: 0, width: 50, height: 50 } }); }, page);
    assert.equal(path.dirname(back.file), downloads);
    fs.rmSync(back.file);
  } finally { removeProfile(mine); }
});

test('takes what’s on screen, and the whole page beyond it', async () => {
  const visible = await app.ui(() => captureScreenshot({}));
  const whole = await app.ui(() => captureScreenshot({ full: true }));
  const [v, w] = [pngSize(visible.file), pngSize(whole.file)];
  const view = await app.ui(() => { const r = activeTab().webview.getBoundingClientRect(); return { width: r.width * devicePixelRatio, height: r.height * devicePixelRatio }; });
  assert.ok(Math.abs(v.width - view.width) <= 2 && Math.abs(v.height - view.height) <= 2, `on screen: ${v.width}×${v.height}, the view ${view.width}×${view.height}`);
  assert.ok(w.height > v.height * 1.5, `the whole page (${w.height} high) is taller than what's on screen (${v.height})`);
  assert.equal(fs.readdirSync(downloads).filter((f) => f.endsWith('.png')).length, 3, 'each one saved, none overwritten');
});

// opens a page in the test tab (the one open), waiting until it has loaded
async function go(url) {
  await app.ui((u) => { navigate(activeTab(), u); return true; }, url);
  await app.waitFor((u) => activeTab()?.url === u && !activeTab().loading && activeTab().ready, { what: `${url} to load` }, url);
}
// the Reader view's document, read from the window
const readerDoc = (fn) => app.ui(`(${fn})(document.querySelector('.reader-view iframe').contentDocument)`);

test('the address bar shows the book on an article, and not on other pages', async () => {
  await go(`${web.origin}/article`);
  await app.waitFor(() => !document.querySelector('#btn-reader').hidden, { what: 'the Reader view button' });
  await go(`${web.origin}/page/1`);
  await app.waitFor(() => activeTab().readerable === false && document.querySelector('#btn-reader').hidden, { what: 'the button to go' });
});

test('Reader view shows just the article, over the page, with nothing that runs', async () => {
  await go(`${web.origin}/article`);
  await app.ui(() => openReader());
  await app.waitFor(() => document.querySelector('.reader-view iframe')?.contentDocument?.querySelector('h1'), { what: 'the article' });
  const over = await app.ui(() => {
    const a = document.querySelector('.reader-view').getBoundingClientRect();
    const b = activeTab().webview.getBoundingClientRect();
    return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  });
  assert.equal(over, true, 'it covers the page');
  const got = await readerDoc((d) => ({
    title: d.querySelector('h1').textContent,
    byline: d.querySelector('.byline').textContent,
    paragraphs: d.querySelectorAll('.content p').length,
    text: d.body.textContent,
    scripts: d.querySelectorAll('script').length,
    handlers: [...d.querySelectorAll('*')].some((el) => [...el.attributes].some((a) => a.name.startsWith('on'))),
  }));
  assert.equal(got.title, 'The quiet comet');
  assert.match(got.byline, /Ada Stone/);
  assert.ok(got.paragraphs >= 8, `${got.paragraphs} paragraphs`);
  for (const gone of ['Site menu', 'Buy a telescope', 'Copyright footer']) assert.ok(!got.text.includes(gone), `"${gone}" is left out`);
  assert.equal(got.scripts, 0);
  assert.equal(got.handlers, false);
  await app.waitFor(() => document.querySelector('#btn-reader').classList.contains('on'), { what: 'the book to show it is on' });
});

test('the text gets bigger and the colors change, and both are kept', async () => {
  const size = await readerDoc((d) => parseInt(d.body.style.getPropertyValue('--size'), 10));
  await app.ui(() => { document.querySelector('.rv-bar [data-reader="bigger"]').click(); document.querySelector('.rv-bar [data-theme="sepia"]').click(); return true; });
  assert.equal(await readerDoc((d) => parseInt(d.body.style.getPropertyValue('--size'), 10)), size + 1);
  assert.equal(await readerDoc((d) => d.body.className), 'sepia');
  assert.deepEqual(await app.ui(() => [B.settings.readerSize, B.settings.readerTheme]), [size + 1, 'sepia']);
});

test('a link in the article opens in the tab, leaving Reader view', async () => {
  await readerDoc((d) => { d.querySelector('a[href$="/page/linked"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); return true; });
  await app.waitFor((u) => activeTab().url === u, { what: 'the link to open' }, `${web.origin}/page/linked`);
  assert.equal(await app.ui(() => Boolean(document.querySelector('.reader-view')) || Boolean(activeTab().reader)), false);
});

test('Reader view closes again from its button or the command', async () => {
  await go(`${web.origin}/article`);
  await app.ui(() => openReader());
  await app.waitFor(() => Boolean(document.querySelector('.reader-view')));
  await app.ui(() => { document.querySelector('.rv-bar [data-reader="close"]').click(); return true; });
  assert.equal(await app.ui(() => Boolean(document.querySelector('.reader-view'))), false);
  await app.ui(() => runCommand('reader'));
  await app.waitFor(() => Boolean(document.querySelector('.reader-view')), { what: 'the command to open it' });
  await app.ui(() => runCommand('reader'));
  assert.equal(await app.ui(() => Boolean(document.querySelector('.reader-view'))), false);
});
