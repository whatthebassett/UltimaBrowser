// The task manager (ultima://tasks, Shift+Esc), like Chrome's: every process Ultima runs, what's in it (its windows,
// tabs, extensions and Chromium's own services), and the memory, processor and graphics card each one uses, with the
// totals over the last two minutes. Ending a process unloads its tabs, which load again when they're opened.
// The numbers come from the main process (src/main/taskmanager.js); the page asks for them every two seconds while
// it's in front.
const TM = {
  history: [], // { memory, cpu, gpu } per sample, newest last
  sort: { key: 'memory', dir: -1 },
  rows: new Map(), // pid → its row element, kept between samples so a click on End is never lost to a redraw
  last: null, // the latest sample
  ended: new Set(), // webContents ids of pages whose process the task manager ended (see endedByTaskManager)
};
const TM_EVERY = 2000;
const TM_HISTORY = 60;

const SERVICE_NAMES = {
  'Network Service': 'Network', 'Audio Service': 'Audio', 'Storage Service': 'Storage', 'Video Capture': 'Camera',
  'Data Decoder Service': 'Data decoder', 'Unzipper': 'Unzipper', 'Utility: Network Service': 'Network',
};

// ---------- describing a process ----------
function localTabsByContents() {
  const map = new Map();
  for (const t of B.tabs) if (ready(t)) { try { map.set(t.webview.getWebContentsId(), t); } catch { /* detached */ } }
  return map;
}

function describeProcess(p, tabs) {
  const glanceId = (() => { try { return GL.open?.wv.getWebContentsId(); } catch { return null; } })();
  const row = { pid: p.pid, memory: p.memory, cpu: p.cpu, gpu: p.gpu?.util ?? null, gpuMemory: p.gpu?.dedicated || 0, canEnd: true, tabs: [] };
  if (p.type === 'Browser') return { ...row, icon: `<span class="tm-logo">${LOGO}</span>`, title: 'Ultima', sub: 'Browser: runs everything else', canEnd: false };
  if (p.type === 'GPU') {
    return { ...row, icon: icon('chip', 18), title: 'Graphics', sub: B.hardwareAcceleration ? 'GPU process: draws pages with your graphics card' : 'GPU process: draws pages with the processor (hardware acceleration is off)' };
  }
  if (p.type === 'Utility') return { ...row, icon: icon('settings', 18), title: SERVICE_NAMES[p.name] || p.name || 'Service', sub: 'Service' };
  if (p.type !== 'Tab') return { ...row, icon: icon('settings', 18), title: p.name || p.type, sub: 'Helper' };
  // a renderer: Ultima's own window, or pages
  if (p.contents.some((c) => c.type === 'window')) {
    return { ...row, icon: icon('sidebar', 18), title: 'Ultima window', sub: 'The sidebar, toolbar and built-in pages', canEnd: false };
  }
  if (!p.contents.length) return { ...row, icon: icon('puzzle', 18), title: 'Background process', sub: 'An extension’s background work, or a page getting ready' };
  const pages = p.contents.map((c) => {
    const tab = tabs.get(c.id);
    if (tab) return { kind: tab.private ? 'Private tab' : 'Tab', title: tab.name || tab.title || tab.url, fav: favHtml(tab.favicon, tab.url, tab.title), tab };
    if (c.id === glanceId) return { kind: 'Glance', title: c.title || c.url, fav: favHtml('', c.url, c.title) };
    if (c.extension) return { kind: 'Extension', title: c.extension, fav: icon('puzzle', 16) };
    return { kind: c.private ? 'Private tab' : 'Tab in another window', title: c.private ? 'Private tab' : c.title || c.url, fav: c.private ? icon('incognito', 16) : favHtml('', c.url, c.title) };
  });
  const first = pages[0];
  const kinds = [...new Set(pages.map((x) => x.kind))];
  return {
    ...row,
    icon: first.fav,
    title: pages.length > 1 ? `${first.title} and ${pages.length - 1} more` : first.title,
    sub: pages.length > 1 ? `${pages.length} pages: ${pages.map((x) => x.title).join(', ')}` : kinds[0],
    tabs: pages.filter((x) => x.tab).map((x) => x.tab),
  };
}

// ---------- the page ----------
const tmPercent = (v) => (v == null ? '—' : v < 0.05 ? '0%' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
const tmShowing = () => isInternal(activeTab()?.url) && internalName(activeTab().url) === 'tasks' && $('#tm-page');

function pageTasks(root) {
  TM.rows.clear();
  const col = (key, label, cls = '') => `<button class="tm-col ${cls}" data-sort="${key}">${label}<span class="tm-arrow"></span></button>`;
  root.innerHTML = `<div class="page tm-page" id="tm-page"><h1>Task manager</h1>
    <p class="sub">Every process Ultima runs and what it uses. End one to free what it takes: its tabs are unloaded, and load again when you open them.</p>
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
    // a tab's row opens that tab
    const open = e.target.closest('[data-open]');
    if (!end && open) activateTab(Number(open.dataset.open));
  });
  sampleTasks();
  pageTimer = setInterval(sampleTasks, TM_EVERY);
}

async function sampleTasks() {
  if (!tmShowing()) { clearInterval(pageTimer); return; } // the page went to the back: it starts again when shown
  let data;
  try { data = await window.ultima.taskList(); } catch { return; }
  if (!tmShowing()) return;
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
  const loaded = B.tabs.filter((t) => t.webview).length;
  card('tasks', 'Processes', String(d.processes.length), `${loaded} of ${B.tabs.length} tabs loaded in this window`);
}

function drawTasks(d) {
  drawCards(d);
  const body = $('.tm-body');
  if (!body) return;
  const tabs = localTabsByContents();
  const rows = d.processes.map((p) => describeProcess(p, tabs));
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
    el.classList.toggle('tm-tab', r.tabs.length === 1);
    if (r.tabs.length === 1) el.dataset.open = r.tabs[0].id; else delete el.dataset.open;
    body.append(el); // in sorted order (moving an element keeps it, and the pointer over it)
  }
  for (const [pid, el] of TM.rows) if (!seen.has(pid)) { el.remove(); TM.rows.delete(pid); }
}

async function endTask(pid) {
  const r = TM.last && describeProcess(TM.last.processes.find((p) => p.pid === pid) || {}, localTabsByContents());
  const res = await window.ultima.taskEnd(pid).catch(() => null);
  if (!res?.ok) { toast('That process can’t be ended'); return; }
  const name = r?.title || `Process ${pid}`;
  toast(res.pages ? `Ended “${name}”: ${res.pages === 1 ? 'its tab was' : `${res.pages} pages were`} unloaded` : `Ended “${name}”${r?.title === 'Graphics' ? '. It starts again by itself' : ''}`);
  setTimeout(sampleTasks, 400);
}

// A page whose process the task manager ended is unloaded rather than shown as crashed (tabs.js asks this when a
// page's process goes).
function endedByTaskManager(wv) {
  try {
    const id = wv.getWebContentsId();
    if (!TM.ended.has(id)) return false;
    TM.ended.delete(id);
    return true;
  } catch { return false; }
}

function initTaskManager() {
  window.ultima.on('tasks-ended', (ids) => {
    for (const id of ids || []) TM.ended.add(id);
    setTimeout(() => { for (const id of ids || []) TM.ended.delete(id); }, 5000); // in case one never goes
  });
}
