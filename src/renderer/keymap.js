// Every keyboard shortcut in Ultima: defaults, user overrides, matching and display.
// Loaded by the main process (require) and by the UI (<script>), so both always agree.
(function keymapModule(root) {
  // scope: 'global' works everywhere (intercepted before pages see the key); other scopes only
  // apply while that part of the UI has focus. "Mod" is Ctrl on Windows/Linux and Cmd on macOS. macKeys replaces keys on
  // macOS where the system owns the combo (Cmd+Tab switches apps, Cmd+H hides the app), following Chrome on the Mac.
  const COMMANDS = [
    // Tabs
    { id: 'new-tab', title: 'New tab', group: 'Tabs', keys: ['Mod+T'] },
    { id: 'new-window', title: 'New window', group: 'Tabs', keys: ['Mod+N'] },
    { id: 'new-private-window', title: 'New private window', group: 'Tabs', keys: ['Mod+Shift+N'] },
    { id: 'new-private-tab', title: 'New private tab in this window', group: 'Tabs', keys: ['Alt+Shift+N'] },
    { id: 'close-tab', title: 'Close tab (unloads pinned tabs and Essentials)', group: 'Tabs', keys: ['Mod+W', 'Mod+F4'] },
    { id: 'reopen-tab', title: 'Reopen closed tab', group: 'Tabs', keys: ['Mod+Shift+T'] },
    { id: 'next-tab', title: 'Next tab', group: 'Tabs', keys: ['Mod+Tab', 'Mod+PageDown'], macKeys: ['Ctrl+Tab'] },
    { id: 'prev-tab', title: 'Previous tab', group: 'Tabs', keys: ['Mod+Shift+Tab', 'Mod+PageUp'], macKeys: ['Ctrl+Shift+Tab'] },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `tab-${n}`, title: `Go to tab ${n}`, group: 'Tabs', keys: [`Mod+${n}`] })),
    { id: 'tab-9', title: 'Go to last tab', group: 'Tabs', keys: ['Mod+9'] },
    { id: 'duplicate-tab', title: 'Duplicate tab', group: 'Tabs', keys: [] },
    { id: 'rename-tab', title: 'Rename tab (leave the name empty to use the page’s title)', group: 'Tabs', keys: [] },
    { id: 'pin-tab', title: 'Pin / unpin tab (this space)', group: 'Tabs', keys: [] },
    { id: 'split-tab', title: 'Split view: this tab beside the last one you used', group: 'Tabs', keys: [] },
    { id: 'unsplit-tab', title: 'Take this tab out of split view', group: 'Tabs', keys: [] },
    { id: 'split-move-left', title: 'Split view: move this pane left', group: 'Tabs', keys: [] },
    { id: 'split-move-right', title: 'Split view: move this pane right', group: 'Tabs', keys: [] },
    { id: 'split-focus-next', title: 'Split view: next pane', group: 'Tabs', keys: [] },
    { id: 'split-focus-prev', title: 'Split view: previous pane', group: 'Tabs', keys: [] },
    { id: 'tab-folder-new', title: 'Add tab to a new folder', group: 'Tabs', keys: [] },
    { id: 'tab-folder-remove', title: 'Remove tab from its folder', group: 'Tabs', keys: [] },
    { id: 'essential-tab', title: 'Add to / remove from Essentials', group: 'Tabs', keys: [] },
    { id: 'unload-tab', title: 'Unload tab (free its memory, keep it in the sidebar)', group: 'Tabs', keys: [] },
    { id: 'reset-tab', title: 'Pinned tab or Essential: back to its pinned link', group: 'Tabs', keys: [] },
    { id: 'edit-pinned-link', title: 'Pinned tab or Essential: edit its pinned link', group: 'Tabs', keys: [] },
    { id: 'replace-pinned-link', title: 'Pinned tab or Essential: replace its pinned link with the current page', group: 'Tabs', keys: [] },
    { id: 'mute-tab', title: 'Mute / unmute tab', group: 'Tabs', keys: [] },
    { id: 'close-others', title: 'Close other tabs', group: 'Tabs', keys: [] },
    // Spaces
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `space-${n}`, title: `Go to space ${n}`, group: 'Spaces', keys: [`Mod+Alt+${n}`] })),
    { id: 'next-space', title: 'Next space', group: 'Spaces', keys: ['Mod+Alt+Right'] },
    { id: 'prev-space', title: 'Previous space', group: 'Spaces', keys: ['Mod+Alt+Left'] },
    { id: 'new-space', title: 'New space', group: 'Spaces', keys: [] },
    { id: 'rename-space', title: 'Rename space', group: 'Spaces', keys: [] },
    { id: 'space-options', title: 'Space icon, color and options', group: 'Spaces', keys: [] },
    { id: 'space-theme', title: 'Edit space theme (colors and gradient)', group: 'Spaces', keys: [] },
    { id: 'toggle-space-separate', title: 'Toggle separate sign-ins for space', group: 'Spaces', keys: [] },
    { id: 'delete-space', title: 'Delete space', group: 'Spaces', keys: [] },
    // Navigation
    { id: 'palette', title: 'Control Palette', group: 'Navigation', keys: ['Mod+K', 'Mod+Shift+P'] },
    { id: 'edit-url', title: 'Edit address', group: 'Navigation', keys: ['Mod+L', 'Alt+D', 'F6'] },
    { id: 'url-menu', title: 'Address bar menu (history, downloads, extensions)', group: 'Navigation', keys: ['Alt+E'] },
    { id: 'back', title: 'Back', group: 'Navigation', keys: ['Alt+Left', 'BrowserBack'] },
    { id: 'forward', title: 'Forward', group: 'Navigation', keys: ['Alt+Right', 'BrowserForward'] },
    { id: 'reload', title: 'Reload', group: 'Navigation', keys: ['Mod+R', 'F5'] },
    { id: 'hard-reload', title: 'Hard reload (ignore cache)', group: 'Navigation', keys: ['Mod+Shift+R', 'Mod+F5'] },
    { id: 'home', title: 'Go to new tab page', group: 'Navigation', keys: ['Alt+Home'] },
    // Page
    { id: 'bookmark', title: 'Add this page to Waypoints', group: 'Page', keys: ['Mod+D'] },
    { id: 'copy-url', title: 'Copy page URL', group: 'Page', keys: ['Mod+Shift+C'] },
    { id: 'find', title: 'Find in page', group: 'Page', keys: ['Mod+F'] },
    { id: 'caret-browsing', title: 'Caret browsing on/off (a text cursor in pages)', group: 'Page', keys: ['F7'] },
    { id: 'fill-login', title: 'Fill saved login', group: 'Page', keys: [] },
    { id: 'zoom-in', title: 'Zoom in', group: 'Page', keys: ['Mod+=', 'Mod+Shift+=', 'Mod+NumAdd'] },
    { id: 'zoom-out', title: 'Zoom out', group: 'Page', keys: ['Mod+-', 'Mod+NumSub'] },
    { id: 'zoom-reset', title: 'Reset zoom', group: 'Page', keys: ['Mod+0', 'Mod+Num0'] },
    { id: 'print', title: 'Print', group: 'Page', keys: ['Mod+P'] },
    { id: 'devtools', title: 'Developer tools', group: 'Page', keys: ['F12', 'Mod+Shift+I'] },
    // Ultima
    { id: 'toggle-sidebar', title: 'Toggle compact sidebar', group: 'Ultima', keys: ['Mod+Shift+B'] },
    { id: 'toggle-sidebar-hidden', title: 'Hide / show the sidebar (it slides in from the left edge while hidden)', group: 'Ultima', keys: ['Mod+Shift+S'] },
    { id: 'customize-sidebar', title: 'Customize sidebar buttons', group: 'Ultima', keys: [] },
    { id: 'toggle-bookmarks-bar', title: 'Show / hide the Waypoints bar', group: 'Ultima', keys: [] },
    { id: 'import-bookmarks-bar', title: 'Import a bookmarks bar from Chrome, Edge, Brave or Vivaldi', group: 'Ultima', keys: [] },
    { id: 'toggle-loading-animation', title: 'Turn the address bar loading animation on or off', group: 'Ultima', keys: [] },
    { id: 'open-history', title: 'Open history', group: 'Ultima', keys: ['Mod+H'], macKeys: ['Mod+Y'] },
    { id: 'tab-history', title: 'Tab History (every open tab’s pages)', group: 'Ultima', keys: ['Mod+Shift+H'] },
    { id: 'open-bookmarks', title: 'Open Waypoints', group: 'Ultima', keys: ['Mod+Shift+O'] },
    { id: 'open-downloads', title: 'Open downloads', group: 'Ultima', keys: ['Mod+J'] },
    { id: 'task-manager', title: 'Task manager (what each tab and process uses)', group: 'Ultima', keys: ['Shift+Esc'] },
    { id: 'open-extensions', title: 'Open extensions', group: 'Ultima', keys: [] },
    { id: 'open-settings', title: 'Open settings', group: 'Ultima', keys: ['Mod+,'] },
    { id: 'open-shortcuts', title: 'Keyboard shortcuts', group: 'Ultima', keys: ['Mod+/'] },
    { id: 'welcome', title: 'Replay the welcome (set up colors, your space and Essentials)', group: 'Ultima', keys: [] },
    { id: 'open-passwords', title: 'Open passwords', group: 'Ultima', keys: [] },
    { id: 'open-import', title: 'Import browser data', group: 'Ultima', keys: [] },
    { id: 'make-default-browser', title: 'Make Ultima the default browser', group: 'Ultima', keys: [] },
    { id: 'clear-data', title: 'Clear browsing data', group: 'Ultima', keys: ['Mod+Shift+Delete'] },
    { id: 'theme-dark', title: 'Theme: Dark', group: 'Ultima', keys: [] },
    { id: 'theme-light', title: 'Theme: Light', group: 'Ultima', keys: [] },
    { id: 'theme-system', title: 'Theme: Match system', group: 'Ultima', keys: [] },
    // (on macOS the app menu's Cmd+Q quits)
    { id: 'quit', title: 'Quit Ultima (all its windows come back next time)', group: 'Ultima', keys: ['Mod+Shift+Q'], macKeys: [] },
    // Scoped keys
    { id: 'palette.next', title: 'Next result', group: 'Inside the Control Palette', scope: 'palette', keys: ['Down', 'Tab'] },
    { id: 'palette.prev', title: 'Previous result', group: 'Inside the Control Palette', scope: 'palette', keys: ['Up', 'Shift+Tab'] },
    { id: 'palette.open', title: 'Open result', group: 'Inside the Control Palette', scope: 'palette', keys: ['Enter'] },
    { id: 'palette.open-background', title: 'Open result in background tab', group: 'Inside the Control Palette', scope: 'palette', keys: ['Shift+Enter', 'Mod+Enter'] },
    { id: 'palette.close', title: 'Close palette', group: 'Inside the Control Palette', scope: 'palette', keys: ['Esc'] },
    { id: 'find.next', title: 'Next match', group: 'Inside the find bar', scope: 'find', keys: ['Enter'] },
    { id: 'find.prev', title: 'Previous match', group: 'Inside the find bar', scope: 'find', keys: ['Shift+Enter'] },
    { id: 'find.close', title: 'Close find bar', group: 'Inside the find bar', scope: 'find', keys: ['Esc'] },
    { id: 'field.submit', title: 'Confirm (space name, new-tab search box)', group: 'Inside text boxes', scope: 'field', keys: ['Enter'] },
    { id: 'field.cancel', title: 'Cancel editing (space name)', group: 'Inside text boxes', scope: 'field', keys: ['Esc'] },
    { id: 'ui.close', title: 'Close palette or find bar when focus is elsewhere in Ultima', group: 'Inside text boxes', scope: 'ui', keys: ['Esc'] },
    { id: 'menu.next', title: 'Next item', group: 'Inside menus', scope: 'menu', keys: ['Down'] },
    { id: 'menu.prev', title: 'Previous item', group: 'Inside menus', scope: 'menu', keys: ['Up'] },
    { id: 'menu.choose', title: 'Choose item', group: 'Inside menus', scope: 'menu', keys: ['Enter', 'Space'] },
    { id: 'menu.open-submenu', title: 'Open submenu', group: 'Inside menus', scope: 'menu', keys: ['Right'] },
    { id: 'menu.close-submenu', title: 'Close submenu', group: 'Inside menus', scope: 'menu', keys: ['Left'] },
    { id: 'menu.close', title: 'Close menu', group: 'Inside menus', scope: 'menu', keys: ['Esc'] },
    { id: 'theme.close', title: 'Close the theme editor', group: 'Inside the theme editor', scope: 'theme', keys: ['Esc'] },
    { id: 'theme.remove-color', title: 'Remove the selected color', group: 'Inside the theme editor', scope: 'theme', keys: ['Delete', 'Backspace'] },
    { id: 'drag.cancel', title: 'Cancel dragging a tab (it goes back)', group: 'While dragging a tab', scope: 'drag', keys: ['Esc'] },
    { id: 'popover.close', title: 'Close the address bar menu', group: 'Inside menus', scope: 'popover', keys: ['Esc'] },
    { id: 'dialog.confirm', title: 'Confirm (the highlighted button)', group: 'Inside dialogs', scope: 'dialog', keys: ['Enter'] },
    { id: 'dialog.cancel', title: 'Cancel', group: 'Inside dialogs', scope: 'dialog', keys: ['Esc'] },
  ].map((c) => ({ scope: 'global', ...c }));

  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS', 'Fn', 'Hyper', 'Super']);
  const CODE_NAMES = {
    Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Backquote: '`', Space: 'Space', NumpadAdd: 'NumAdd', NumpadSubtract: 'NumSub',
    NumpadMultiply: 'NumMult', NumpadDivide: 'NumDiv', NumpadDecimal: 'NumDec', NumpadEnter: 'Enter', IntlBackslash: 'IntlBackslash',
  };
  const KEY_NAMES = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', ' ': 'Space', Del: 'Delete' };

  // Physical key → stable name. Letters follow the keyboard layout; punctuation and digits use the key position,
  // so Shift doesn't change them (Ctrl+Shift+= stays "=" rather than "+").
  function keyName(e) {
    const key = e.key || '';
    const code = e.code || '';
    if (MODIFIER_KEYS.has(key)) return null;
    if (/^Key[A-Z]$/.test(code)) return (/^[a-z]$/i.test(key) ? key : code.slice(3)).toUpperCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
    if (CODE_NAMES[code]) return CODE_NAMES[code];
    if (KEY_NAMES[key]) return KEY_NAMES[key];
    if (key.length === 1) return key.toUpperCase();
    return key || null; // Tab, Enter, Delete, Home, F1…F24, BrowserBack, MediaPlayPause, …
  }

  const pick = (e, a, b) => (e[a] !== undefined ? e[a] : e[b]);

  // Works for both Electron's before-input-event `input` and DOM KeyboardEvents.
  function comboFromEvent(e) {
    const ctrl = Boolean(pick(e, 'ctrlKey', 'control'));
    const alt = Boolean(pick(e, 'altKey', 'alt'));
    const shift = Boolean(pick(e, 'shiftKey', 'shift'));
    const meta = Boolean(pick(e, 'metaKey', 'meta'));
    const key = keyName(e);
    if (!key) return null;
    // AltGr is reported as Ctrl+Alt on Windows; a typed symbol (é, @, {…) is text, not a shortcut.
    if (ctrl && alt && e.key && e.key.length === 1 && !/^[a-z0-9]$/i.test(e.key)) return null;
    return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', meta && 'Meta', key].filter(Boolean).join('+');
  }

  // "Mod" → Ctrl or Meta, and modifiers in canonical order.
  function normalize(combo, platform) {
    const parts = combo.split('+');
    const key = parts.pop() || '+';
    const mods = new Set(parts.map((p) => (p === 'Mod' ? (platform === 'darwin' ? 'Meta' : 'Ctrl') : p)));
    return [...['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => mods.has(m)), key].join('+');
  }

  const defaultKeys = (c, platform) => (platform === 'darwin' && c.macKeys ? c.macKeys : c.keys);

  // Defaults with the user's overrides applied: { commandId: [combo, …] }.
  function resolve(overrides, platform) {
    const out = {};
    for (const c of COMMANDS) {
      const list = overrides && Array.isArray(overrides[c.id]) ? overrides[c.id] : defaultKeys(c, platform);
      out[c.id] = list.map((k) => normalize(k, platform));
    }
    return out;
  }

  function defaultsFor(id, platform) {
    const c = COMMANDS.find((x) => x.id === id);
    return c ? defaultKeys(c, platform).map((k) => normalize(k, platform)) : [];
  }

  const overlaps = (a, b) => a === 'global' || b === 'global' || a === b;

  // Keys that also type or move the caret (K, Shift+K, Space, arrows…). As global shortcuts they only fire
  // while you are not typing in a text box, so they never steal what you type.
  function isTypingKey(combo) {
    const parts = combo.split('+');
    const key = parts[parts.length - 1];
    const hasMod = parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Meta');
    const printable = key.length === 1 || /^(Space|Enter|Tab|Backspace|Num\d|NumAdd|NumSub|NumMult|NumDiv|NumDec|Up|Down|Left|Right|Home|End|PageUp|PageDown|Delete)$/.test(key);
    return !hasMod && printable;
  }

  const SYMBOLS = { Left: '←', Right: '→', Up: '↑', Down: '↓' };
  function displayParts(combo, platform) {
    return combo.split('+').map((p) => {
      if (p === 'Meta') return platform === 'darwin' ? '⌘' : 'Win';
      return SYMBOLS[p] || p;
    });
  }
  const display = (combo, platform) => displayParts(combo, platform).join('+');


  const api = { COMMANDS, comboFromEvent, normalize, resolve, defaultsFor, overlaps, isTypingKey, display, displayParts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KEYMAP = api;
}(this));
