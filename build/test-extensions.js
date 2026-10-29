// Extension compatibility test: starts Ultima on a throwaway profile, installs popular Chrome Web Store extensions,
// and checks each one the way you'd use it: its toolbar button (popup or side panel), its options page, and whether
// its content scripts run on a page. Writes a report of what works, errors from the extension log, and the Chrome
// APIs each one used that Ultima only stands in for.
//   npm run test:extensions                  the default list below
//   npm run test:extensions -- <id> <id> …   other Web Store extension ids
// Needs Node 22 or later (fetch and WebSocket). Leaves your own Ultima and its profile alone.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSIONS = {
  eimadpbcbfnmbkopoojfekhnkhdbieeh: 'Dark Reader',
  ddkjiahejlhfcafbddmgiahcphecmpfh: 'uBlock Origin Lite',
  nngceckbapebfimnlniiiahkandclblb: 'Bitwarden',
  clngdbkpkpeebahjckkjfobafhncgmne: 'Stylus',
  dbepggeogbaibhgnhhndojpepiihcmeb: 'Vimium',
  dhdgffkkebhmkfjojejmpbldmpobfkfo: 'Tampermonkey',
  aapbdbdomjkkjkaonfhkkikfgjllcleb: 'Google Translate',
  bhlhnicpbhignbdhedgjhgdocnmhomnp: 'ColorZilla',
  fcoeoabgfenejglbffodgkkbkcdhcgfn: 'Claude',
  mnjggcdmjocbbbhaepdhchncahnbgone: 'SponsorBlock',
  bcjindcccaagfpapjjmafapmmgkkhgoa: 'JSON Formatter',
  gebbhagfogifgggkldgodflihgfeippi: 'Return YouTube Dislike',
};
const PORT = 9339;
const PAGE = 'https://example.com/';
const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-ext-test-'));
const report = path.join(root, 'dist', 'extension-report.md');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EXTENSIONS);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---------- talking to Ultima over the DevTools protocol ----------
const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function session(match) {
  const t = (await targets()).find((x) => (typeof match === 'function' ? match(x) : x.url.includes(match)));
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else if (d.method) events.push(d);
  };
  const send = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return { send, events, close: () => ws.close() };
}
// Runs an expression in the first target whose URL contains `match`; null if there is none
async function evaluate(match, expression) {
  const s = await session(match);
  if (!s) return null;
  try {
    const res = await Promise.race([
      s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      sleep(30000).then(() => ({ result: { exceptionDetails: { text: 'timed out' } } })),
    ]);
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
    return res.result?.result?.value;
  } finally { s.close(); }
}
const ui = (expression) => evaluate('renderer/index.html', expression);
const text = 'document.body ? document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 90) : ""';
// A page's text once it has some (pages fill in as they start), or what it has after a few seconds. With two copies
// open (an extension often opens its options page itself when installed), the newest is read.
async function pageText(match) {
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    const all = (await targets()).filter((t) => t.url.includes(match));
    last = all.length ? await evaluate((t) => t.id === all[0].id, text).catch((e) => `error ${e.message}`) : null;
    if (last) return last;
    await sleep(1000);
  }
  return last ?? 'did not open';
}

// ---------- the test ----------
async function main() {
  const exe = require('electron');
  const app = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'], { cwd: root, stdio: 'ignore' });
  const results = [];
  try {
    for (let i = 0; i < 40; i += 1) { try { await targets(); break; } catch { await sleep(500); } }
    await sleep(4000);
    await ui(`(async () => { try { await endWelcome({ skipped: true }); } catch {} createTab({ url: '${PAGE}' }); return 1; })()`);
    await sleep(3000);
    for (const id of ids) {
      const r = { id, name: EXTENSIONS[id] || id, installed: false };
      results.push(r);
      try {
        const ext = await ui(`window.ultima.installExtensionFromStore('${id}').then((e) => ({ name: e.name, version: e.version, error: e.error, popup: e.popup, options: e.optionsPage }))`);
        Object.assign(r, ext, { installed: !ext.error });
        console.log(`installed ${r.name} ${r.version}`);
      } catch (err) { r.error = err.message.replace(/^.*?Error: /, ''); console.log(`couldn't install ${r.name}: ${r.error}`); }
    }
    await sleep(5000);
    // the page again, so every extension's content scripts get a chance to run in it
    await evaluate(PAGE, 'location.reload()').catch(() => {});
    await sleep(4000);
    const front = `(() => { const t = B.tabs.find((x) => x.url === '${PAGE}'); activateTab(t.id); return 1; })()`;
    for (const r of results.filter((x) => x.installed)) {
      await ui(front);
      await sleep(500);
      const runtimeId = await ui(`window.ultima.extensionRuntimeId({ id: '${r.id}', partition: tabPartition(activeTab()) })`);
      // the toolbar button: a popup, a side panel, or the extension's own response to the click
      await ui(`(closeExtensionPopup(), openExtension(EXT.list.find((x) => x.id === '${r.id}'), document.querySelector('#urlbar')), 1)`);
      await sleep(4000);
      if (r.popup) r.button = `popup: ${await pageText(`${runtimeId}/${r.popup.replace(/^\//, '')}`)}`;
      else {
        const panel = await ui(`(() => { const b = document.querySelector('#ext-panel'); return b.hidden ? null : b.querySelector('webview:not(.hidden)')?.getAttribute('src'); })()`);
        r.button = panel ? `side panel: ${await pageText(panel)}` : 'no popup or side panel';
      }
      await ui('(closeExtensionPopup(), [...EXT.panels.keys()].forEach(closeSidePanel), 1)');
      if (r.options) {
        await ui(`createTab({ url: 'chrome-extension://${runtimeId}/${r.options.replace(/^\//, '')}' })`);
        await sleep(3500);
        r.optionsPage = await pageText(`${runtimeId}/${r.options.replace(/^\//, '')}`);
        await ui(`(() => { const t = B.tabs.find((x) => x.url.startsWith('chrome-extension://${runtimeId}/')); if (t) closeTab(t.id, { remove: true }); return 1; })()`);
      }
    }
    // content scripts: each extension's own world in the page
    const page = await session(PAGE);
    if (page) {
      await page.send('Runtime.enable');
      await sleep(1000);
      const worlds = new Set(page.events.filter((e) => e.method === 'Runtime.executionContextCreated' && e.params.context.origin.startsWith('chrome-extension://'))
        .map((e) => e.params.context.name));
      page.close();
      for (const r of results) r.contentScripts = worlds.has(r.name);
    }
    const listed = await ui('EXT.list.map((e) => ({ id: e.id, unsupported: e.unsupported }))');
    for (const r of results) r.unsupported = listed.find((x) => x.id === r.id)?.unsupported || [];
  } finally {
    app.kill();
    await sleep(2000);
  }
  // errors each extension logged (Settings → Extensions → Extension log)
  let log = '';
  try { log = fs.readFileSync(path.join(profile, 'logs', 'extensions.log'), 'utf8'); } catch { /* none */ }
  for (const r of results) {
    r.errors = [...new Set(log.split('\n').filter((l) => l.includes(` ERROR ${r.name}`) || (r.name && l.includes(` ERROR ${r.name.split(' ')[0]}`)))
      .map((l) => l.replace(/^\S+ ERROR /, '').slice(0, 220)))].slice(0, 5);
  }
  const lines = ['# Extension compatibility', '', `Ultima ${require('../package.json').version}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, ''];
  for (const r of results) {
    lines.push(`## ${r.name}${r.version ? ` ${r.version}` : ''}`, '');
    if (!r.installed) { lines.push(`- Didn't install: ${r.error || 'unknown'}`, ''); continue; }
    lines.push(`- Toolbar button: ${r.button}`);
    if (r.options) lines.push(`- Options page: ${r.optionsPage}`);
    lines.push(`- Content scripts on ${PAGE}: ${r.contentScripts ? 'running' : 'none'}`);
    if (r.unsupported.length) lines.push(`- Uses what Ultima only stands in for: ${r.unsupported.join(', ')}`);
    for (const e of r.errors) lines.push(`- Error: ${e}`);
    lines.push('');
  }
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, lines.join('\n'));
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`\nReport: ${path.relative(process.cwd(), report)}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
