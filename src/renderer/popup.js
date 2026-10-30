// A site's pop-up window (a sign-in or payment window, see openPopup in main.js): Ultima's bar with the site's address
// over the page, and Ultima's menus and dialogs for it. The page is a view of its own on top of this one, so while a
// menu or dialog is open the page is swapped for a picture of itself, and they draw over that.
const B = { settings: {}, systemDark: true, glass: false, backdrops: false };
const POP = { covers: 0, bar: 40, cover: null }; // cover: the page being swapped for its picture (a promise)

// Ultima's light or dark mode and accent color, and its glass (as the task manager's window does)
function applyWindowTheme() {
  const s = B.settings;
  const root = document.documentElement;
  root.dataset.theme = (s.theme === 'system' ? B.systemDark : s.theme !== 'light') ? 'dark' : 'light';
  root.style.setProperty('--accent', s.accent || '#8b5cf6');
  document.body.classList.toggle('glass', Boolean(B.glass));
  document.body.classList.toggle('acrylic', Boolean(B.backdrops) && s.windowMaterial === 'acrylic');
  const styles = getComputedStyle(root);
  window.ultima.setOverlay({ color: styles.getPropertyValue('--chrome-solid').trim(), symbolColor: styles.getPropertyValue('--text').trim() });
}

// The site the pop-up is on, so you can see whose sign-in page it is
function showPage({ url, title }) {
  let host = '';
  let secure = false;
  try { const u = new URL(url); host = /^https?:$/.test(u.protocol) ? u.host : ''; secure = u.protocol === 'https:'; } catch { /* about:blank */ }
  const ic = $('.pop-ic');
  ic.innerHTML = host ? icon(secure ? 'lock' : 'unlock', 14) : '';
  ic.classList.toggle('warn', Boolean(host) && !secure);
  ic.title = !host ? '' : secure ? 'Connection is secure' : 'Connection isn’t secure: don’t enter passwords or card details';
  $('.pop-host').textContent = host;
  $('.pop-host').title = host ? url : '';
  $('.pop-title').textContent = title && title !== url && title !== host ? title : '';
  document.title = title || host || 'Pop-up';
}

// Runs fn (a menu or dialog) with the page swapped for a picture of itself, then puts the page back
// (another can arrive while the page is still being swapped: each waits until it is)
async function covered(fn) {
  POP.covers += 1;
  try {
    if (!POP.cover) {
      POP.cover = (async () => {
        const shot = $('.pop-shot');
        const picture = await window.ultima.popupShot().catch(() => '');
        if (picture) { shot.src = picture; await shot.decode().catch(() => {}); } else shot.removeAttribute('src');
        document.body.classList.add('covered');
        await window.ultima.popupCover(true);
      })().catch(() => {});
    }
    await POP.cover;
    return await fn();
  } finally {
    if (--POP.covers === 0) {
      POP.cover = null;
      await window.ultima.popupCover(false).catch(() => {});
      document.body.classList.remove('covered');
      $('.pop-shot').removeAttribute('src');
    }
  }
}

// the page was right-clicked (pageContextMenu in main.js); its position is the page's, below the bar
async function onPageMenu({ token, x, y, items }) {
  const id = await covered(() => showMenu(items, { x, y: y + POP.bar }));
  if (id) window.ultima.choosePageMenu({ token, id });
}

async function onAsk({ id, kind, payload }) {
  const answer = await covered(() => askDialog(kind, payload)); // overlays.js
  window.ultima.answerAsk({ id, answer });
}

async function initPopup() {
  // listening first: a page can ask something (an alert, a permission) before the rest is ready, and it waits on it
  window.ultima.on('popup-page', showPage);
  window.ultima.on('page-menu', onPageMenu);
  window.ultima.on('ask', onAsk);
  const state = await window.ultima.getState();
  Object.assign(B, { settings: state.settings, systemDark: state.systemDark, glass: state.glass, backdrops: state.backdrops });
  loadKeys(state.settings.keybindings, state.platform);
  document.body.classList.toggle('mac', state.platform === 'darwin');
  applyWindowTheme();
  showPage(await window.ultima.popupPage());
}

initPopup();
