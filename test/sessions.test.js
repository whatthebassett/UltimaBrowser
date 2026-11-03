// Sessions: what you had open comes back when Ultima starts again: after Quit, after a crash, with "Restore tabs"
// off (only the sidebar), and after "Restart to update" (everything, even with it off).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launch, serve, sleep, removeProfile } = require('./harness');

let app;
let web;
let profile;
before(async () => { web = await serve(); app = await launch({ settings: { autoGroup: false } }); profile = app.profile; });
after(async () => { await app?.quit().catch(() => app.kill()); removeProfile(profile); await web?.close(); });

const page = (n) => `${web.origin}/page/${n}`;
const open = (n, opts = {}) => app.ui((url, o) => createTab({ url, ...o }).id, page(n), opts);
const again = async () => { app = await launch({ profile }); };
// (the window saves a moment after each change: what a test just did is saved before it quits)
const settle = () => sleep(1200);

// What the window has, in a form that's the same from one start to the next: the orbits, which one and which tab are
// open, and every test page's tab with its place (pinned, Essential, orbit, folder, split view)
const snapshot = () => app.ui((origin) => {
  const mine = (t) => (t.homeUrl || t.url).startsWith(origin);
  const name = (t) => (t.homeUrl || t.url).split('/').pop();
  return {
    orbits: B.spaces.map((s) => s.name),
    orbit: activeSpace().name,
    open: activeTab() && mine(activeTab()) ? name(activeTab()) : null,
    tabs: B.tabs.filter(mine).map((t) => ({
      page: name(t), zone: t.zone, orbit: t.zone === 'essential' ? null : spaceById(t.spaceId)?.name || null,
      folder: folderById(t.folderId)?.name || null, split: t.splitId ? splitTabs(t.splitId).map(name) : null,
    })),
  };
}, web.origin);

test('everything comes back after quitting and starting again', async () => {
  const [p1, p2, p3, p4, p5, p6, p7] = [await open(1), await open(2), await open(3), await open(4), await open(5), await open(6), await open(7)];
  await app.ui((a, b) => { togglePin(tabById(a)); toggleEssential(tabById(b)); return true; }, p1, p2);
  // a folder (named in its dialog) and a split view
  await app.ui((a, b) => { newTabFolder([tabById(a), tabById(b)]); return true; }, p3, p4);
  await app.waitFor(() => Boolean(document.querySelector('.dlg [data-field="name"]')), { what: 'the folder name dialog' });
  await app.ui(() => { document.querySelector('.dlg [data-field="name"]').value = 'Reading'; document.querySelector('.dlg [data-id="ok"]').click(); return true; });
  await app.ui((a, b) => { activateTab(a); splitWith(tabById(a), tabById(b), 'right'); return true; }, p6, p7);
  // a second orbit, with a tab of its own
  await app.ui(() => { const s = createSpace(false); s.name = 'Work'; renderSpaces(); return true; });
  await app.ui((url) => { createTab({ url, spaceId: B.spaces.find((s) => s.name === 'Work').id, activate: false }); return true; }, page(8));
  await app.ui((i) => activateTab(i), p5);
  await settle();
  const before = await snapshot();
  assert.equal(before.tabs.length, 8);
  assert.deepEqual(before.orbits.slice(-1), ['Work']);

  await app.quit();
  await again();
  assert.deepEqual(await snapshot(), before);
  // and the open tab's page loads again
  await app.waitFor(() => activeTab()?.title === 'Test page 5', { what: 'the open tab to load' });
});

test('after a crash, the tabs are still there', async () => {
  await open('crash');
  await settle();
  await app.kill();
  await again();
  assert.ok((await snapshot()).tabs.some((t) => t.page === 'crash'));
});

test('with "Restore tabs" off, only the sidebar comes back: orbits, pinned tabs and Essentials', async () => {
  await app.ui(() => applySettings({ restoreSession: false }));
  await settle();
  await app.quit();
  await again();
  const now = await snapshot();
  assert.deepEqual(now.tabs.filter((t) => t.zone === 'normal'), [], 'no regular tabs');
  assert.deepEqual(now.tabs.map((t) => [t.page, t.zone]), [['2', 'essential'], ['1', 'pinned']]);
  assert.ok(now.orbits.includes('Work'));
});

test('"Restart to update" brings the tabs back even with "Restore tabs" off', async () => {
  await open('update');
  await settle();
  await app.quit();
  // what Restart to update leaves for the next start (updater.js)
  fs.writeFileSync(path.join(profile, 'update-restart'), String(Date.now()));
  await again();
  assert.ok((await snapshot()).tabs.some((t) => t.page === 'update' && t.zone === 'normal'));
  assert.equal(fs.existsSync(path.join(profile, 'update-restart')), false, 'it counts once');
});
