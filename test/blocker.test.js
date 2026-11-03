// The ad blocker: an ad and a tracker on a page are blocked (and counted on the shield), an ad box is hidden, trackers
// can be let through on their own, turning the shield off for a site lets everything through, and tracking codes come
// out of the links you open. It runs on a small filter list of its own, put in the profile in place of the real lists
// (which Ultima would otherwise download), so it needs no internet and gives the same answer every time.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launch, serve, until } = require('./harness');

// the lists Ultima keeps (blocker.js LISTS): the test filters go in EasyList (ads) and EasyPrivacy (trackers)
const LISTS = {
  easylist: '/ultima-test-ad.js\n##.ultima-test-ad',
  easyprivacy: '/ultima-test-tracker.gif',
  ublock: '', 'ublock-privacy': '', 'ublock-quick-fixes': '', 'ublock-unbreak': '',
};
function seedFilters(profile) {
  const dir = path.join(profile, 'filters');
  fs.mkdirSync(dir, { recursive: true });
  const meta = {};
  for (const [id, rules] of Object.entries(LISTS)) {
    fs.writeFileSync(path.join(dir, `${id}.txt`), `! Title: Ultima test filters (${id})\n${rules}\n`);
    meta[id] = { updated: Date.now(), version: 'test', expires: 14 * 24 * 60 * 60 * 1000 }; // fresh: none is downloaded
  }
  fs.writeFileSync(path.join(dir, 'lists.json'), JSON.stringify(meta));
}

let app;
let web;
before(async () => {
  web = await serve({
    // a page with an ad script, a tracking pixel, an ordinary image (all from another site) and an ad box
    '/ads': () => `<!doctype html><title>Ads</title>
      <div class="ultima-test-ad">An ad</div><p id="story">The story</p>
      <script src="${web.other}/ultima-test-ad.js"></script>
      <img src="${web.other}/ultima-test-tracker.gif"><img src="${web.other}/photo.png">`,
  });
  app = await launch({ seed: seedFilters });
});
after(async () => { await app?.close(); await web?.close(); });

const adsPage = () => `${web.origin}/ads`;
// opens the page (or loads it again) and waits until its ordinary image was asked for: then everything it asks for has been
async function load() {
  web.hits.length = 0;
  await app.ui((url) => { const t = B.tabs.find((x) => x.url === url); if (t) { activateTab(t.id); t.webview.reload(); } else createTab({ url }); return true; }, adsPage());
  await until(() => web.hit('/photo.png'), { what: 'the page to load' });
  await app.waitFor(() => activeTab()?.loading === false, { what: 'the page to finish' });
}
const adHidden = () => app.page('/ads', () => getComputedStyle(document.querySelector('.ultima-test-ad')).display === 'none');

test('blocks the ad and the tracker, counts them on the shield, and hides the ad box', async () => {
  await load();
  assert.equal(web.hit('/ultima-test-ad.js'), false, 'the ad script was blocked');
  assert.equal(web.hit('/ultima-test-tracker.gif'), false, 'the tracker was blocked');
  await app.waitFor(() => activeTab().blocked === 2, { what: 'the page’s count to reach 2' });
  assert.equal(await app.ui(() => document.querySelector('#btn-shield .url-shield-n')?.textContent), '2', 'the shield shows 2');
  assert.equal(await adHidden(), true, 'the ad box is hidden');
  assert.equal(await app.page('/ads', () => getComputedStyle(document.querySelector('#story')).display !== 'none'), true, 'the story is not');
});

test('with trackers let through, only the ad is blocked', async () => {
  await app.ui(() => applySettings({ blockTrackers: false }));
  try {
    await load();
    assert.equal(web.hit('/ultima-test-tracker.gif'), true, 'the tracker loaded');
    assert.equal(web.hit('/ultima-test-ad.js'), false, 'the ad is still blocked');
  } finally { await app.ui(() => applySettings({ blockTrackers: true })); }
});

test('with the shield off for the site, nothing is blocked or hidden there', async () => {
  await app.ui((url) => window.ultima.blockerSetSite({ url, off: true }), adsPage());
  try {
    assert.equal((await app.ui((url) => window.ultima.blockerSite(url), adsPage())).off, true);
    await load();
    assert.equal(web.hit('/ultima-test-ad.js'), true, 'the ad loaded');
    assert.equal(web.hit('/ultima-test-tracker.gif'), true, 'the tracker loaded');
    assert.equal(await adHidden(), false, 'the ad box shows');
  } finally { await app.ui((url) => window.ultima.blockerSetSite({ url, off: false }), adsPage()); }
  await load();
  assert.equal(web.hit('/ultima-test-ad.js'), false, 'blocked again once it is back on');
});

test('takes tracking codes out of the links you open, and keeps the rest of the address', async () => {
  const url = `${web.origin}/page/clean?utm_source=newsletter&id=7&fbclid=abc123`;
  await app.ui((u) => createTab({ url: u }).id, url);
  await app.waitFor((u) => activeTab()?.url === u, { what: 'the clean address' }, `${web.origin}/page/clean?id=7`);
  const asked = web.hits.filter((h) => h.path === '/page/clean').map((h) => h.query);
  assert.deepEqual(asked, ['?id=7'], 'the site only ever saw the clean address');
});
