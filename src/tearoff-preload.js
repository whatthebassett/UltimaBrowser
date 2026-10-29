// The tear-off ghost (renderer/tearoff.html): it only hears where the pointer is and what to draw, and says when its
// last animation is done.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghost', {
  on: (cb) => ipcRenderer.on('ghost', (_e, msg) => cb(msg)),
  settled: () => ipcRenderer.send('ghost:settled'),
});
