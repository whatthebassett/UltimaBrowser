// ultima://shortcuts — view, record, remove and reset every keyboard shortcut.
function pageShortcuts(root, tab) {
  const fmt = (combo) => KEYMAP.display(combo, KEYS.platform);
  const overrides = () => ({ ...(B.settings.keybindings || {}) });
  const commandOf = (id) => KEYMAP.COMMANDS.find((c) => c.id === id);
  // store only what differs from the defaults, so future default changes still reach untouched commands
  const setList = (o, id, list) => {
    const defaults = KEYMAP.defaultsFor(id, KEYS.platform);
    if (list.length === defaults.length && list.every((k, i) => k === defaults[i])) delete o[id];
    else o[id] = list;
  };
  // a combo can only do one thing wherever it applies, so take it away from whoever had it
  const claim = (next, id, combos) => {
    const cmd = commandOf(id);
    const losers = [];
    for (const c of KEYMAP.COMMANDS) {
      if (c.id === id || !KEYMAP.overlaps(c.scope, cmd.scope)) continue;
      const current = Array.isArray(next[c.id]) ? next[c.id] : keysFor(c.id);
      const kept = current.filter((k) => !combos.includes(k));
      if (kept.length !== current.length) { setList(next, c.id, kept); losers.push(c.title); }
    }
    return losers;
  };

  root.innerHTML = `<div class="page"><h1>Keyboard shortcuts</h1>
    <p class="sub">Click <b>+</b> to add a shortcut and × to remove one. Single keys like <kbd>K</kbd> work when you’re not typing.</p>
    <div class="toolbar"><input class="field" id="kq" placeholder="Search by name or keys, e.g. “tab” or “Ctrl+T”" spellcheck="false">
    <button class="btn" id="kreset">Reset all</button></div><div id="klist"></div></div>`;

  let recording = null;

  function draw() {
    const q = $('#kq').value.trim().toLowerCase();
    const custom = B.settings.keybindings || {};
    const groups = new Map();
    for (const c of KEYMAP.COMMANDS) {
      const hay = `${c.title} ${c.group} ${keysFor(c.id).map(fmt).join(' ')}`.toLowerCase();
      if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    }
    $('#klist').innerHTML = [...groups].map(([group, list]) => `<h3>${esc(group)}</h3><div class="list">${list.map((c) => {
      const changed = Array.isArray(custom[c.id]);
      const chips = keysFor(c.id).map((k) => `<span class="key-chip ${c.scope === 'global' && KEYMAP.isTypingKey(k) ? 'single' : ''}"
        title="${c.scope === 'global' && KEYMAP.isTypingKey(k) ? 'Single-key shortcut: works whenever you’re not typing in a text box' : ''}">${kbdHtml(k)}<button data-act="remove" data-combo="${esc(k)}" title="Remove ${esc(fmt(k))}">${icon('close', 12)}</button></span>`).join('');
      return `<div class="row key-row" data-id="${esc(c.id)}">
        <div class="main"><div class="t">${esc(c.title)}</div>${changed ? '<div class="u">Customized</div>' : ''}</div>
        <div class="key-chips">${chips}<button class="key-add" data-act="add" title="Add a shortcut">${icon('plus', 14)}</button></div>
        <button class="btn key-reset" data-act="reset" style="${changed ? '' : 'visibility:hidden'}">Reset</button></div>`;
    }).join('')}</div>`).join('') + extensionRows(q) || '<div class="empty">No shortcut matches</div>';
  }

  // Extensions' shortcuts (chrome.commands): one key each, as in Chrome, kept by main (see extensionCommandList)
  function extensionRows(q) {
    const rows = [];
    for (const ext of EXT.list.filter((e) => e.enabled && e.commands?.length)) {
      for (const c of ext.commands) {
        const title = `${ext.name}: ${c.description}`;
        if (q && !q.split(/\s+/).every((w) => `${title} ${c.shortcut ? fmt(c.shortcut) : ''}`.toLowerCase().includes(w))) continue;
        const chip = c.shortcut ? `<span class="key-chip">${kbdHtml(c.shortcut)}<button data-act="ext-remove" title="Remove ${esc(fmt(c.shortcut))}">${icon('close', 12)}</button></span>` : '';
        rows.push(`<div class="row key-row" data-ext-id="${esc(ext.id)}" data-ext-cmd="${esc(c.name)}">
          <div class="main"><div class="t">${esc(title)}</div></div>
          <div class="key-chips">${chip}<button class="key-add" data-act="ext-add" title="${c.shortcut ? 'Change the shortcut' : 'Add a shortcut'}">${icon('plus', 14)}</button></div>
          <button class="btn key-reset" style="visibility:hidden">Reset</button></div>`);
      }
    }
    return rows.length ? `<h3>Extensions</h3><div class="list">${rows.join('')}</div>` : '';
  }

  const setExtensionKey = async (id, name, combo, message) => {
    try {
      await window.ultima.setExtensionShortcut({ id, name, combo });
      await refreshExtensions();
      if ($('#klist')) draw();
      toast(message);
    } catch (err) {
      if ($('#klist')) draw();
      toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  function recordExtensionKey(row) {
    stopRecording();
    const { extId, extCmd } = row.dataset;
    window.ultima.setKeyRecording(true);
    recording = extCmd;
    const box = h('<button class="key-recorder">Press a shortcut… <span class="key-hint">Esc to cancel</span></button>');
    $('.key-add', row).replaceWith(box);
    box.focus();
    box.addEventListener('keydown', (e) => {
      if (recorderEscape(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const combo = KEYMAP.comboFromEvent(e);
      if (!combo) return; // only modifiers held so far
      recording = null;
      window.ultima.setKeyRecording(false);
      const title = $('.t', row).textContent;
      setExtensionKey(extId, extCmd, combo, `${fmt(combo)} → ${title}`);
    });
    box.addEventListener('blur', () => setTimeout(stopRecording, 0));
  }

  const save = (next, message, undo) => {
    applyKeybindings(next);
    draw();
    if (message) {
      toast(message, undo ? { label: 'Undo', run: () => { applyKeybindings(undo); if ($('#klist')) draw(); } } : undefined);
    }
  };

  // Esc cancels recording and Tab moves on, as everywhere else (bound by mistake, Esc would stop closing every dialog
  // and menu); a shortcut with them in it, like Ctrl+Tab, is recorded as usual
  const recorderEscape = (e) => {
    const bare = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (bare && e.key === 'Escape' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); stopRecording(); return true; }
    return bare && e.key === 'Tab';
  };

  const stopRecording = () => {
    if (!recording) return;
    recording = null;
    window.ultima.setKeyRecording(false);
    draw();
  };

  function startRecording(id, row) {
    stopRecording();
    recording = id;
    window.ultima.setKeyRecording(true); // main stops intercepting, so even Ctrl+T etc. reach the recorder
    const cmd = commandOf(id);
    const box = h('<button class="key-recorder">Press a shortcut… <span class="key-hint">Esc to cancel</span></button>');
    $('.key-add', row).replaceWith(box);
    box.focus();
    box.addEventListener('keydown', (e) => {
      if (recorderEscape(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const combo = KEYMAP.comboFromEvent(e);
      if (!combo) return; // only modifiers held so far
      if (keysFor(id).includes(combo)) { stopRecording(); return; }
      const single = cmd.scope === 'global' && KEYMAP.isTypingKey(combo);
      const before = overrides();
      const next = overrides();
      const losers = claim(next, id, [combo]);
      setList(next, id, [...keysFor(id), combo]);
      recording = null;
      window.ultima.setKeyRecording(false);
      save(next, (losers.length
        ? `${fmt(combo)} now does “${cmd.title}” (removed from “${losers.join('”, “')}”)`
        : `${fmt(combo)} → ${cmd.title}`) + (single ? ' — works whenever you’re not typing in a text box' : ''), before);
    });
    box.addEventListener('blur', () => setTimeout(stopRecording, 0));
  }

  $('#klist').addEventListener('click', (e) => {
    const row = e.target.closest('.key-row');
    const btn = e.target.closest('[data-act]');
    if (!row || !btn) return;
    if (btn.dataset.act === 'ext-add') { recordExtensionKey(row); return; }
    if (btn.dataset.act === 'ext-remove') { setExtensionKey(row.dataset.extId, row.dataset.extCmd, '', `Removed the shortcut from “${$('.t', row).textContent}”`); return; }
    const id = row.dataset.id;
    const title = commandOf(id).title;
    const before = overrides();
    const next = overrides();
    if (btn.dataset.act === 'add') startRecording(id, row);
    else if (btn.dataset.act === 'remove') {
      setList(next, id, keysFor(id).filter((k) => k !== btn.dataset.combo));
      save(next, `Removed ${fmt(btn.dataset.combo)} from “${title}”`, before);
    } else if (btn.dataset.act === 'reset') {
      delete next[id];
      const losers = claim(next, id, KEYMAP.defaultsFor(id, KEYS.platform));
      save(next, `“${title}” reset${losers.length ? ` (taken back from “${losers.join('”, “')}”)` : ''}`, before);
    }
  });
  $('#kq').addEventListener('input', draw);
  $('#kreset').onclick = async () => {
    if (!await confirmDialog('Every shortcut goes back to how Ultima ships, including ones you added or removed.', { title: 'Reset all keyboard shortcuts?', ok: 'Reset all', danger: true })) return;
    save({}, 'All shortcuts reset to defaults', overrides());
  };
  draw();
}
