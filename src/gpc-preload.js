// Global Privacy Control: navigator.globalPrivacyControl is true in every page, as the Sec-GPC header main.js adds to
// requests says too. It asks sites not to sell or share your data (a legal request in California and some other
// places). Registered as a session preload only while the setting is on (see applyGpcPreload in main.js).
const { contextBridge } = require('electron');

function installGpc() {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
      get: function globalPrivacyControl() { return true; }, configurable: true, enumerable: true,
    });
  } catch { /* the page's own definition stays */ }
}

if (process.contextIsolated) contextBridge.executeInMainWorld({ func: installGpc });
else installGpc();
