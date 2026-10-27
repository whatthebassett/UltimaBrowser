// The task manager's numbers (ultima://tasks, Shift+Esc): every Ultima process with its memory and CPU, what runs in it
// (windows, tabs, extensions, Chromium's services), and on Windows how much of the graphics card each one uses.
const os = require('os');
const { spawn } = require('child_process');
const { app, webContents } = require('electron');

// ---- graphics card use (Windows) ----
// Windows keeps GPU counters per process (what Task Manager's GPU column shows). Reading them takes a few hundred ms,
// so a PowerShell helper stays running while the task manager is open: it's sent the process ids to look at, a line
// at a time, and answers each with one line of JSON. It quits when it hasn't been asked for a while.
const GPU_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $ids = @($line -split ',' | Where-Object { $_ -match '^[0-9]+$' })
  if (-not $ids.Count) { [Console]::Out.WriteLine('{}'); continue }
  $f = ($ids | ForEach-Object { "Name LIKE 'pid_$($_)[_]%'" }) -join ' OR '
  $e = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter $f | ForEach-Object { @{ n = $_.Name; u = [double]$_.UtilizationPercentage } })
  $m = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Filter $f | ForEach-Object { @{ n = $_.Name; d = [double]$_.DedicatedUsage; s = [double]$_.SharedUsage } })
  [Console]::Out.WriteLine((@{ e = $e; m = $m } | ConvertTo-Json -Compress -Depth 3))
}`;
const GPU_IDLE_MS = 15000;

class GpuSampler {
  constructor() {
    this.proc = null;
    this.waiting = null; // resolves with the next answer
    this.buffer = '';
    this.last = null; // { byPid: { pid: { util, dedicated, shared } }, util, dedicated }
    this.idleTimer = null;
  }

  start() {
    const encoded = Buffer.from(GPU_SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.answer(line);
      }
    });
    const gone = () => { this.proc = null; this.waiting?.(null); this.waiting = null; };
    this.proc.on('exit', gone);
    this.proc.on('error', gone);
  }

  answer(line) {
    try { this.last = summarizeGpu(JSON.parse(line)); } catch { /* a stray line */ }
    this.waiting?.(this.last);
    this.waiting = null;
  }

  // The latest numbers for these processes. A reading still under way isn't waited for: the one before it is
  // returned, and the next call gets the new one.
  sample(pids) {
    if (process.platform !== 'win32') return Promise.resolve(null);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), GPU_IDLE_MS);
    if (!this.proc) this.start();
    if (this.waiting) return Promise.resolve(this.last);
    const next = new Promise((resolve) => { this.waiting = resolve; });
    this.proc.stdin.write(`${pids.join(',')}\n`);
    // the first answer takes longest: until it comes, show what there is
    return this.last ? Promise.resolve(this.last) : Promise.race([next, new Promise((r) => setTimeout(() => r(null), 3000))]);
  }

  stop() {
    clearTimeout(this.idleTimer);
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); }
    this.proc = null;
    this.last = null;
  }
}

// Counter names look like pid_1234_luid_..._phys_0_eng_3_engtype_3D. Like Task Manager, a process's use is its
// busiest kind of engine (3D, video decode, copy…), each kind added up over that kind's engines.
function summarizeGpu(raw) {
  const perPid = new Map(); // pid → Map(engtype → %)
  const total = new Map(); // engtype → %
  for (const { n, u } of [].concat(raw.e || [])) {
    const m = /^pid_(\d+)_.*engtype_(.+)$/.exec(n || '');
    if (!m) continue;
    const types = perPid.get(m[1]) || new Map();
    types.set(m[2], (types.get(m[2]) || 0) + (u || 0));
    perPid.set(m[1], types);
    total.set(m[2], (total.get(m[2]) || 0) + (u || 0));
  }
  const byPid = {};
  for (const [pid, types] of perPid) byPid[pid] = { util: Math.min(100, Math.max(0, ...types.values())), dedicated: 0, shared: 0 };
  let dedicated = 0;
  for (const { n, d, s } of [].concat(raw.m || [])) {
    const m = /^pid_(\d+)_/.exec(n || '');
    if (!m) continue;
    byPid[m[1]] = byPid[m[1]] || { util: 0, dedicated: 0, shared: 0 };
    byPid[m[1]].dedicated += d || 0;
    byPid[m[1]].shared += s || 0;
    dedicated += d || 0;
  }
  return { byPid, util: Math.min(100, Math.max(0, ...total.values())), dedicated };
}

const gpu = new GpuSampler();

// ---- processes ----
function extensionName(wc, url) {
  const id = /^chrome-extension:\/\/([a-p]{32})/.exec(url || '')?.[1];
  if (!id) return null;
  try {
    const ses = wc.session;
    return (ses.extensions?.getExtension?.(id) || ses.getExtension?.(id))?.name || 'Extension';
  } catch { return 'Extension'; }
}

// What runs in each renderer process: the webContents it hosts (Ultima's windows, pages, extension pages).
function contentsByPid(isPrivate) {
  const map = new Map();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    let pid;
    try { pid = wc.getOSProcessId(); } catch { continue; }
    if (!pid) continue;
    const url = wc.getURL();
    const list = map.get(pid) || [];
    list.push({
      id: wc.id,
      type: wc.getType(), // window (Ultima itself), webview (a tab, glance or extension popup), backgroundPage, …
      url,
      title: wc.getTitle(),
      extension: extensionName(wc, url),
      private: isPrivate(wc),
      host: wc.hostWebContents?.id ?? null, // the Ultima window showing it
      audible: wc.isCurrentlyAudible(),
    });
    map.set(pid, list);
  }
  return map;
}

async function collect({ isPrivate }) {
  const metrics = app.getAppMetrics();
  const contents = contentsByPid(isPrivate);
  const cores = os.cpus().length || 1;
  const gpuNow = await gpu.sample(metrics.map((m) => m.pid)).catch(() => null);
  const processes = metrics.map((m) => ({
    pid: m.pid,
    type: m.type, // Browser, Tab (a renderer), GPU, Utility, …
    name: m.name || m.serviceName || '',
    // private memory where the system reports it (what Windows Task Manager shows), else the working set; in KB
    memory: (m.memory.privateBytes || m.memory.workingSetSize || 0) * 1024,
    cpu: (m.cpu.percentCPUUsage || 0) / cores, // share of the whole processor, like Task Manager
    gpu: gpuNow?.byPid[m.pid] || null,
    started: m.creationTime,
    contents: contents.get(m.pid) || [],
  }));
  return {
    processes,
    gpu: gpuNow ? { util: gpuNow.util, dedicated: gpuNow.dedicated } : null,
    gpuSupported: process.platform === 'win32',
    system: { memory: os.totalmem(), freeMemory: os.freemem(), cores },
    uptime: process.uptime(),
  };
}

// Ends one of Ultima's processes. Not Ultima itself, and not the one drawing an Ultima window: either would take
// the windows with it. Returns the pages that were in it, so the windows showing them can unload them.
function endProcess(pid) {
  const m = app.getAppMetrics().find((x) => x.pid === pid);
  if (!m || m.type === 'Browser') return { ok: false };
  const hosted = contentsByPid(() => false).get(pid) || [];
  if (hosted.some((c) => c.type === 'window')) return { ok: false };
  return {
    ok: true,
    contents: hosted.map((c) => c.id),
    kill: () => {
      const wc = hosted.length && webContents.fromId(hosted[0].id);
      if (wc && !wc.isDestroyed()) wc.forcefullyCrashRenderer();
      else try { process.kill(pid); } catch { /* already gone */ }
    },
  };
}

module.exports = { collect, endProcess, stopGpu: () => gpu.stop() };
