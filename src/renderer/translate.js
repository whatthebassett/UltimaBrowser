// Translation: the address bar offers to translate a page that isn't in your language (as the page says it is), and
// Translate in the Control Palette, the address bar menu or a page's right-click menu translates any page. On a
// translated page the button's menu shows the original again, picks another language, or always translates that
// language. pagetools.js and translate-page.js do the work; text the page adds later is translated as it comes.
const TRANSLATE_LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'fi', 'cs', 'hu', 'ro', 'tr', 'ru', 'uk', 'el', 'ar', 'he', 'hi', 'id', 'vi', 'th', 'ja', 'ko', 'zh-CN', 'zh-TW'];
const baseLang = (code) => String(code || '').trim().toLowerCase().split(/[-_]/)[0];
const translateTarget = () => B.settings.translateTo || baseLang(navigator.language) || 'en';
const languageName = (code) => { try { return new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' }).of(code); } catch { return code; } };
const errorText = (err) => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function translateTab(tab = activeTab(), to = translateTarget(), { quiet = false } = {}) {
  if (!tab || !ready(tab) || isInternal(tab.url)) { if (!quiet) toast('Translation works on web pages'); return; }
  if (tab.translating) return;
  if (tab.translated) await showTabOriginal(tab, { keepButton: true }); // (another language: from the original)
  tab.translating = true;
  updateTranslateButton(tab);
  const url = tab.url;
  try {
    const said = tab.pageLang && tab.pageLang !== baseLang(to) ? tab.pageLang : undefined; // (what the page says it's in)
    const r = await window.ultima.translatePage({ webContentsId: tab.webview.getWebContentsId(), to, from: said });
    if (tab.url !== url) return;
    const from = said || r.from;
    if (!r.count || baseLang(from) === baseLang(to)) {
      await window.ultima.showOriginal(tab.webview.getWebContentsId());
      if (!quiet) toast(r.count ? `This page is already in ${languageName(to)}` : 'There’s no text to translate on this page');
      return;
    }
    tab.translated = { from, to };
    watchTranslation(tab);
  } catch (err) {
    if (!quiet) toast(`Couldn’t translate this page. ${errorText(err)}`);
  } finally {
    tab.translating = false;
    updateTranslateButton(tab);
  }
}

// what the page adds or changes afterwards (more results, a comment section…) is translated as it comes
function watchTranslation(tab) {
  clearInterval(tab.translateTimer);
  let busy = false;
  tab.translateTimer = setInterval(async () => {
    if (!tab.translated || !tab.webview || !B.tabs.includes(tab)) { clearInterval(tab.translateTimer); return; }
    if (busy) return;
    busy = true;
    try { await window.ultima.translatePage({ webContentsId: tab.webview.getWebContentsId(), to: tab.translated.to, more: true }); } catch { /* next time */ }
    busy = false;
  }, 2000);
}

async function showTabOriginal(tab = activeTab(), { keepButton = false } = {}) {
  if (!tab) return;
  clearInterval(tab.translateTimer);
  tab.translated = null;
  if (tab.webview) { try { await window.ultima.showOriginal(tab.webview.getWebContentsId()); } catch { /* gone */ } }
  if (!keepButton) updateTranslateButton(tab);
}

const toggleTranslation = (tab = activeTab()) => (tab?.translated ? showTabOriginal(tab) : translateTab(tab));

// The button's menu on a translated page (or with Shift, on any): the original, another language, always or never
async function translateMenu(tab = activeTab()) {
  const from = tab.translated?.from || tab.pageLang;
  const always = B.settings.translateAlways || [];
  const never = B.settings.translateNever || [];
  const r = $('#btn-translate').getBoundingClientRect();
  const choice = await showMenu([
    ...(tab.translated ? [
      { id: 'head', label: `Translated from ${languageName(from)}`, enabled: false },
      { id: 'original', label: 'Show original', icon: 'back' },
    ] : [{ id: 'now', label: `Translate to ${languageName(translateTarget())}`, icon: 'translate' }]),
    { id: 'to', label: 'Translate to…', icon: 'globe', submenu: TRANSLATE_LANGS.map((c) => ({ id: `to:${c}`, label: languageName(c), type: 'checkbox', checked: c === (tab.translated?.to || translateTarget()) })) },
    ...(from ? [
      { type: 'separator' },
      { id: 'always', label: `Always translate ${languageName(from)}`, type: 'checkbox', checked: always.includes(baseLang(from)) },
      ...(tab.translated ? [] : [{ id: 'never', label: `Never offer for ${languageName(from)}`, type: 'checkbox', checked: never.includes(baseLang(from)) }]),
    ] : []),
  ], { x: r.left, y: r.bottom + 4 });
  if (!choice) return;
  if (choice === 'original') showTabOriginal(tab);
  else if (choice === 'now') translateTab(tab);
  else if (choice.startsWith('to:')) translateTab(tab, choice.slice(3));
  else if (choice === 'always' || choice === 'never') {
    const key = choice === 'always' ? 'translateAlways' : 'translateNever';
    const list = B.settings[key] || [];
    const lang = baseLang(from);
    const on = !list.includes(lang);
    applySettings({ [key]: on ? [...list, lang] : list.filter((l) => l !== lang) });
    if (choice === 'always' && on && !tab.translated) translateTab(tab);
    updateTranslateButton(tab);
  }
}

// The address bar's button: while translated, and on pages in another language than yours (asked once a page has
// loaded); a language you always translate is translated there and then
async function updateTranslateButton(tab = activeTab()) {
  const btn = $('#btn-translate');
  if (!btn) return;
  const show = (on) => {
    if (tab !== activeTab()) return;
    btn.hidden = !on;
    btn.classList.toggle('on', Boolean(tab?.translated));
    btn.classList.toggle('busy', Boolean(tab?.translating));
    btn.title = tab?.translating ? 'Translating…' : tab?.translated ? `Translated from ${languageName(tab.translated.from)}` : `Translate to ${languageName(translateTarget())}`;
  };
  if (!tab || !/^https?:/.test(tab.url)) { show(false); return; }
  if (tab.translated || tab.translating) { show(true); return; }
  if (tab.pageLang === undefined && ready(tab) && !tab.loading) {
    tab.pageLang = null; // (asking)
    const url = tab.url;
    let lang = '';
    try { lang = await window.ultima.pageLanguage(tab.webview.getWebContentsId()); } catch { /* gone */ }
    if (tab.url !== url) return;
    tab.pageLang = baseLang(lang);
    if (tab.pageLang && tab.pageLang !== baseLang(translateTarget()) && (B.settings.translateAlways || []).includes(tab.pageLang)) { translateTab(tab, translateTarget(), { quiet: true }); return; }
  }
  const foreign = tab.pageLang && tab.pageLang !== baseLang(translateTarget()) && !(B.settings.translateNever || []).includes(tab.pageLang);
  show(Boolean(foreign));
}

// a new page in the tab: not translated, and its language asked again (a page changing its own address keeps going)
function translatePageChanged(tab, { inPage = false } = {}) {
  if (inPage) return;
  clearInterval(tab.translateTimer);
  tab.translated = null;
  tab.translating = false;
  tab.pageLang = undefined;
}

function initTranslate() {
  const btn = $('#btn-translate');
  btn.innerHTML = icon('translate', 16);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tab = activeTab();
    if (!tab || tab.translating) return;
    if (tab.translated || e.shiftKey) translateMenu(tab); else translateTab(tab);
  });
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (activeTab()) translateMenu(activeTab()); });
}
