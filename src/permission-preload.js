// A permission you haven't decided on yet reads as "prompt" to sites (Notification.permission "default"), as in
// Chrome. Electron reports anything it doesn't allow as "denied", so sites that check before asking never asked.
// A session preload (see setupSession in main.js), so it runs in every frame before the page's own scripts.
const { contextBridge, ipcRenderer } = require('electron');

const undecided = (key) => ipcRenderer.sendSync('ultima:permission-undecided', key);

function installPermissionStates(isUndecided) {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    // permissions.query() names → site settings keys (sitepermissions.js)
    const KEYS = {
      geolocation: 'geolocation', camera: 'camera', microphone: 'microphone', notifications: 'notifications', push: 'notifications',
      'clipboard-read': 'clipboard-read', 'window-management': 'window-management', 'idle-detection': 'idle-detection',
    };
    const native = (fn, name) => {
      Object.defineProperty(fn, 'toString', { value: () => `function ${name}() { [native code] }`, configurable: true, writable: true });
      return fn;
    };
    const stateOf = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state').get;
    const query = Permissions.prototype.query;
    Object.defineProperty(Permissions.prototype, 'query', {
      value: native(function query_(descriptor) {
        return query.call(this, descriptor).then((status) => {
          const name = descriptor && descriptor.name;
          const key = name === 'midi' ? (descriptor.sysex ? 'midiSysex' : null) : KEYS[name];
          if (key) {
            Object.defineProperty(status, 'state', {
              get: () => { const s = stateOf.call(status); return s === 'denied' && isUndecided(key) ? 'prompt' : s; }, configurable: true,
            });
          }
          return status;
        });
      }, 'query'),
      configurable: true, writable: true, enumerable: true,
    });
    const permission = Object.getOwnPropertyDescriptor(Notification, 'permission');
    if (permission && permission.get) {
      Object.defineProperty(Notification, 'permission', {
        get: native(function permission_() { const p = permission.get.call(this); return p === 'denied' && isUndecided('notifications') ? 'default' : p; }, 'get permission'),
        configurable: true, enumerable: permission.enumerable,
      });
    }
  } catch { /* the page keeps Electron's answers */ }
}

if (process.contextIsolated) contextBridge.executeInMainWorld({ func: installPermissionStates, args: [undecided] });
else installPermissionStates(undecided);
