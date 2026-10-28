// The task manager's window (tasks.html; Shift+Esc opens it, main.js openTaskManager), like Chrome's: every process
// Ultima runs, what's in it (its windows, tabs, extensions and Chromium's own services), and the memory, processor and
// graphics card each one uses, with the totals over the last two minutes. Ending a process unloads its tabs, which
// load again when they're opened. The numbers come from the main process (src/main/taskmanager.js), every two seconds
// while the window is showing; it has no tabs of its own, so what's in each process (titles, favicons, which page is a
// glance) comes from there too.
const B = { settings: {}, systemDark: true };
const TM = {
  history: [], // { memory, cpu, gpu } per sample, newest last
  sort: { key: 'memory', dir: -1 },
  rows: new Map(), // pid → its row element, kept between samples so a click on End is never lost to a redraw
  last: null, // the latest sample
};
const TM_EVERY = 2000;
const TM_HISTORY = 60;

const SERVICE_NAMES = {
  'Network Service': 'Network', 'Audio Service': 'Audio', 'Storage Service': 'Storage', 'Video Capture': 'Camera',
  'Data Decoder Service': 'Data decoder', 'Unzipper': 'Unzipper', 'Utility: Network Service': 'Network',
};

// ---------- describing a process ----------
function describeProcess(p) {
  const row = { pid: p.pid, memory: p.memory, cpu: p.cpu, gpu: p.gpu?.util ?? null, gpuMemory: p.gpu?.dedicated || 0, canEnd: true, open: null };
  if (p.type === 'Browser') return { ...row, icon: `<span class="tm-logo">${LOGO}</span>`, title: 'Ultima', sub: 'Runs everything else', canEnd: false };
  if (p.type === 'GPU') return { ...row, icon: icon('chip', 18), title: 'Graphics', sub: B.hardwareAcceleration ? 'Draws pages with your graphics card' : 'Draws pages with the processor' };
  if (p.type === 'Utility') return { ...row, icon: icon('settings', 18), title: SERVICE_NAMES[p.name] || p.name || 'Service', sub: 'Service' };
  if (p.type !== 'Tab') return { ...row, icon: icon('settings', 18), title: p.name || p.type, sub: 'Helper' };
  // a renderer: an Ultima window (or this one), or pages
  if (p.contents.some((c) => c.taskManager)) return { ...row, icon: icon('activity', 18), title: 'Task manager', sub: 'This window', canEnd: false };
  if (p.contents.some((c) => c.type === 'window')) return { ...row, icon: icon('sidebar', 18), title: 'Ultima window', sub: 'The sidebar, toolbar and built-in pages', canEnd: false };
  if (!p.contents.length) return { ...row, icon: icon('puzzle', 18), title: 'Background process', sub: 'Extension or page getting ready' };
  const pages = p.contents.map((c) => {
    if (c.glance) return { kind: 'Glance', title: c.title || c.url, fav: favHtml(c.favicon, c.url, c.title) };
    if (c.extension) return { kind: 'Extension', title: c.extension, fav: icon('puzzle', 16) };
    if (c.private) return { kind: 'Private tab', title: 'Private tab', fav: icon('incognito', 16), open: c.id };
    return { kind: 'Tab', title: c.title || c.url, fav: favHtml(c.favicon, c.url, c.title), open: c.id };
  });
  const first = pages[0];
  return {
    ...row,
    icon: first.fav,
    title: pages.length > 1 ? `${first.title} and ${pages.length - 1} more` : first.title,
    sub: pages.length > 1 ? `${pages.length} pages: ${pages.map((x) => x.title).join(', ')}` : first.kind,
    open: pages.length === 1 ? first.open ?? null : null,
  };
}

// ---------- the page ----------
const tmPercent = (v) => (v == null ? '—' : v < 0.05 ? '0%' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);

function drawPage() {
  const root = $('#tw-main');
  const col = (key, label, cls = '') => `<button class="tm-col ${cls}" data-sort="${key}">${label}<span class="tm-arrow"></span></button>`;
  root.innerHTML = `<div class="page tm-page" id="tm-page">
    <p class="sub">What each part of Ultima uses. End a process to free it up.</p>
    <div class="tm-cards">
      ${['memory', 'cpu', 'gpu', 'tasks'].map((k) => `<div class="tm-card" data-card="${k}"><div class="tm-card-label"></div><div class="tm-card-value">—</div><div class="tm-card-sub"></div><svg class="tm-spark" viewBox="0 0 120 32" preserveAspectRatio="none"></svg></div>`).join('')}
    </div>
    <div class="tm-table">
      <div class="tm-head">${col('title', 'Task', 'tm-task')}${col('memory', 'Memory', 'num')}${col('cpu', 'CPU', 'num')}${col('gpu', 'GPU', 'num')}${col('pid', 'Process ID', 'num')}<span class="tm-end-col"></span></div>
      <div class="tm-body"><div class="empty">Reading Ultima’s processes…</div></div>
    </div></div>`;
  $('.tm-head', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    TM.sort = { key, dir: TM.sort.key === key ? -TM.sort.dir : key === 'title' ? 1 : -1 };
    if (TM.last) drawTasks(TM.last);
  });
  $('.tm-body', root).addEventListener('click', (e) => {
    const end = e.target.closest('[data-end]');
    if (end) endTask(Number(end.dataset.end));
    // a tab's row brings its window forward, showing that tab
    const open = e.target.closest('[data-open]');
    if (!end && open) window.ultima.showTaskContents(Number(open.dataset.open));
  });
}

async function sampleTasks() {
  if (document.hidden) return; // (minimized: it picks up again when shown)
  let data;
  try { data = await window.ultima.taskList(); } catch { return; }
  const memory = data.processes.reduce((s, p) => s + p.memory, 0);
  const cpu = data.processes.reduce((s, p) => s + p.cpu, 0);
  TM.history.push({ memory, cpu, gpu: data.gpu?.util ?? null });
  if (TM.history.length > TM_HISTORY) TM.history.shift();
  TM.last = { ...data, memory, cpu };
  drawTasks(TM.last);
}

function sparkline(svg, values, max) {
  if (!values.length) { svg.innerHTML = ''; return; }
  // the newest sample at the right edge, older ones leftward, two minutes across
  const step = 120 / (TM_HISTORY - 1);
  const pts = values.map((v, i) => [120 - (values.length - 1 - i) * step, 31 - (Math.min(v, max) / max) * 29]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  svg.innerHTML = `<path class="tm-spark-area" d="${line} L120,32 L${pts[0][0].toFixed(1)},32 Z"/><path class="tm-spark-line" d="${line}"/>`;
}

function drawCards(d) {
  const card = (k, label, value, sub, values, max) => {
    const el = $(`[data-card="${k}"]`);
    if (!el) return;
    $('.tm-card-label', el).textContent = label;
    $('.tm-card-value', el).textContent = value;
    $('.tm-card-sub', el).textContent = sub;
    if (values) sparkline($('.tm-spark', el), values, max); else $('.tm-spark', el).innerHTML = '';
  };
  const hist = TM.history;
  card('memory', 'Memory', fmtBytes(d.memory), `of ${fmtBytes(d.system.memory)} in this computer`, hist.map((x) => x.memory), Math.max(...hist.map((x) => x.memory)) * 1.15 || 1);
  card('cpu', 'CPU', tmPercent(d.cpu), `of your processor’s ${d.system.cores} threads`, hist.map((x) => x.cpu), Math.max(10, ...hist.map((x) => x.cpu * 1.2)));
  if (d.gpu) {
    card('gpu', 'GPU', tmPercent(d.gpu.util), `${fmtBytes(d.gpu.dedicated)} of graphics memory`, hist.map((x) => x.gpu ?? 0), Math.max(10, ...hist.map((x) => (x.gpu ?? 0) * 1.2)));
  } else {
    card('gpu', 'GPU', '—', d.gpuSupported ? 'Reading your graphics card…' : 'Not reported on this system');
  }
  const pages = d.processes.flatMap((p) => p.contents).filter((c) => c.type === 'webview' && !c.extension && !c.glance).length;
  card('tasks', 'Processes', String(d.processes.length), `${pages} ${pages === 1 ? 'tab' : 'tabs'} loaded`);
}

function drawTasks(d) {
  drawCards(d);
  const body = $('.tm-body');
  if (!body) return;
  const rows = d.processes.map(describeProcess);
  const { key, dir } = TM.sort;
  rows.sort((a, b) => {
    const x = a[key] ?? -1;
    const y = b[key] ?? -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  $$('.tm-col').forEach((c) => {
    c.classList.toggle('on', c.dataset.sort === key);
    $('.tm-arrow', c).innerHTML = c.dataset.sort === key ? icon(dir > 0 ? 'arrowUp' : 'arrowDown', 12) : '';
  });
  body.querySelector('.empty')?.remove();
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.pid);
    let el = TM.rows.get(r.pid);
    if (!el) {
      el = h(`<div class="tm-row"><span class="tm-task"><span class="tm-icon"></span><span class="tm-names"><span class="tm-title"></span><span class="tm-sub"></span></span></span>
        <span class="num tm-mem"></span><span class="num tm-cpu"></span><span class="num tm-gpu"></span><span class="num tm-pid"></span><span class="tm-end-col"></span></div>`);
      TM.rows.set(r.pid, el);
    }
    // only what changed is rewritten, so hovering and clicking stay steady
    const set = (sel, html, prop = 'innerHTML') => { const c = $(sel, el); if (c[prop] !== html) c[prop] = html; };
    // compared with what was drawn, not the element: a favicon that fails swaps itself for a letter (util.js)
    if (el.drawnIcon !== r.icon) { $('.tm-icon', el).innerHTML = r.icon; el.drawnIcon = r.icon; }
    set('.tm-title', r.title, 'textContent');
    set('.tm-sub', r.sub, 'textContent');
    $('.tm-task', el).title = `${r.title}\n${r.sub}`;
    set('.tm-mem', fmtBytes(r.memory), 'textContent');
    set('.tm-cpu', tmPercent(r.cpu), 'textContent');
    set('.tm-gpu', r.gpu == null ? '—' : tmPercent(r.gpu), 'textContent');
    $('.tm-gpu', el).title = r.gpuMemory ? `${fmtBytes(r.gpuMemory)} of graphics memory` : '';
    set('.tm-pid', String(r.pid), 'textContent');
    set('.tm-end-col', r.canEnd ? `<button class="btn tm-end" data-end="${r.pid}">End</button>` : '');
    el.classList.toggle('tm-busy', r.cpu >= 25);
    el.classList.toggle('tm-tab', r.open != null);
    if (r.open != null) el.dataset.open = r.open; else delete el.dataset.open;
    body.append(el); // in sorted order (moving an element keeps it, and the pointer over it)
  }
  for (const [pid, el] of TM.rows) if (!seen.has(pid)) { el.remove(); TM.rows.delete(pid); }
}

async function endTask(pid) {
  const r = TM.last && describeProcess(TM.last.processes.find((p) => p.pid === pid) || { contents: [] });
  const res = await window.ultima.taskEnd(pid).catch(() => null);
  if (!res?.ok) { toast('That process can’t be ended'); return; }
  const name = r?.title || `Process ${pid}`;
  toast(res.pages ? `Ended “${name}”: ${res.pages === 1 ? 'its tab was' : `${res.pages} pages were`} unloaded` : `Ended “${name}”${r?.title === 'Graphics' ? '. It starts again by itself' : ''}`);
  setTimeout(sampleTasks, 400);
}

// ---------- the window ----------
// Ultima's light or dark mode and accent color, and its glass (the window's own Acrylic or Mica)
function applyWindowTheme() {
  const s = B.settings;
  const root = document.documentElement;
  root.dataset.theme = (s.theme === 'system' ? B.systemDark : s.theme !== 'light') ? 'dark' : 'light';
  root.style.setProperty('--accent', s.accent || '#8b5cf6');
  document.body.classList.toggle('glass', Boolean(B.glass));
  document.body.classList.toggle('acrylic', Boolean(B.backdrops) && s.windowMaterial === 'acrylic');
  const styles = getComputedStyle(root);
  window.ultima.setOverlay({ color: styles.getPropertyValue('--chrome-solid').trim(), symbolColor: styles.getPropertyValue('--text').trim() });
}

async function initTaskWindow() {
  const state = await window.ultima.getState();
  Object.assign(B, {
    settings: state.settings, systemDark: state.systemDark, glass: state.glass, backdrops: state.backdrops, hardwareAcceleration: state.hardwareAcceleration,
  });
  document.body.classList.toggle('mac', state.platform === 'darwin');
  $('.tw-logo').innerHTML = LOGO;
  applyWindowTheme();
  window.ultima.on('settings-changed', (patch) => { Object.assign(B.settings, patch); applyWindowTheme(); });
  window.ultima.on('system-theme', (dark) => { B.systemDark = dark; applyWindowTheme(); });
  // Ctrl+W closes it, and so does Shift+Esc, the shortcut that opened it
  document.addEventListener('keydown', (e) => {
    if (((e.ctrlKey || e.metaKey) && (e.code === 'KeyW' || e.key.toLowerCase() === 'w')) || (e.shiftKey && e.key === 'Escape')) window.close();
  });
  drawPage();
  sampleTasks();
  setInterval(sampleTasks, TM_EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sampleTasks(); });
}

initTaskWindow();
