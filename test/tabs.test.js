// Tabs: opening, closing and reopening, moving, pinned tabs, Essentials, orbits, folders, several at once, split view.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, serve } = require('./harness');

let app;
let web;
before(async () => {
  web = await serve({ '/slow': () => new Promise((r) => { setTimeout(() => r('<!doctype html><title>Slow page</title>Finally'), 1500); }) });
  app = await launch({ settings: { autoGroup: false } }); // (grouping by site is tested on its own, below)
});
after(async () => { await app?.close(); await web?.close(); });
// each test starts with none of the test pages open, nothing selected, and one orbit
beforeEach(() => app.ui((origin) => {
  clearTabSelection();
  for (const t of B.tabs.filter((x) => x.url.startsWith(origin) || x.homeUrl?.startsWith(origin))) closeTab(t.id, { remove: true, animate: false });
  B.spaces = B.spaces.slice(0, 1);
  switchSpace(B.spaces[0].id);
  return true;
}, web.origin));

const page = (n) => `${web.origin}/page/${n}`;
// opens a page in a new tab; its id
const open = (n, opts = {}) => app.ui((url, o) => createTab({ url, ...o }).id, page(n), opts);
// this orbit's regular tabs that are test pages, as their numbers in sidebar order
const shown = () => app.ui((origin) => spaceTabs().filter((t) => t.zone === 'normal' && t.url.startsWith(origin)).map((t) => t.url.split('/').pop()), web.origin);
const activeUrl = () => app.ui(() => activeTab()?.url);
const tab = (id) => app.ui((i) => { const t = tabById(i); return t && { url: t.url, zone: t.zone, spaceId: t.spaceId, folderId: t.folderId, splitId: t.splitId, loaded: Boolean(t.webview), title: t.title }; }, id);

test('opens tabs, shows the newest and loads each page', async () => {
  const ids = [await open(1), await open(2), await open(3)];
  assert.deepEqual(await shown(), ['1', '2', '3']);
  assert.equal(await activeUrl(), page(3));
  await app.waitFor((i) => tabById(i[0]).title === 'Test page 1' && tabById(i[2]).title === 'Test page 3', { what: 'the pages to load' }, ids);
});

test('closing the open tab opens the one after it, and reopening puts it back where it was', async () => {
  const ids = [await open(1), await open(2), await open(3)];
  await app.ui((i) => activateTab(i), ids[1]);
  await app.ui((i) => closeTab(i, { animate: false }), ids[1]);
  assert.deepEqual(await shown(), ['1', '3']);
  assert.equal(await activeUrl(), page(3));
  await app.ui(() => reopenClosedTab());
  assert.deepEqual(await shown(), ['1', '2', '3']);
  assert.equal(await activeUrl(), page(2));
});

test('moves a tab to another place in the list', async () => {
  const ids = [await open(1), await open(2), await open(3)];
  await app.ui((from, to) => moveTab(from, B.tabs.indexOf(tabById(to)), 'normal'), ids[2], ids[0]);
  assert.deepEqual(await shown(), ['3', '1', '2']);
});

test('a pinned tab stays in the sidebar when closed, unloaded until it is opened again', async () => {
  const id = await open(1);
  await app.ui((i) => togglePin(tabById(i)), id);
  assert.equal((await tab(id)).zone, 'pinned');
  await app.ui((i) => closeTab(i, { animate: false }), id);
  const closed = await tab(id);
  assert.ok(closed, 'it is still there');
  assert.equal(closed.loaded, false);
  await app.ui((i) => activateTab(i), id);
  assert.equal((await tab(id)).loaded, true);
  assert.equal(await activeUrl(), page(1));
  await app.ui((i) => togglePin(tabById(i)), id);
  assert.equal((await tab(id)).zone, 'normal');
});

test('Essentials are in every orbit; a regular tab only in its own', async () => {
  const essential = await open('e');
  const regular = await open('r');
  await app.ui((i) => toggleEssential(tabById(i)), essential);
  const home = await app.ui(() => B.activeSpaceId);
  const other = await app.ui(() => createSpace(false).id);
  await app.ui((s) => switchSpace(s), other);
  const there = await app.ui(() => spaceTabs().map((t) => t.id));
  assert.ok(there.includes(essential), 'the Essential is in the other orbit');
  assert.ok(!there.includes(regular), 'the regular tab is not');
  await app.ui((s) => switchSpace(s), home);
  await app.ui((i) => toggleEssential(tabById(i)), essential);
});

test('moves a tab to another orbit', async () => {
  const id = await open(1);
  const home = await app.ui(() => B.activeSpaceId);
  const other = await app.ui(() => createSpace(false).id);
  await app.ui((i, s) => moveTabToSpace(tabById(i), s, { quiet: true }), id, other);
  assert.equal((await tab(id)).spaceId, other);
  assert.ok(!(await app.ui((h) => spaceTabs(h).map((t) => t.id), home)).includes(id));
  assert.ok((await app.ui((s) => spaceTabs(s).map((t) => t.id), other)).includes(id));
});

test('puts tabs in a named folder and takes one out again', async () => {
  const ids = [await open(1), await open(2), await open(3)];
  // New folder asks for a name: type one and press Save
  await app.ui((a, b) => { newTabFolder([tabById(a), tabById(b)]); return true; }, ids[0], ids[1]);
  await app.waitFor(() => Boolean(document.querySelector('.dlg [data-field="name"]')), { what: 'the folder name dialog' });
  await app.ui(() => { document.querySelector('.dlg [data-field="name"]').value = 'Research'; document.querySelector('.dlg [data-id="ok"]').click(); return true; });
  const folder = await app.waitFor((i) => { const f = folderById(tabById(i).folderId); return f?.name === 'Research' && f; }, { what: 'the folder' }, ids[0]);
  assert.deepEqual(await app.ui((f) => folderTabs(f).map((t) => t.url.split('/').pop()), folder.id), ['1', '2']);
  assert.equal((await tab(ids[2])).folderId, undefined);
  await app.ui((i) => removeTabFromFolder(tabById(i)), ids[0]);
  assert.deepEqual(await app.ui((f) => folderTabs(f).map((t) => t.url.split('/').pop()), folder.id), ['2']);
});

test('several selected tabs pin, unpin and close together', async () => {
  const ids = [await open(1), await open(2), await open(3)];
  await app.ui((a, b) => { B.selected = new Set([a, b]); renderTabs(); return true; }, ids[0], ids[2]);
  await app.ui(() => pinTabs(selectedTabs(), true));
  assert.deepEqual([(await tab(ids[0])).zone, (await tab(ids[1])).zone, (await tab(ids[2])).zone], ['pinned', 'normal', 'pinned']);
  await app.ui(() => pinTabs(selectedTabs(), false));
  assert.deepEqual([(await tab(ids[0])).zone, (await tab(ids[2])).zone], ['normal', 'normal']);
  await app.ui(() => closeTabs(selectedTabs(), { remove: true }));
  assert.deepEqual(await shown(), ['2']);
  await app.ui(() => clearTabSelection());
});

test('two tabs side by side in split view, and apart again', async () => {
  const ids = [await open(1), await open(2)];
  await app.ui((a, b) => { activateTab(a); splitWith(tabById(a), tabById(b), 'right'); return true; }, ids[0], ids[1]);
  const [a, b] = [await tab(ids[0]), await tab(ids[1])];
  assert.ok(a.splitId, 'the first tab is in a split view');
  assert.equal(a.splitId, b.splitId);
  await app.ui((i) => unsplitTab(tabById(i)), ids[1]);
  assert.equal((await tab(ids[0])).splitId, undefined);
});

test('with automatic groups on, tabs of one site gather in a folder named for it', async () => {
  await app.ui(() => applySettings({ autoGroup: true }));
  try {
    const ids = [await open(1), await open(2)];
    const folder = await app.waitFor((i) => { const f = folderById(tabById(i[0]).folderId); return f && tabById(i[1]).folderId === f.id && { name: f.name, auto: Boolean(f.auto) }; }, { what: 'the automatic folder' }, ids);
    assert.equal(folder.auto, true);
    assert.ok(folder.name, 'it has a name');
  } finally { await app.ui(() => applySettings({ autoGroup: false })); }
});

test('with the loading animation off, a status at the bottom shows the page loading instead', async () => {
  const status = () => app.ui(() => { const el = document.querySelector('#status'); return { shown: !el.hidden, text: el.textContent, loading: el.classList.contains('loading'), bar: document.querySelector('#urlbar').classList.contains('loading') }; });
  await app.ui(() => applySettings({ loadingIndicator: false }));
  try {
    await app.ui((url) => { createTab({ url }); return true; }, `${web.origin}/slow`);
    const during = await app.waitFor(() => { const el = document.querySelector('#status'); return !el.hidden && el.classList.contains('loading') && el.textContent; }, { what: 'the loading status' });
    assert.equal(during, 'Loading 127.0.0.1…');
    assert.equal((await status()).bar, false, 'no animation in the address bar');
    await app.waitFor(() => activeTab().title === 'Slow page' && !activeTab().loading, { what: 'the page to load' });
    await app.waitFor(() => document.querySelector('#status').hidden, { what: 'the status to go' });
    // with the animation on, the status stays away and the address bar shows the load
    await app.ui(() => applySettings({ loadingIndicator: true }));
    await app.ui(() => { activeTab().webview.reload(); return true; });
    await app.waitFor(() => document.querySelector('#urlbar').classList.contains('loading'), { what: 'the address bar animation' });
    assert.equal((await status()).shown, false);
  } finally { await app.ui(() => applySettings({ loadingIndicator: true })); }
});
