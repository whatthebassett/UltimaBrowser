// A permission you haven't decided on yet reads as "prompt" to sites (Notification.permission "default"), as in
// Chrome. Electron reports anything it doesn't allow as "denied", so sites that check before asking never asked.
// A session preload (see setupSession in main.js), so it runs in every frame before the page's own scripts.
const { contextBridge, ipcRenderer } = require('electron');

const undecided = (key) => ipcRenderer.sendSync('ultima:permission-undecided', key);

function installPermissionStates(isUndecided, token) {
  try {
    if (!/^https?:$/.test(location.protocol)) return;
    // permissions.query() names → site settings keys (sitepermissions.js)
    const KEYS = {
      geolocation: 'geolocation', camera: 'camera', microphone: 'microphone', notifications: 'notifications', push: 'notifications',
      'clipboard-read': 'clipboard-read', 'window-management': 'window-management', 'idle-detection': 'idle-detection',
    };
    // like Chrome's own functions: no prototype (methods and accessors), and they print as built-in (native-preload.js)
    const native = (fn, name) => { try { Function.prototype.toString.call(fn, token, `function ${name}() { [native code] }`); } catch { /* as it is */ } return fn; };
    const getter = (obj, prop) => Object.getOwnPropertyDescriptor(obj, prop).get;
    // a status's state is read through the prototype, as in Chrome (not a property of its own)
    const keyOf = new WeakMap(); // PermissionStatus → its site settings key
    const state = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state');
    const stateOf = state.get;
    Object.defineProperty(PermissionStatus.prototype, 'state', {
      ...state,
      get: native(getter({ get state() { const s = stateOf.call(this); const key = keyOf.get(this); return s === 'denied' && key && isUndecided(key) ? 'prompt' : s; } }, 'state'), 'get state'),
    });
    const query = Permissions.prototype.query;
    Object.defineProperty(Permissions.prototype, 'query', {
      value: native({
        query(descriptor) {
          return query.call(this, descriptor).then((status) => {
            const name = descriptor && descriptor.name;
            const key = name === 'midi' ? (descriptor.sysex ? 'midiSysex' : null) : KEYS[name];
            if (key) keyOf.set(status, key);
            return status;
          });
        },
      }.query, 'query'),
      configurable: true, writable: true, enumerable: true,
    });
    const permission = Object.getOwnPropertyDescriptor(Notification, 'permission');
    if (permission && permission.get) {
      Object.defineProperty(Notification, 'permission', {
        get: native(getter({ get permission() { const p = permission.get.call(this); return p === 'denied' && isUndecided('notifications') ? 'default' : p; } }, 'permission'), 'get permission'),
        configurable: true, enumerable: permission.enumerable,
      });
    }
  } catch { /* the page keeps Electron's answers */ }
}

if (process.contextIsolated) contextBridge.executeInMainWorld({ func: installPermissionStates, args: [undecided, globalThis.__ultimaNativeToken] });
else installPermissionStates(undecided, globalThis.__ultimaNativeToken);
