// The director: runs the film and talks to Setup (src/SetupWindow.cs) through WebView2 messages.
// Opened in an ordinary browser (no WebView2) it plays a pretend install, for designing the scenes.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const host = window.chrome && window.chrome.webview;
const SHOT_MS = 2900;
const MIN_SHOTS = 3; // the film plays at least this many shots, even when the install is quicker

const state = { mode: 'install', product: 'Ultima Browser', version: '', installed: null, dir: '', work: null, started: 0, done: false, shots: 0, ending: false };

function send(message) { if (host) host.postMessage(message); else Demo.handle(message); }
function phase(name) { document.body.className = `phase-${name}${Score.muted ? ' muted' : ''}`; }

// ---------- messages from Setup ----------
function onMessage(m) {
  switch (m.type) {
    case 'hello': Object.assign(state, m); prologue(); break;
    case 'stage': $('#progress-label').textContent = { prepare: 'Preparing', copy: 'Unpacking', finish: 'Adding shortcuts' }[m.name] || ''; break;
    case 'progress': setProgress(m.value, m.file); break;
    case 'running': showModal({
      title: `${short(state.product)} is open`,
      text: 'Close it to finish installing. Your tabs come right back the next time you open it.',
      yes: `Close ${short(state.product)} and continue`, onYes: () => send({ type: 'closeApp' }),
      no: 'Cancel', onNo: backToReady,
    }); break;
    case 'done': state.done = true; state.finished = performance.now(); if (state.mode === 'uninstall') uninstalled(); else maybeFinale(); break;
    case 'error': stopShots(); showModal({
      title: state.mode === 'uninstall' ? 'Uninstall couldn’t finish' : 'Setup couldn’t finish',
      text: m.message, yes: 'Try again', onYes: () => (state.mode === 'uninstall' ? startUninstall() : startInstall()), no: 'Close', onNo: () => send({ type: 'close' }),
    }); break;
    default: break;
  }
}
if (host) host.addEventListener('message', (e) => onMessage(e.data));

const short = (product) => product.replace(/ Browser$/, '');

// ---------- act one: the title card ----------
async function prologue() {
  const name = short(state.product);
  $('#chrome-product').textContent = name;
  $('#chrome-mode').textContent = state.mode === 'uninstall' ? 'Uninstall' : 'Setup';
  $('#wordmark').innerHTML = [...name.toUpperCase()].map((c, i) => `<span style="transition-delay:${i * 90}ms">${c}</span>`).join('');
  phase('black');
  await sleep(250);
  phase('prologue');
  Score.start();
  Stars.mode('idle');
  await sleep(550);
  if (state.mode !== 'uninstall') { $('.streak').classList.add('go'); Score.whoosh(1.4); }
  await sleep(450);
  $('#title-card').classList.add('draw');
  setTimeout(() => Score.chime([659.25, 987.77]), 1350); // with the glint and the spark at the swoosh's tip
  await sleep(1350);
  $('#wordmark').classList.add('show');
  await sleep(850);
  $('#tagline').classList.add('show');
  await sleep(state.mode === 'uninstall' ? 700 : 1500);
  ready();
}

// ---------- act two: ready ----------
function ready() {
  const name = short(state.product);
  const p = $('#panel-ready');
  const go = $('#btn-go');
  $('#ready-fine').textContent = `Version ${state.version}  ·  ${displayDir(state.dir)}`;
  if (state.mode === 'uninstall') {
    phase('uninstall');
    $('#ready-title').textContent = `Uninstall ${name}?`;
    $('#ready-sub').textContent = `${state.product} ${state.version} will be removed from this PC. Your bookmarks, history and passwords stay unless you choose otherwise.`;
    $('#btn-go-label').textContent = 'Uninstall';
    go.classList.add('danger');
    $('#btn-keep').hidden = false;
    $('#opt-desktop').hidden = true;
    $('#opt-data').hidden = false;
  } else {
    phase('ready');
    if (state.installed && state.installed === state.version) {
      $('#ready-title').textContent = `${name} ${state.version} is already installed.`;
      $('#ready-sub').textContent = 'Reinstall it to repair a damaged copy. Your tabs, bookmarks and settings stay right where they are.';
      $('#btn-go-label').textContent = `Reinstall ${name}`;
    } else if (state.installed) {
      $('#ready-title').textContent = `A new ${name} is here.`;
      $('#ready-sub').textContent = `Update from ${state.installed} to ${state.version}. Your tabs, bookmarks and settings stay right where they are.`;
      $('#btn-go-label').textContent = `Update ${name}`;
    } else {
      $('#ready-title').textContent = 'Ready when you are.';
      $('#ready-sub').textContent = `${name} installs just for you — no administrator rights, nothing else to set up.`;
      $('#btn-go-label').textContent = `Install ${name}`;
    }
  }
  p.hidden = false;
  p.classList.remove('leaving');
  setTimeout(() => go.focus(), 400);
}

function displayDir(dir) {
  return (dir || '').replace(/^[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\/i, '%LOCALAPPDATA%\\');
}

async function leavePanel(id) {
  const p = $(id);
  p.classList.add('leaving');
  await sleep(550);
  p.hidden = true;
  p.classList.remove('leaving');
}

// ---------- act three: the film ----------
async function startInstall() {
  hideModal();
  Score.start();
  Score.whoosh(1.6);
  Score.intensity(1);
  state.done = false; state.ending = false; state.shots = 0; state.started = performance.now();
  if (!$('#panel-ready').hidden) await leavePanel('#panel-ready');
  phase('install');
  Stars.mode('warp');
  $('#stage').hidden = false;
  setProgress(0, '');
  $('#progress').hidden = false;
  $('#progress').classList.remove('collapse');
  send({ type: 'install', desktopShortcut: $('#chk-desktop').checked });
  runShots(['tabs', 'spaces', 'palette', 'split', 'movies', 'private']);
}

function backToReady() {
  stopShots();
  $('#stage').hidden = true;
  $('#progress').hidden = true;
  Stars.mode('idle');
  Score.intensity(0);
  ready();
}

function setProgress(value, file) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  $('#progress-fill').style.width = `${pct}%`;
  $('#progress-pct').textContent = `${pct}%`;
  if (file) $('#progress-label').textContent = `Unpacking  ${file.split(/[\\/]/).pop()}`;
}

let shotTimer = null;
function runShots(names) {
  stopShots();
  let i = -1;
  const next = () => {
    const prev = $('.shot.on');
    if (prev) { prev.classList.remove('on'); prev.classList.add('off'); setTimeout(() => prev.classList.remove('off'), 900); }
    if (state.shots >= MIN_SHOTS && state.done && state.mode !== 'uninstall') { finale(); return; }
    i = (i + 1) % names.length;
    const shot = $(`.shot[data-shot="${names[i]}"]`);
    shot.classList.add('on');
    if (names[i] === 'palette') typePalette(shot);
    if (state.shots > 0) Score.chime([[440, 554.37, 659.25, 830.61][state.shots % 4]], 0);
    state.shots += 1;
    shotTimer = setTimeout(next, SHOT_MS);
  };
  next();
}
function stopShots() {
  clearTimeout(shotTimer);
  $$('.shot.on').forEach((s) => s.classList.remove('on'));
}
async function typePalette(shot) {
  const text = shot.querySelector('.pal-text');
  const row = shot.querySelector('.pal-row');
  text.textContent = ''; row.classList.remove('show');
  for (const c of 'netflix') { await sleep(reduced ? 0 : 140); text.textContent += c; }
  row.classList.add('show');
}

// the film finishes the shot on screen once the install is done (and enough of the film has played)
function maybeFinale() {
  if (state.shots >= MIN_SHOTS && !state.ending) { clearTimeout(shotTimer); setTimeout(finale, 400); }
}

// ---------- act four: the finale ----------
async function finale() {
  if (state.ending) return;
  state.ending = true;
  stopShots();
  setProgress(1, '');
  $('#progress-label').textContent = 'Done';
  await sleep(350);
  $('#progress').classList.add('collapse');
  await sleep(650);
  $('#progress').hidden = true;
  $('#stage').hidden = true;
  $('.bloom').classList.add('go');
  Stars.mode('burst');
  Score.boom();
  Score.swell();
  Score.intensity(0.6);
  await sleep(500);
  const name = short(state.product);
  const seconds = ((state.finished - state.started) / 1000).toFixed(1);
  $('#done-title').textContent = state.installed && state.installed !== state.version ? `${name} is up to date.` : `Welcome to ${name}.`;
  $('#done-sub').textContent = state.installed && state.installed !== state.version
    ? `Updated to ${state.version} in ${seconds} seconds. Everything you had is still there.`
    : `Installed in ${seconds} seconds. Find it on your desktop and in the Start menu.`;
  if (!$('#chk-desktop').checked) $('#done-sub').textContent = $('#done-sub').textContent.replace('on your desktop and ', '');
  phase('finale');
  $('#panel-done').hidden = false;
  setTimeout(() => $('#btn-launch').focus(), 500);
  setTimeout(() => $('.bloom').classList.remove('go'), 2000);
}

async function fadeOut() {
  Score.fadeOut(1);
  phase('out');
  await sleep(1150);
}

// ---------- uninstall ----------
async function startUninstall() {
  hideModal();
  Score.whoosh(1.2);
  state.done = false; state.started = performance.now();
  if (!$('#panel-ready').hidden) await leavePanel('#panel-ready');
  phase('uninstalling');
  Stars.mode('reverse');
  Score.intensity(0);
  $('#progress').hidden = false;
  $('#stage').hidden = false;
  $('#progress-label').textContent = 'Removing Ultima';
  $$('.shot.on').forEach((s) => s.classList.remove('on'));
  $('.shot[data-shot="goodbye"]').classList.add('on');
  // no file-by-file progress when removing: ease towards the end until Setup says it's done
  let v = 0;
  const tick = () => { if (state.done) return; v += (0.92 - v) * 0.06; setProgress(v, ''); setTimeout(tick, 120); };
  tick();
  send({ type: 'uninstall', deleteData: $('#chk-data').checked });
}

async function uninstalled() {
  setProgress(1, '');
  await sleep(500);
  $('#progress').classList.add('collapse');
  $('.shot.on')?.classList.remove('on');
  await sleep(800);
  $('#progress').hidden = true;
  Stars.mode('calm');
  Score.chime([659.25, 493.88, 440], 0.22);
  phase('uninstalled');
  $('#done-title').textContent = `${short(state.product)} has been removed.`;
  $('#done-sub').textContent = $('#chk-data').checked ? 'Your browsing data was deleted too. Thanks for browsing with us.' : 'Your browsing data is still on this PC if you ever come back. Thanks for browsing with us.';
  $('#btn-launch').hidden = true;
  $('#btn-done-close').className = 'primary';
  $('#btn-done-close').innerHTML = '<span>Close</span><i class="sheen"></i>';
  $('#panel-done').hidden = false;
}

// ---------- interruptions ----------
let modalHandlers = {};
function showModal({ title, text, yes, no, onYes, onNo }) {
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text;
  $('#modal-yes').textContent = yes;
  $('#modal-no').textContent = no;
  modalHandlers = { onYes, onNo };
  $('#modal').hidden = false;
  setTimeout(() => $('#modal-yes').focus(), 50);
}
function hideModal() { $('#modal').hidden = true; }
$('#modal-yes').addEventListener('click', () => { hideModal(); modalHandlers.onYes?.(); });
$('#modal-no').addEventListener('click', () => { hideModal(); modalHandlers.onNo?.(); });

// ---------- controls ----------
$('#btn-go').addEventListener('click', () => (state.mode === 'uninstall' ? startUninstall() : startInstall()));
$('#btn-keep').addEventListener('click', async () => { await fadeOut(); send({ type: 'close' }); });
$('#btn-launch').addEventListener('click', async () => { Score.chime([880, 1318.5], 0.1); await fadeOut(); send({ type: 'launch' }); });
$('#btn-done-close').addEventListener('click', async () => { await fadeOut(); send({ type: 'close' }); });
$('#btn-min').addEventListener('click', () => send({ type: 'minimize' }));
$('#btn-close').addEventListener('click', async () => {
  if (document.body.matches('.phase-install, .phase-uninstalling')) return; // never half-installed
  await fadeOut();
  send({ type: 'close' });
});
$('#btn-sound').addEventListener('click', () => {
  Score.setMuted(!Score.muted);
  document.body.classList.toggle('muted', Score.muted);
  $('#btn-sound').title = Score.muted ? 'Sound off' : 'Sound on';
  $('#btn-sound').setAttribute('aria-label', Score.muted ? 'Turn sound on' : 'Turn sound off');
});
// moving the window: the top bar is a drag region; older WebView2s get it through a message instead
$('#chrome').addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('button')) send({ type: 'drag' }); });
document.addEventListener('pointerdown', () => Score.start(), { once: true }); // ordinary browsers only allow sound after a click
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) $('#modal-no').click(); });

// ---------- a pretend Setup, for designing in a browser ----------
const Demo = {
  handle(m) {
    const reply = (msg, ms = 0) => setTimeout(() => onMessage(msg), ms);
    const q = new URLSearchParams(location.search);
    if (m.type === 'ready') reply({ type: 'hello', mode: q.get('mode') || 'install', product: 'Ultima Browser', version: '0.1.0', installed: q.get('installed'), dir: 'C:\\Users\\you\\AppData\\Local\\Programs\\Ultima Browser' }, 50);
    if (m.type === 'install' || m.type === 'closeApp') {
      if (m.type === 'install' && q.get('running')) { reply({ type: 'running' }, 300); return; }
      const total = Number(q.get('seconds') || 5) * 1000;
      const files = ['resources/app.asar', 'Ultima Browser.exe', 'locales/en-US.pak', 'resources.pak', 'icudtl.dat', 'v8_context_snapshot.bin', 'libGLESv2.dll'];
      reply({ type: 'stage', name: 'prepare' });
      for (let t = 0; t <= total; t += 120) reply({ type: 'progress', value: t / total, file: files[Math.floor((t / total) * files.length) % files.length] }, 200 + t);
      reply({ type: 'stage', name: 'finish' }, total + 250);
      reply(q.get('fail') ? { type: 'error', message: 'A file is in use (demo).' } : { type: 'done' }, total + 500);
    }
    if (m.type === 'uninstall') reply({ type: 'done' }, 2600);
    if (m.type === 'launch' || m.type === 'close') console.log(`[demo] ${m.type}`);
  },
};

send({ type: 'ready' });
