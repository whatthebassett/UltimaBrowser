// Ultima's own icons for the window's buttons (Windows). The buttons themselves are Windows' own, drawn clear over
// the top right corner (main.js: titleBarOverlay), so they still hover, click and offer the snap layouts; these icons
// sit under them, where they show through. Only drawn once the window reports its state, which it does on Windows.
(() => {
  const ICONS = {
    min: '<path d="M1 5h8"/>',
    max: '<rect x="1" y="1" width="8" height="8" rx="2.2"/>',
    restore: '<rect x="1" y="3" width="6" height="6" rx="1.8"/><path d="M3 1h4.2A1.8 1.8 0 0 1 9 2.8V7"/>',
    close: '<path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>',
  };
  const svg = (name) => `<svg class="wg-ic" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">${ICONS[name]}</svg>`;
  let el = null;
  window.ultima.on('window-state', ({ maximized, focused, fullScreen }) => {
    if (!el) {
      el = document.createElement('div');
      el.id = 'win-glyphs';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<span data-b="min">${svg('min')}</span><span data-b="max"></span><span data-b="close">${svg('close')}</span>`;
      document.body.append(el);
    }
    const max = el.querySelector('[data-b="max"]');
    const want = maximized ? 'restore' : 'max';
    if (max.dataset.icon !== want) { max.dataset.icon = want; max.innerHTML = svg(want); }
    el.classList.toggle('blurred', !focused);
    el.hidden = Boolean(fullScreen);
  });
})();
