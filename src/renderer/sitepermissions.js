// Site settings: what a site may do, per site, with a default for every site. Loaded by the main process (require),
// which enforces them, and by the UI (<script>), which shows them, so both always agree.
// Stored in settings.permissions[origin][key] (true = allow, false = block; missing = the default) and
// settings.siteDefaults[key] (missing = the default below).
//   ask:   the site asks first (Ultima's prompt); the default can be Ask or Block
//   allow: allowed unless blocked; the default can be Allow or Block
(function sitePermissionsModule(root) {
  const SITE_PERMISSIONS = [
    { key: 'geolocation', label: 'Location', icon: 'map-pin', kind: 'ask', what: 'know your location' },
    { key: 'camera', label: 'Camera', icon: 'camera', kind: 'ask', what: 'use your camera' },
    { key: 'microphone', label: 'Microphone', icon: 'mic', kind: 'ask', what: 'use your microphone' },
    { key: 'notifications', label: 'Notifications', icon: 'bell', kind: 'ask', what: 'show notifications' },
    { key: 'clipboard-read', label: 'Clipboard', icon: 'clipboard', kind: 'ask', what: 'read your clipboard' },
    { key: 'display-capture', label: 'Screen sharing', icon: 'monitor', kind: 'ask', what: 'see your screen' },
    { key: 'fileSystem', label: 'File editing', icon: 'file', kind: 'ask', what: 'edit files on your device' },
    { key: 'openExternal', label: 'Opening other apps', icon: 'external', kind: 'ask', what: 'open an external application' },
    { key: 'midiSysex', label: 'MIDI devices', icon: 'music', kind: 'ask', what: 'control MIDI devices' },
    { key: 'window-management', label: 'Window management', icon: 'app-window', kind: 'ask', what: 'manage windows on your displays' },
    { key: 'idle-detection', label: 'Idle detection', icon: 'clock', kind: 'ask', what: 'know when you are idle' },
    { key: 'popups', label: 'Pop-ups', icon: 'layers', kind: 'allow', note: 'Windows a site opens, like sign-in and payment windows. Links you open in new tabs aren’t affected.' },
    { key: 'sound', label: 'Sound', icon: 'volume', kind: 'allow' },
    { key: 'images', label: 'Images', icon: 'image', kind: 'allow', reload: true },
    { key: 'javascript', label: 'JavaScript', icon: 'braces', kind: 'allow', reload: true, note: 'Most sites need it to work.' },
  ];
  const BY_KEY = Object.fromEntries(SITE_PERMISSIONS.map((p) => [p.key, p]));

  // The default for a key: settings.siteDefaults wins, else Ask (ask) or Allow (allow).
  // Returns true (allow), false (block) or undefined (ask).
  function defaultFor(key, siteDefaults) {
    const d = siteDefaults && siteDefaults[key];
    if (typeof d === 'boolean') return BY_KEY[key] && BY_KEY[key].kind === 'ask' && d === true ? undefined : d;
    return BY_KEY[key] && BY_KEY[key].kind === 'allow' ? true : undefined;
  }

  // A site's own choice for a key (camera and microphone fall back to the single camera-and-microphone choice older
  // versions stored as "media"); undefined when it has none.
  function storedFor(record, key) {
    if (!record) return undefined;
    let v = record[key];
    if (v === undefined && (key === 'camera' || key === 'microphone')) v = record.media;
    return typeof v === 'boolean' ? v : undefined;
  }

  // What applies to a site: its own choice, else the default.
  function effective(record, key, siteDefaults) {
    const own = storedFor(record, key);
    return own === undefined ? defaultFor(key, siteDefaults) : own;
  }

  const api = { SITE_PERMISSIONS, BY_KEY, defaultFor, storedFor, effective };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SITE_PERMS = api;
}(typeof window !== 'undefined' ? window : globalThis));
