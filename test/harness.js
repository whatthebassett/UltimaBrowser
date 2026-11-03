// What the tests share: starting Ultima on a throwaway profile, talking to it over the DevTools protocol, quitting it
// as you would, and a small web server for the pages it opens. Your own Ultima and its profile are left alone.
//
//   const app = await launch();                      a new profile (or { profile } to start one again)
//   await app.ui((a, b) => …, a, b);                 runs a function in the window (renderer/index.html), its result back
//   await app.page('127.0.0.1', () => …);            the same in an open web page, by part of its address
//   await app.waitFor((a) => …, { what }, a);        until the function returns something truthy
//   await app.quit();                                File → Quit: the session is saved for next time
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// polls `check` until it returns something truthy (that value), or fails with `what` after `timeout`
async function until(check, { timeout = 15000, every = 150, what = 'the condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await check(); if (last) return last; } catch (err) { last = err; }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await sleep(every);
  }
}

const newProfile = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-test-'));

function removeProfile(dir) {
  // (Chromium lets go of its files a moment after it exits)
  for (let i = 0; i < 10; i += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { /* still held */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
}

// One DevTools protocol connection to a target (a window or a page)
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('could not connect')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  };
  ws.onclose = () => { for (const r of waiting.values()) r({ error: { message: 'connection closed' } }); waiting.clear(); };
  const send = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => ws.close() };
}

// `fn` with its arguments, as an expression to run there
const call = (fn, args) => (typeof fn === 'string' ? fn : `(${fn})(...${JSON.stringify(args)})`);

// Starts Ultima. `profile`: a profile from an earlier launch, to start it again; `settings`: settings to start a new
// profile with (the welcome is skipped unless `welcome`); `env`: more environment for it; `seed(dir)`: puts files in
// a new profile before it starts.
async function launch({ profile, settings = {}, env = {}, seed, welcome = false } = {}) {
  const dir = profile || newProfile();
  if (!profile) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...(welcome ? {} : { onboarded: true }), ...settings }));
    await seed?.(dir);
  }
  const portFile = path.join(dir, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const log = fs.openSync(path.join(dir, 'test-run.log'), 'a');
  const proc = spawn(require('electron'), ['.', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'],
  { cwd: root, stdio: ['ignore', log, log], env: { ...process.env, ...env } });
  const exited = new Promise((r) => { proc.once('exit', (code) => { fs.closeSync(log); r(code); }); });
  let running = true;
  exited.then(() => { running = false; });

  const port = await until(() => {
    if (!running) throw new Error('Ultima exited while starting');
    try { return Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]); } catch { return 0; }
  }, { timeout: 30000, what: 'Ultima to start' });
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();

  // runs `fn(...args)` in the first target `match` picks; awaits what it returns
  async function run(match, fn, args) {
    const t = (await targets()).find(match);
    if (!t) throw new Error('no such window or page');
    const c = await connect(t);
    try {
      const res = await c.send('Runtime.evaluate', { expression: call(fn, args), awaitPromise: true, returnByValue: true, userGesture: true });
      if (res.error) throw new Error(res.error.message);
      const ex = res.result?.exceptionDetails;
      if (ex) throw new Error(ex.exception?.description || ex.text);
      return res.result?.result?.value;
    } finally { c.close(); }
  }
  const isWindow = (t) => t.type === 'page' && t.url.includes('renderer/index.html');
  const app = {
    profile: dir,
    proc,
    exited,
    get running() { return running; },
    targets,
    ui: (fn, ...args) => run(isWindow, fn, args),
    page: (part, fn, ...args) => run((t) => t.type === 'webview' && t.url.includes(part), fn, args),
    waitFor: (fn, opts = {}, ...args) => until(() => app.ui(fn, ...args), opts),
    waitForPage: (part, opts = {}) => until(async () => (await targets()).some((t) => t.type === 'webview' && t.url.includes(part)), { what: `a page at ${part}`, ...opts }),
    // File → Quit, as you'd do it: every window is saved for next time
    async quit({ timeout = 20000 } = {}) {
      if (!running) return;
      app.ui(() => { window.ultima.quit(); return true; }).catch(() => {}); // (the answer may never come: it's quitting)
      const code = await Promise.race([exited, sleep(timeout).then(() => 'timeout')]);
      if (code === 'timeout') { proc.kill(); throw new Error('Ultima did not quit'); }
    },
    // ends it at once, as a crash or a power cut would
    async kill() { if (running) { proc.kill(); await exited; } },
    // quits (or kills, if quitting fails) and deletes the profile
    async close() {
      try { await app.quit(); } catch { await app.kill(); }
      removeProfile(dir);
    },
  };
  // its window has restored what it had and saves from now on (app.js)
  await app.waitFor(() => typeof B !== 'undefined' && B.restored === true, { timeout: 30000, what: 'the window to be ready' });
  return app;
}

// A web server on 127.0.0.1 for the pages tests open. `routes`: path → (req, url, body) => { type, body } or a string
// of HTML (or a promise of either). Every request it gets is in `hits` (path and query), so a test can tell what a page loaded and what was blocked.
async function serve(routes = {}) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hits.push({ path: url.pathname, query: url.search, host: req.headers.host });
    let body = '';
    for await (const chunk of req) body += chunk;
    const route = routes[url.pathname] || Object.entries(routes).find(([p]) => p.endsWith('*') && url.pathname.startsWith(p.slice(0, -1)))?.[1];
    let out = typeof route === 'function' ? await route(req, url, body) : route;
    if (typeof out === 'string') out = { type: 'text/html', body: out };
    if (!out) {
      const page = /^\/page\/(\w+)$/.exec(url.pathname);
      out = page ? { type: 'text/html', body: `<!doctype html><title>Test page ${page[1]}</title><h1>Page ${page[1]}</h1>` }
        : { status: 404, type: 'text/plain', body: 'not found' };
    }
    res.writeHead(out.status || 200, { 'Content-Type': out.type || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(out.body || '');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const { port } = server.address();
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    other: `http://localhost:${port}`, // the same server under another name: a different site to the page
    hits,
    hit: (p) => hits.some((h) => h.path === p),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

module.exports = { launch, serve, until, sleep, newProfile, removeProfile };
