// Tools for the page in a tab: screenshots (renderer/screenshot.js draws the picking), Reader view (renderer/reader.js
// shows the article) and translation (renderer/translate.js offers it). main.js wires them to the UI.
const fs = require('fs');
const path = require('path');
const { clipboard, ClipboardItem, nativeImage, net } = require('electron');

const MAX_PAGE_HEIGHT = 16384; // a whole-page screenshot stops here (Chromium's largest image)

// "Screenshot 2026-11-03 at 14.05.09.png", or with " (2)"… when there's one already
function screenshotFile(dir) {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const base = `Screenshot ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} at ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`;
  for (let n = 1; ; n += 1) {
    const file = path.join(dir, `${base}${n > 1 ? ` (${n})` : ''}.png`);
    if (!fs.existsSync(file)) return file;
  }
}

// The whole page, beyond what's on screen, through the DevTools protocol (as Chrome's own full-size screenshot does)
async function capturePage(wc) {
  const dbg = wc.debugger;
  const ours = !dbg.isAttached();
  if (ours) dbg.attach('1.3');
  try {
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const clip = { x: 0, y: 0, width: Math.max(1, Math.ceil(size.width)), height: Math.max(1, Math.min(Math.ceil(size.height), MAX_PAGE_HEIGHT)), scale: 1 };
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
  } finally {
    if (ours) try { dbg.detach(); } catch { /* gone */ }
  }
}

// A screenshot of a tab's page: `rect` (in the page's view, as the UI drew it) for part of it, `full` for all of it,
// neither for what's on screen. It's copied, and saved as a PNG in `dir`.
async function takeScreenshot(wc, { rect, full } = {}, dir) {
  let img;
  if (full) img = await capturePage(wc);
  else if (rect) {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (r.width < 1 || r.height < 1) throw new Error('Nothing was picked');
    img = await wc.capturePage(r);
  } else img = await wc.capturePage();
  if (img.isEmpty()) throw new Error('The page had nothing to show');
  const png = img.toPNG();
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  fs.mkdirSync(dir, { recursive: true });
  const file = screenshotFile(dir);
  fs.writeFileSync(file, png);
  const { width, height } = img.getSize();
  return { file, name: path.basename(file), folder: path.basename(dir) || dir, width, height };
}

// ---------- Reader view ----------
// Mozilla's Readability (vendor/readability, as Firefox's Reader View uses) runs in a world of its own in the page, apart
// from the page's scripts: on a copy of the page, so the page itself isn't touched.
const READER_WORLD = 1201;
const vendor = (file) => fs.readFileSync(path.join(__dirname, '..', 'vendor', 'readability', file), 'utf8');
let readerCode = null;
const readerScripts = () => (readerCode ||= { readerable: vendor('Readability-readerable.js'), readability: vendor('Readability.js') });

// whether the page looks like an article (for the address bar's Reader view button)
async function isArticle(wc) {
  const code = `${readerScripts().readerable}
;isProbablyReaderable(document, { minContentLength: 140, minScore: 20 });`;
  try { return Boolean(await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code }])); } catch { return false; }
}

// The page's article: its title, byline, site and text (as HTML, which the window cleans before showing), or null
async function readArticle(wc) {
  const code = `${readerScripts().readability}
;(() => {
  const a = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
  if (!a || !a.content) return null;
  return { title: a.title || document.title, byline: a.byline, siteName: a.siteName, content: a.content, excerpt: a.excerpt,
    lang: a.lang || document.documentElement.lang || '', dir: a.dir || '', length: a.length, publishedTime: a.publishedTime, url: location.href };
})();`;
  return wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code }]);
}

// ---------- translation ----------
// The page's text goes to Google Translate (as Chrome's translation does), in blocks with their formatting as numbered
// tags (translate-page.js, which runs in the page in a world of its own and puts the translations back).
const TRANSLATE_WORLD = 1202;
const TRANSLATE_URL = process.env.ULTIMA_TRANSLATE_URL || 'https://translate.googleapis.com/translate_a/t?client=gtx'; // (tests use their own)
let pageTranslator = null;
const translated = new Map(); // webContents id → { from, to }: the pages translated now

// texts → [{ text, lang }], in batches Google takes (by count and length), a few at a time. `from`: the language
// they're in, if known ('auto' has Google guess each one, and a lone word can pass for another language).
async function translateTexts(texts, to, from = 'auto') {
  const batches = [];
  let cur = [];
  let len = 0;
  for (const t of texts) {
    if (cur.length && (cur.length >= 100 || len + t.length > 4500)) { batches.push(cur); cur = []; len = 0; }
    cur.push(t);
    len += t.length;
  }
  if (cur.length) batches.push(cur);
  const one = async (batch) => {
    const res = await net.fetch(`${TRANSLATE_URL}&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: batch.map((t) => `q=${encodeURIComponent(t)}`).join('&'),
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'Google Translate is busy. Try again in a minute.' : `Google Translate answered ${res.status}.`);
    let data = await res.json();
    if (batch.length === 1 && typeof data[0] === 'string') data = [data]; // (one text can come back on its own)
    return batch.map((t, i) => (Array.isArray(data[i]) ? { text: String(data[i][0]), lang: data[i][1] || null } : { text: typeof data[i] === 'string' ? data[i] : t, lang: null }));
  };
  const out = [];
  for (let i = 0; i < batches.length; i += 4) out.push(...(await Promise.all(batches.slice(i, i + 4).map(one))).flat());
  return out;
}

// Translates the page into `to` (a language code), from `from` if the page says what it's in; with `more`, only what's
// new on it since. → { from, to, count }
async function translatePage(wc, { to, from, more = false }) {
  if (more && !translated.has(wc.id)) return null;
  const run = (code) => wc.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD, [{ code }]);
  pageTranslator ||= fs.readFileSync(path.join(__dirname, '..', 'translate-page.js'), 'utf8');
  await run(pageTranslator);
  const langs = {};
  let count = 0;
  for (let round = 0; round < 40; round += 1) {
    const items = await run('__ultimaTr.collect(300)');
    if (!items?.length) break;
    // the page's language: as it says, or as Google finds most of its text is once some has gone
    const known = from || translated.get(wc.id)?.from || Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0];
    const out = await translateTexts(items, to, known || 'auto');
    await run(`__ultimaTr.apply(${JSON.stringify(out.map((o) => o.text))})`);
    // the language most of the text is in (by length: a page's many short names and references don't outvote it)
    out.forEach((o, i) => { if (o.lang) langs[o.lang] = (langs[o.lang] || 0) + items[i].length; });
    count += items.length;
  }
  const found = from || Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] || translated.get(wc.id)?.from || null;
  translated.set(wc.id, { from: found, to });
  return { from: found, to, count };
}

async function showOriginal(wc) {
  translated.delete(wc.id);
  try { await wc.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD, [{ code: 'window.__ultimaTr ? __ultimaTr.restore() : false' }]); } catch { /* the page went */ }
}

// the page's language, as it says itself (<html lang>), for offering to translate it
async function pageLanguage(wc) {
  const code = "document.documentElement.lang || document.querySelector('meta[http-equiv=content-language i]')?.content || ''";
  try { return String((await wc.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD, [{ code }])) || ''); } catch { return ''; }
}

const translationOf = (wc) => translated.get(wc.id) || null;
const forgetTranslation = (wc) => translated.delete(wc.id); // a new page in the tab

module.exports = { takeScreenshot, isArticle, readArticle, translatePage, showOriginal, pageLanguage, translationOf, forgetTranslation };
