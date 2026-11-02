// Ultima's own updates (main: updater.js): the Updates row in Settings → About, and a note when one is ready.
const UPDATE = { state: null, told: false };

function updateRowHtml() {
  const s = UPDATE.state || { status: 'off' };
  const check = `<button class="btn" data-update-check ${s.status === 'checking' || s.status === 'downloading' ? 'disabled' : ''}>Check now</button>`;
  const [desc, control] = {
    off: ['This copy of Ultima doesn’t update itself.', ''],
    idle: ['Ultima keeps itself up to date.', check],
    checking: ['Checking for updates…', check],
    current: ['Ultima is up to date.', check],
    downloading: [`Downloading Ultima ${esc(s.version)}… ${Math.round((s.progress || 0) * 100)}%`, check],
    ready: [`Ultima ${esc(s.version)} is ready. It installs when Ultima closes.`, `<button class="btn primary" data-update-restart>${icon('reload', 14)} Restart to update</button>`],
    error: ['Couldn’t check for updates. Ultima tries again later.', check],
  }[s.status] || ['', check];
  return sRow('Updates', desc, control, 'data-update-row');
}

function applyUpdateState(s, { quiet = false } = {}) {
  UPDATE.state = s;
  const row = $('[data-update-row]');
  if (row) row.outerHTML = updateRowHtml();
  if (s.status === 'ready' && !UPDATE.told && !quiet && document.hasFocus()) {
    UPDATE.told = true;
    toast(`Ultima ${s.version} is ready`, { label: 'Restart', run: () => window.ultima.restartToUpdate() });
  }
}

function initUpdates() {
  window.ultima.updateState().then((s) => applyUpdateState(s, { quiet: true }));
  window.ultima.on('update-state', (s) => applyUpdateState(s));
  // the row's buttons (Settings → About)
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-update-restart]')) { window.ultima.restartToUpdate(); return; }
    const btn = e.target.closest('[data-update-check]');
    if (!btn) return;
    UPDATE.told = true; // the row says it; no toast as well
    const s = await window.ultima.checkForUpdate();
    if (s.status === 'current') toast('Ultima is up to date');
  });
}
