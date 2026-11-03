// Reader view: an article without the rest of the page (ads, menus, sidebars), in a clean column you can make bigger
// or smaller, light, sepia or dark. The address bar shows a book on pages that look like articles; Reader view in the
// Control Palette, the address bar menu or a page's right-click menu opens it too. Mozilla's Readability finds the
// article (pagetools.js); it's shown here over the page, in a frame where no script can run, after a second cleaning.
const READER_THEMES = { light: 'Light', sepia: 'Sepia', dark: 'Dark' };
const READER_SIZES = [15, 16, 17, 18, 19, 20, 22, 24, 26, 28];

const readerTheme = () => (READER_THEMES[B.settings.readerTheme] ? B.settings.readerTheme : document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const readerSize = () => (READER_SIZES.includes(B.settings.readerSize) ? B.settings.readerSize : 19);
const readerEl = (tab) => $(`#viewport .reader-view[data-reader-tab="${tab.id}"]`);

// What's left of the article's HTML: text, links, pictures, lists, tables, quotes and code, nothing that runs or
// loads a page (the frame it's shown in can't run scripts either)
function cleanArticle(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  doc.querySelectorAll('script, style, iframe, frame, frameset, object, embed, applet, form, input, button, select, textarea, link, meta, base, noscript, template, dialog, portal').forEach((el) => el.remove());
  for (const el of doc.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      const v = a.value.trim();
      const url = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'cite', 'longdesc'].includes(n);
      if (n.startsWith('on') || n === 'style' || n === 'srcdoc' || (url && !/^(https?:|#|mailto:)/i.test(v) && !(n === 'src' && /^data:image\//i.test(v)))) el.removeAttribute(a.name);
    }
  }
  return doc.body.innerHTML;
}

const READER_CSS = `
  :root { color-scheme: light; --bg: #fbfaf8; --text: #1f1f22; --soft: #66666e; --line: #e4e2dd; --link: #2f5fd0; }
  body.sepia { --bg: #f5eddb; --text: #4a3b2a; --soft: #7d6a52; --line: #e3d6ba; --link: #8a4b14; }
  body.dark { color-scheme: dark; --bg: #1b1b1f; --text: #e6e6e9; --soft: #9a9aa3; --line: #34343a; --link: #8ab4ff; }
  html { background: var(--bg); }
  body { margin: 0; padding: 56px 28px 96px; background: var(--bg); color: var(--text); font: var(--size)/1.65 Charter, 'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif; -webkit-font-smoothing: antialiased; }
  article { max-width: 680px; margin: 0 auto; overflow-wrap: break-word; }
  .site { margin: 0 0 10px; color: var(--soft); font: 600 13px/1.4 system-ui, 'Segoe UI', sans-serif; letter-spacing: 0.02em; text-transform: uppercase; }
  h1 { margin: 0 0 12px; font-size: 1.9em; line-height: 1.2; letter-spacing: -0.01em; }
  .byline { margin: 0 0 28px; padding-bottom: 22px; border-bottom: 1px solid var(--line); color: var(--soft); font: 14px/1.5 system-ui, 'Segoe UI', sans-serif; }
  h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 0.5em; }
  p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1.1em; }
  a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  img, video, picture { max-width: 100%; height: auto; border-radius: 6px; }
  figure { margin-left: 0; margin-right: 0; }
  figcaption { color: var(--soft); font: 13px/1.45 system-ui, 'Segoe UI', sans-serif; margin-top: 6px; }
  blockquote { margin-left: 0; padding-left: 18px; border-left: 3px solid var(--line); color: var(--soft); }
  pre, code { font: 0.85em/1.5 ui-monospace, Consolas, monospace; }
  pre { padding: 12px 14px; border-radius: 8px; overflow-x: auto; background: color-mix(in srgb, var(--text) 6%, transparent); }
  table { border-collapse: collapse; display: block; overflow-x: auto; font-size: 0.9em; }
  td, th { border: 1px solid var(--line); padding: 6px 9px; text-align: left; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
`;

function readerDocument(a) {
  const minutes = Math.max(1, Math.round((a.length || 0) / 1100));
  const site = [a.siteName || hostname(a.url), `${minutes} min read`].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="${esc(a.lang || '')}" dir="${a.dir === 'rtl' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(a.title || '')}</title>
    <style>${READER_CSS}</style></head><body class="${readerTheme()}" style="--size: ${readerSize()}px">
    <article><p class="site">${esc(site)}</p><h1>${esc(a.title || '')}</h1>${a.byline ? `<p class="byline">${esc(a.byline)}</p>` : '<p class="byline" hidden></p>'}
    <div class="content">${cleanArticle(a.content)}</div></article></body></html>`;
}

function readerBarHtml() {
  const theme = readerTheme();
  return `<button class="icon-btn" data-reader="smaller" title="Smaller text"><span class="rv-a small">A</span></button>
    <button class="icon-btn" data-reader="bigger" title="Bigger text"><span class="rv-a">A</span></button>
    <span class="rv-sep"></span>
    ${Object.entries(READER_THEMES).map(([k, label]) => `<button class="rv-swatch ${k} ${k === theme ? 'on' : ''}" data-reader="theme" data-theme="${k}" title="${label}"></button>`).join('')}
    <span class="rv-sep"></span>
    <button class="icon-btn" data-reader="close" title="${esc(withKey('Leave Reader view', 'reader'))}">${icon('close', 15)}</button>`;
}

async function openReader(tab = activeTab()) {
  if (!tab || !ready(tab) || isInternal(tab.url)) return toast('Reader view works on articles on the web');
  let article = null;
  try { article = await window.ultima.readArticle(tab.webview.getWebContentsId()); } catch { /* the page went */ }
  if (!article) return toast('This page doesn’t have an article to read');
  if (!tab.webview) return undefined;
  readerEl(tab)?.remove();
  tab.reader = { url: tab.url };
  const el = h(`<div class="reader-view" data-reader-tab="${tab.id}"><div class="rv-bar">${readerBarHtml()}</div>
    <iframe sandbox="allow-same-origin" title="Reader view"></iframe></div>`);
  $('#viewport').append(el);
  const frame = $('iframe', el);
  frame.addEventListener('load', () => wireReaderFrame(tab, frame), { once: true });
  frame.srcdoc = readerDocument(article);
  el.addEventListener('click', (e) => onReaderBar(tab, e));
  new ResizeObserver(() => syncReaderViews()).observe(tab.webview);
  syncReaderViews();
  updateChrome();
  return undefined;
}

// Links: a click opens the page in the tab (leaving Reader view), Ctrl/Cmd or middle click in a new tab
function wireReaderFrame(tab, frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const follow = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return; // a place in the article
    e.preventDefault();
    if (!/^(https?:|mailto:)/i.test(a.href)) return;
    if (e.button === 1 || e.ctrlKey || e.metaKey) createTab({ url: a.href, opener: tab, activate: false });
    else if (e.button === 0) { closeReader(tab); navigate(tab, a.href); }
  };
  doc.addEventListener('click', follow);
  doc.addEventListener('auxclick', follow);
}

function onReaderBar(tab, e) {
  const b = e.target.closest('[data-reader]');
  if (!b) return;
  const act = b.dataset.reader;
  if (act === 'close') { closeReader(tab); return; }
  if (act === 'theme') applySettings({ readerTheme: b.dataset.theme });
  else {
    const i = READER_SIZES.indexOf(readerSize());
    applySettings({ readerSize: READER_SIZES[Math.max(0, Math.min(READER_SIZES.length - 1, i + (act === 'bigger' ? 1 : -1)))] });
  }
  restyleReaders();
}

// a new size or colors, in every Reader view open (in other windows too: applySettingsFromElsewhere → applyTheme)
function restyleReaders() {
  for (const el of $$('#viewport .reader-view')) {
    const body = $('iframe', el).contentDocument?.body;
    if (body) { body.className = readerTheme(); body.style.setProperty('--size', `${readerSize()}px`); }
    $('.rv-bar', el).innerHTML = readerBarHtml();
  }
}

function closeReader(tab) {
  if (!tab) return;
  readerEl(tab)?.remove();
  if (!tab.reader) return;
  tab.reader = null;
  if (tab.id === B.activeId) { updateChrome(); setTimeout(() => tab.webview?.focus(), 0); }
}

const toggleReader = (tab = activeTab()) => (tab?.reader ? closeReader(tab) : openReader(tab));

// Each Reader view sits exactly over its tab's page, and only while that page is showing
function syncReaderViews() {
  for (const el of $$('#viewport .reader-view')) {
    const tab = tabById(Number(el.dataset.readerTab));
    const wv = tab?.webview;
    if (!tab?.reader || !wv) { el.remove(); continue; }
    el.hidden = wv.classList.contains('hidden');
    if (el.hidden) continue;
    const vp = el.parentElement;
    const [a, b] = [wv.getBoundingClientRect(), vp.getBoundingClientRect()];
    Object.assign(el.style, { left: `${a.left - b.left - vp.clientLeft}px`, top: `${a.top - b.top - vp.clientTop}px`, width: `${a.width}px`, height: `${a.height}px` });
  }
}

// The address bar's book: on pages that look like articles (asked once a page has loaded), and while reading
async function updateReaderButton(tab = activeTab()) {
  const btn = $('#btn-reader');
  if (!btn) return;
  const show = (on) => {
    btn.hidden = !on;
    btn.classList.toggle('on', Boolean(tab?.reader));
    btn.title = withKey(tab?.reader ? 'Leave Reader view' : 'Reader view', 'reader');
  };
  if (!tab || isInternal(tab.url) || !/^https?:/.test(tab.url)) { show(false); return; }
  if (tab.reader) { show(true); return; }
  if (tab.readerable === undefined && ready(tab) && !tab.loading) {
    tab.readerable = null; // (asking)
    const url = tab.url;
    let yes = false;
    try { yes = await window.ultima.isArticle(tab.webview.getWebContentsId()); } catch { /* gone */ }
    if (tab.url !== url) return;
    tab.readerable = yes;
  }
  if (tab === activeTab()) show(Boolean(tab.readerable));
}

// a new page in the tab: it's asked again, and Reader view of the old one closes
function readerPageChanged(tab, { inPage = false } = {}) {
  tab.readerable = undefined;
  if (!inPage && tab.reader) closeReader(tab);
}

function initReader() {
  $('#btn-reader').innerHTML = icon('book', 16);
  $('#btn-reader').addEventListener('click', (e) => { e.stopPropagation(); toggleReader(); });
  new ResizeObserver(() => syncReaderViews()).observe($('#viewport'));
}
