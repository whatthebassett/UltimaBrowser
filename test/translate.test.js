// Translation: the address bar offers to translate a page in another language; translating keeps the page's links,
// formatting and code as they were, text the page adds afterwards is translated too, Show original puts back exactly
// what was there, and a language you always translate is translated as its pages open. Google Translate is played by
// the test server (ULTIMA_TRANSLATE_URL), which "translates" into capitals and leaves the tags where they are.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, serve, until } = require('./harness');

// the fake Google Translate: the same answer shape as translate_a/t ([[text, detected language], …])
function fakeTranslate(req, url, body) {
  const qs = new URLSearchParams(body).getAll('q');
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  const out = qs.map((q) => [q.split(/(<g i=\d+>|<\/g>)/).map((p) => (/^<\/?g/.test(p) ? p : decode(p).toUpperCase())).join(''), 'fr']);
  return { type: 'application/json', body: JSON.stringify(out) };
}

const FRENCH = `<!doctype html><html lang="fr"><title>Le chat</title>
  <h1>Bonjour tout le monde</h1>
  <p id="story">Le <b>chat</b> est sur la <a id="link" href="/page/table">table</a> rouge &amp; ronde.</p>
  <p>Voici du code : <code>let chat = 1</code>, qui reste tel quel.</p>
  <ul><li>Un</li><li>Deux <em>et</em> trois</li></ul>
  <div>Texte libre<p>dans un bloc</p></div>
  <p class="notranslate" id="brand">Ultima Navigateur</p>
  <button id="send">Envoyer</button>`;

let app;
let web;
before(async () => {
  web = await serve({ '/translate_a/t': fakeTranslate, '/fr': FRENCH, '/fr2': FRENCH });
  app = await launch({ settings: { translateTo: 'en', autoGroup: false }, env: { ULTIMA_TRANSLATE_URL: `${web.origin}/translate_a/t?client=gtx` } });
});
after(async () => { await app?.close(); await web?.close(); });

async function go(url) {
  await app.ui((u) => { if (activeTab() && /^http/.test(activeTab().url)) navigate(activeTab(), u); else createTab({ url: u }); return true; }, url);
  await app.waitFor((u) => activeTab()?.url === u && !activeTab().loading && activeTab().ready, { what: `${url} to load` }, url);
}
const inPage = (fn, ...args) => app.page('/fr', fn, ...args);

test('the address bar offers to translate a page in another language, and not one in yours', async () => {
  await go(`${web.origin}/page/english`);
  await app.waitFor(() => activeTab().pageLang !== undefined && activeTab().pageLang !== null, { what: 'the page language' });
  assert.equal(await app.ui(() => document.querySelector('#btn-translate').hidden), true);
  await go(`${web.origin}/fr`);
  await app.waitFor(() => !document.querySelector('#btn-translate').hidden, { what: 'the translate button' });
  assert.match(await app.ui(() => document.querySelector('#btn-translate').title), /English/);
});

test('translates the page, keeping its links, formatting and code', async () => {
  // something the page set on its link and button, to tell they're still the same elements afterwards
  await inPage(() => { document.getElementById('link').mark = 1; document.getElementById('send').onclick = () => { document.title = 'sent'; }; return true; });
  await app.ui(() => { translateTab(); return true; });
  await app.waitFor(() => activeTab().translated?.from === 'fr', { what: 'the page to be translated' });
  const page = await inPage(() => ({
    h1: document.querySelector('h1').textContent,
    story: document.getElementById('story').innerHTML,
    code: document.querySelector('code').textContent,
    list: [...document.querySelectorAll('li')].map((li) => li.innerHTML),
    loose: document.querySelector('div').firstChild.nodeValue,
    brand: document.getElementById('brand').textContent,
    button: document.getElementById('send').textContent,
    sameLink: document.getElementById('link').mark === 1,
  }));
  assert.equal(page.h1, 'BONJOUR TOUT LE MONDE');
  assert.equal(page.story, 'LE <b>CHAT</b> EST SUR LA <a id="link" href="/page/table">TABLE</a> ROUGE &amp; RONDE.');
  assert.equal(page.code, 'let chat = 1', 'code is left alone');
  assert.deepEqual(page.list, ['UN', 'DEUX <em>ET</em> TROIS']);
  assert.equal(page.loose, 'TEXTE LIBRE');
  assert.equal(page.brand, 'Ultima Navigateur', 'what the page marks notranslate is left alone');
  assert.equal(page.button, 'ENVOYER');
  assert.equal(page.sameLink, true, 'the link is the page’s own element still');
  await inPage(() => { document.getElementById('send').click(); return true; });
  assert.equal(await inPage(() => document.title), 'sent', 'the button still works');
  await app.waitFor(() => document.querySelector('#btn-translate').classList.contains('on'), { what: 'the button to show it is on' });
});

test('text the page adds afterwards is translated too', async () => {
  await inPage(() => { const p = document.createElement('p'); p.id = 'later'; p.textContent = 'Un nouveau commentaire'; document.body.append(p); return true; });
  await until(async () => (await inPage(() => document.getElementById('later').textContent)) === 'UN NOUVEAU COMMENTAIRE', { what: 'the new text to be translated', timeout: 8000 });
});

test('Show original puts back exactly what was there', async () => {
  await app.ui(() => showTabOriginal());
  const page = await inPage(() => ({
    h1: document.querySelector('h1').textContent,
    story: document.getElementById('story').innerHTML,
    later: document.getElementById('later').textContent,
    sameLink: document.getElementById('link').mark === 1,
  }));
  assert.deepEqual(page, {
    h1: 'Bonjour tout le monde',
    story: 'Le <b>chat</b> est sur la <a id="link" href="/page/table">table</a> rouge &amp; ronde.',
    later: 'Un nouveau commentaire',
    sameLink: true,
  });
  assert.equal(await app.ui(() => activeTab().translated), null);
});

test('a language you always translate is translated as its pages open', async () => {
  await app.ui(() => applySettings({ translateAlways: ['fr'] }));
  try {
    await go(`${web.origin}/fr2`);
    await app.waitFor(() => activeTab().translated?.from === 'fr', { what: 'the page to translate itself' });
    assert.equal(await app.page('/fr2', () => document.querySelector('h1').textContent), 'BONJOUR TOUT LE MONDE');
  } finally { await app.ui(() => applySettings({ translateAlways: [] })); }
});
