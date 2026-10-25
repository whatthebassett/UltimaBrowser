// Making Ultima the default browser, and opening the link or file it was launched with.
// Windows 10/11 don't let an app make itself the default: Ultima registers as a browser (the same per-user registry
// keys Chrome and Firefox write) and opens Windows Settings at its entry under Default apps, where one click makes it
// the default. macOS and Linux let Electron ask for the http/https links directly.
const { app, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_NAME = 'Ultima Browser'; // its name in Windows Settings (RegisteredApplications)
const PROG_ID = 'UltimaHTML';
const CLIENT_KEY = 'Software\\Clients\\StartMenuInternet\\UltimaBrowser';
const FILE_TYPES = ['.htm', '.html', '.shtml', '.xht', '.xhtml'];
// Windows' AppUserModelID: the taskbar groups windows and finds their icon by it. Run from source, Ultima has its own,
// so it never shares a taskbar button with an installed Ultima, or inherits what Windows remembers about one (an
// uninstalled copy's shortcut leaves the taskbar showing a blank page for its ID until Explorer restarts).
const APP_ID = process.defaultApp ? 'com.ultimabass.ultimabrowser.dev' : 'com.ultimabass.ultimabrowser';

const reg = (args) => new Promise((resolve) => {
  execFile('reg', args, { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
});

// how Windows starts Ultima: the installed exe, or electron.exe with this app's folder when run from source
function exeCommand() {
  return process.defaultApp ? `"${process.execPath}" "${app.getAppPath()}"` : `"${process.execPath}"`;
}

// The .reg file that registers Ultima as a browser for the current user. --single-argument (as Chrome uses) makes
// Chromium take the rest of the line as the link, whatever it contains, never as switches.
function registryFile() {
  const s = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const icon = `"${process.execPath}",0`;
  const open = `${exeCommand()} --single-argument %1`;
  const key = (name, values) => `[HKEY_CURRENT_USER\\${name}]\r\n${Object.entries(values).map(([k, v]) => `${k === '@' ? '@' : s(k)}=${s(v)}`).join('\r\n')}\r\n`;
  return ['Windows Registry Editor Version 5.00\r\n',
    key(`Software\\Classes\\${PROG_ID}`, { '@': 'Ultima HTML Document', 'URL Protocol': '' }),
    key(`Software\\Classes\\${PROG_ID}\\Application`, { ApplicationName: APP_NAME, ApplicationIcon: icon, ApplicationCompany: 'UltimaBass', AppUserModelId: APP_ID }),
    key(`Software\\Classes\\${PROG_ID}\\DefaultIcon`, { '@': icon }),
    key(`Software\\Classes\\${PROG_ID}\\shell\\open\\command`, { '@': open }),
    key(CLIENT_KEY, { '@': APP_NAME }),
    key(`${CLIENT_KEY}\\DefaultIcon`, { '@': icon }),
    key(`${CLIENT_KEY}\\shell\\open\\command`, { '@': exeCommand() }),
    key(`${CLIENT_KEY}\\Capabilities`, { ApplicationName: APP_NAME, ApplicationIcon: icon, ApplicationDescription: 'A vertical-tabs browser with a Control Palette.' }),
    key(`${CLIENT_KEY}\\Capabilities\\FileAssociations`, Object.fromEntries(FILE_TYPES.map((t) => [t, PROG_ID]))),
    key(`${CLIENT_KEY}\\Capabilities\\URLAssociations`, { http: PROG_ID, https: PROG_ID }),
    key(`${CLIENT_KEY}\\Capabilities\\StartMenu`, { StartMenuInternet: 'UltimaBrowser' }),
    key('Software\\RegisteredApplications', { [APP_NAME]: `${CLIENT_KEY}\\Capabilities` }),
  ].join('\r\n');
}

async function registerWindows() {
  const file = path.join(os.tmpdir(), `ultima-register-${process.pid}.reg`);
  fs.writeFileSync(file, Buffer.from(`﻿${registryFile()}`, 'utf16le'));
  try { return (await reg(['import', file])) !== null; } finally { fs.rmSync(file, { force: true }); }
}

// the app Windows opens links with: the newer UserChoiceLatest key first, then UserChoice
async function windowsLinkHandler(scheme) {
  const base = `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}`;
  for (const key of [`${base}\\UserChoiceLatest\\ProgId`, `${base}\\UserChoice`]) {
    const id = (await reg(['query', key, '/v', 'ProgId']))?.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1];
    if (id) return id;
  }
  return null;
}

async function status() {
  if (process.platform === 'win32') {
    const [http, https] = await Promise.all([windowsLinkHandler('http'), windowsLinkHandler('https')]);
    return { isDefault: http === PROG_ID && https === PROG_ID };
  }
  return { isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') };
}

// -> { isDefault, openedSettings }
async function makeDefault() {
  if (process.platform === 'win32') {
    if (!await registerWindows()) return { isDefault: false, openedSettings: false };
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_NAME)}`);
    return { isDefault: (await status()).isDefault, openedSettings: true };
  }
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  return { ...(await status()), openedSettings: false };
}

// The installed app moves when it's reinstalled elsewhere: once registered, keep the registry pointing at this copy.
async function refreshRegistration() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  if (await reg(['query', `HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`, '/ve'])) await registerWindows();
}

// The page to open from a command line: a link (Ultima as the default browser) or an .html file opened with it.
function launchTarget(argv) {
  const at = argv.indexOf('--single-argument');
  const args = at >= 0 ? [argv.slice(at + 1).join(' ')] : argv.slice(1);
  for (const a of args) {
    if (/^https?:\/\//i.test(a)) return a;
    if (FILE_TYPES.includes(path.extname(a).toLowerCase()) && fs.existsSync(a)) return pathToFileURL(path.resolve(a)).href;
  }
  return null;
}

module.exports = { APP_ID, status, makeDefault, refreshRegistration, launchTarget, registryFile };
