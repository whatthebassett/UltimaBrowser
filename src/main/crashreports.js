// Crash reports, only for those who turn them on (Settings → Privacy → Send crash reports). They go to Ultima's Sentry
// project and say what went wrong: a crash of any of Ultima's processes (Electron's crash reporter writes a minidump of
// it, sent to Sentry's minidump address), or an error in Ultima's own scripts (sent as a Sentry event). File paths are
// trimmed of your user folder; pages' addresses aren't added.
// With no project set (SENTRY_DSN below empty), nothing is ever sent, whatever the setting says; crashes are still
// written to the crashDumps folder in Ultima's data, where they stay.
const os = require('os');
const crypto = require('crypto');
const { app, crashReporter, net } = require('electron');

// Sentry → Project settings → Client Keys (DSN). ULTIMA_SENTRY_DSN, when set, takes its place (for testing).
const SENTRY_DSN = 'https://0417917b6397a1ac0fe3867838821adc@o4512385450835968.ingest.us.sentry.io/4512385477378048';
const MAX_EVENTS = 20; // errors sent per run at most (a script error in a loop doesn't send hundreds)

let project = null; // { key, origin, id, dsn }
let enabled = false;
let sent = 0;
const seen = new Set();

function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const id = u.pathname.replace(/^\/+|\/+$/g, '');
    return u.username && id ? { key: u.username, origin: `${u.protocol}//${u.host}`, id, dsn } : null;
  } catch { return null; }
}
const release = () => `ultima-browser@${app.getVersion()}`;
const environment = () => (app.isPackaged ? 'production' : 'development');

// Before the app is ready (so every process is covered): the crash reporter, sending only while turned on
function startCrashReports(optedIn) {
  project = parseDsn(process.env.ULTIMA_SENTRY_DSN || SENTRY_DSN);
  enabled = Boolean(optedIn && project);
  crashReporter.start({
    submitURL: project ? `${project.origin}/api/${project.id}/minidump/?sentry_key=${project.key}` : '',
    uploadToServer: enabled,
    compress: true,
    globalExtra: { 'sentry[release]': release(), 'sentry[environment]': environment() },
  });
  // errors in the main process's scripts (watched only: Electron still handles them as before)
  process.on('uncaughtExceptionMonitor', (err) => reportError(err, 'main'));
  process.on('unhandledRejection', (reason) => {
    console.warn('Unhandled promise rejection:', reason); // (as Node would have said, which a listener stops)
    reportError(reason, 'main');
  });
}

function setCrashReports(optedIn) {
  enabled = Boolean(optedIn && project);
  try { crashReporter.setUploadToServer(enabled); } catch { /* not started */ }
}
const crashReportsReady = () => Boolean(project);

// your user folder and Ultima's own folder out of file paths
function tidy(text) {
  let s = String(text || '');
  const strip = (from, to) => { if (from) s = s.split(from).join(to).split(from.replace(/\\/g, '/')).join(to); };
  strip(app.getAppPath(), 'app:');
  strip(os.homedir(), '~');
  return s.replace(/file:\/\/\/?/g, '').replace(/\\/g, '/');
}

// "    at fn (file:line:col)" lines → Sentry's frames, the oldest first
function framesOf(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (m) frames.push({ function: m[1] || '?', filename: tidy(m[2]), lineno: Number(m[3]), colno: Number(m[4]), in_app: !/node:|electron\//.test(m[2]) });
  }
  return frames.reverse();
}

// An error from Ultima's scripts: `where` is the process (main, or a window's own page)
function reportError(err, where, extra = {}) {
  if (!enabled || sent >= MAX_EVENTS) return;
  const type = err?.name || (err instanceof Error ? 'Error' : 'Error');
  const value = tidy(err?.message ?? String(err));
  const stack = err?.stack || extra.stack || '';
  const sig = `${where}|${type}|${value}|${String(stack).split('\n')[1] || ''}`;
  if (seen.has(sig)) return; // the same error again: once is enough
  seen.add(sig);
  sent += 1;
  const id = crypto.randomUUID().replace(/-/g, '');
  const frames = framesOf(stack);
  if (!frames.length && extra.file) frames.push({ filename: tidy(extra.file), lineno: extra.line || 0, colno: extra.column || 0, in_app: true });
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    release: release(),
    environment: environment(),
    tags: { process: where },
    // who sent it isn't worked out from the connection either (Sentry would keep the IP address and a rough location)
    sdk: { name: 'ultima.crashreports', version: app.getVersion(), settings: { infer_ip: 'never' } },
    contexts: {
      os: { name: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux', version: os.release() },
      runtime: { name: 'Electron', version: process.versions.electron },
    },
    exception: { values: [{ type, value, stacktrace: frames.length ? { frames } : undefined }] },
  };
  const body = [JSON.stringify({ event_id: id, dsn: project.dsn, sent_at: new Date().toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
  const send = () => net.fetch(`${project.origin}/api/${project.id}/envelope/?sentry_key=${project.key}&sentry_version=7`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope' }, body,
  }).catch(() => { /* offline: not kept */ });
  if (app.isReady()) send(); else app.whenReady().then(send);
}

module.exports = { startCrashReports, setCrashReports, crashReportsReady, reportError };
