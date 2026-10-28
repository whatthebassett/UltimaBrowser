// The task manager (Shift+Esc) opens in a window of its own (tasks.html, taskwindow.js). What stays here is what an
// Ultima window does for it: showing a tab when its row is clicked, and unloading the tabs whose process it ended.
const TM = {
  ended: new Set(), // webContents ids of pages whose process the task manager ended (see endedByTaskManager)
};

const openTaskManager = () => window.ultima.openTaskManager();

// ultima://tasks: a tab from before the task manager had a window of its own
function pageTasks(root) {
  root.innerHTML = `<div class="page"><h1>Task manager</h1><p class="sub">The task manager opens in its own window.</p>
    <button class="btn primary" data-tm-open>${icon('activity', 14)} Open task manager</button></div>`;
  $('[data-tm-open]', root).onclick = openTaskManager;
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
  // a tab's row clicked in the task manager (main.js has already brought this window forward)
  window.ultima.on('show-contents', (id) => {
    const tab = B.tabs.find((t) => { try { return ready(t) && t.webview.getWebContentsId() === id; } catch { return false; } });
    if (tab) activateTab(tab.id);
  });
}
