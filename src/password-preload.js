// Ultima's passwords in web pages. Finds login, sign-up and change-password fields and tells main.js when one is
// focused, so Ultima can show its menu of saved logins there (pwfill.js draws it); fills the login you pick; and notices
// when you sign in, so Ultima can offer to save or update the password. A session preload (see setupSession in
// main.js), in the preload's own world, so pages can't see or change it. Saved passwords reach it only to be filled in.
const { ipcRenderer, webFrame } = require('electron');

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel']);
const USERNAME_HINT = /user|e-?mail|login|account|identifier|phone|member|benutzer|courriel|usuario/i;
const NEW_HINT = /new|confirm|repeat|retype|again|verify|password2|passwd2|pwd2/i;
const CURRENT_HINT = /old|current|existing/i;
const SUBMIT_HINT = /log ?in|sign ?in|sign ?on|sign ?up|register|continue|next|submit|create|join|save|update|change|weiter|anmelden|connexion|entrar|iniciar/i;

const attrs = (el) => `${el.name} ${el.id} ${el.getAttribute('autocomplete') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`;
const autocomplete = (el) => (el.getAttribute('autocomplete') || '').toLowerCase();

function shown(el) {
  if (!el?.isConnected || el.disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

// the form a field is in, or the page (or shadow root) for login fields without a <form>
const scopeOf = (el) => el.form || el.getRootNode();
const passwordsIn = (scope, all = false) => [...scope.querySelectorAll('input[type=password]')].filter((p) => all || shown(p));
const textsIn = (scope) => [...scope.querySelectorAll('input')].filter((i) => TEXT_TYPES.has((i.getAttribute('type') || '').toLowerCase()) && shown(i));
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// current (signing in, or the old password when changing it) or new (signing up, the new one and its confirmation)
function passwordKind(el, passes) {
  const ac = autocomplete(el);
  if (ac.includes('new-password')) return 'new';
  if (ac.includes('current-password')) return 'current';
  if (CURRENT_HINT.test(attrs(el))) return 'current';
  if (NEW_HINT.test(attrs(el))) return 'new';
  if (passes.length === 1) return /sign ?up|register|create|join/i.test(`${el.form?.id} ${el.form?.className} ${el.form?.action}`) ? 'new' : 'current';
  // two: a new password and its confirmation; three: the old one, then the new one twice
  return passes.length >= 3 && passes.indexOf(el) === 0 ? 'current' : 'new';
}

// The username for a password field: the text field just before it (the closest one that looks like a username if
// several do), or, on a form with no password (the first step of a two-step sign-in), the one that looks like it.
function usernameFor(scope, pass) {
  const texts = textsIn(scope).filter((t) => !pass || before(t, pass));
  const named = texts.filter((t) => /username|email/.test(autocomplete(t)) || USERNAME_HINT.test(attrs(t)) || t.type === 'email');
  return named[named.length - 1] || (pass ? texts[texts.length - 1] : null) || null;
}

// What a focused field is to Ultima: username, password or new-password (null: not a login field)
function fieldKind(el) {
  if (!(el instanceof HTMLInputElement) || !shown(el) || el.readOnly) return null;
  const scope = scopeOf(el);
  const passes = passwordsIn(scope);
  if (el.type === 'password') return passwordKind(el, passes) === 'new' ? 'new-password' : 'password';
  if (!TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase())) return null;
  if (passes.length) return usernameFor(scope, passes[0]) === el && passwordKind(passes[0], passes) === 'current' ? 'username' : null;
  return /username|email/.test(autocomplete(el)) || (el.form && USERNAME_HINT.test(attrs(el))) ? 'username' : null;
}

// Sets a field as if typed, so the page's own scripts (React and the like) notice.
function setValue(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------- where a field is, in the page's window (its <webview>) ----------
// A field in a frame asks the frame it's in for where that frame sits, up to the top.
const offsetWaiters = new Map();
function frameOffset() {
  if (window === window.top) return Promise.resolve({ x: 0, y: 0 });
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    offsetWaiters.set(id, resolve);
    window.parent.postMessage({ ultimaFrameOffset: 'ask', id }, '*');
    setTimeout(() => { if (offsetWaiters.delete(id)) resolve(null); }, 400);
  });
}
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object' || typeof d.id !== 'string') return;
  if (d.ultimaFrameOffset === 'ask') {
    const frame = [...document.querySelectorAll('iframe, frame')].find((f) => f.contentWindow === e.source);
    const own = frame && await frameOffset();
    if (!own) return;
    const r = frame.getBoundingClientRect();
    const s = getComputedStyle(frame);
    e.source.postMessage({
      ultimaFrameOffset: 'answer', id: d.id,
      x: own.x + r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft),
      y: own.y + r.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop),
    }, '*');
  } else if (d.ultimaFrameOffset === 'answer' && e.source === window.parent && offsetWaiters.has(d.id)) {
    offsetWaiters.get(d.id)({ x: Number(d.x) || 0, y: Number(d.y) || 0 });
    offsetWaiters.delete(d.id);
  }
});

async function rectOf(el) {
  const off = await frameOffset();
  if (!off || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const z = webFrame.getZoomFactor();
  return { x: (off.x + r.left) * z, y: (off.y + r.top) * z, width: r.width * z, height: r.height * z };
}

// ---------- the menu at a login field ----------
let current = null; // { el, kind }: the login field the menu is for
let menu = { open: false, selected: false }; // as Ultima draws it (main.js tells this page)
let quietUntil = 0; // just filled: focus coming back to the field doesn't open the menu again

async function report(el, kind) {
  current = { el, kind };
  const rect = await rectOf(el);
  if (rect && current?.el === el) ipcRenderer.send('ultima:pw-field', { kind, rect, typed: kind === 'username' ? el.value.slice(0, 200) : '' });
}

function onFocus(el) {
  const kind = fieldKind(el);
  if (!kind) { if (current) { current = null; ipcRenderer.send('ultima:pw-blur'); } return; }
  if (Date.now() < quietUntil) { current = { el, kind }; return; }
  report(el, kind);
}

if (/^https?:$/.test(location.protocol)) {
  document.addEventListener('focusin', (e) => onFocus(e.composedPath()[0]), true);
  document.addEventListener('focusout', (e) => {
    if (current && e.composedPath()[0] === current.el) ipcRenderer.send('ultima:pw-blur');
  }, true);
  // clicking a field that already has the focus opens the menu again (after it was closed)
  document.addEventListener('mousedown', (e) => {
    const el = e.composedPath()[0];
    if (e.button === 0 && el === deepActive() && !menu.open) { quietUntil = 0; onFocus(el); }
  }, true);
  document.addEventListener('input', (e) => {
    if (!current || e.composedPath()[0] !== current.el || !e.isTrusted) return;
    // a username narrows the menu to the logins it starts; typing a password closes it
    if (current.kind === 'username') ipcRenderer.send('ultima:pw-typed', current.el.value.slice(0, 200));
    else if (menu.open) ipcRenderer.send('ultima:pw-blur');
  }, true);
  // the menu follows its field as the page scrolls
  let moving = false;
  window.addEventListener('scroll', () => {
    if (!current || !menu.open || moving) return;
    moving = true;
    requestAnimationFrame(async () => {
      moving = false;
      const rect = current && await rectOf(current.el);
      if (rect) ipcRenderer.send('ultima:pw-move', rect);
    });
  }, { capture: true, passive: true });
  window.addEventListener('pagehide', () => { if (current) ipcRenderer.send('ultima:pw-blur'); });

  // The menu's keys, while it's open: arrows move through it, Enter fills the login picked, Esc closes it.
  document.addEventListener('keydown', (e) => {
    if (!current || e.composedPath()[0] !== current.el || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key;
    if (!menu.open) {
      if (key === 'ArrowDown') { e.preventDefault(); report(current.el, current.kind); }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Escape' || (key === 'Enter' && menu.selected)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      ipcRenderer.send('ultima:pw-key', key);
    } else if (key === 'Tab') ipcRenderer.send('ultima:pw-blur');
  }, true);
}

function deepActive() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

ipcRenderer.on('ultima:pw-menu', (_e, state) => { menu = { open: Boolean(state?.open), selected: Boolean(state?.selected) }; });

// The best place to fill when no field was picked (the key button, the Control Palette): the focused login field, else
// the first form with a password field, else the first username-only form.
function fillScope() {
  if (current?.el.isConnected && shown(current.el)) return { scope: scopeOf(current.el), field: current.el };
  const pass = passwordsIn(document).find((p) => !p.readOnly);
  if (pass) return { scope: scopeOf(pass), field: pass };
  const user = textsIn(document).find((t) => fieldKind(t) === 'username');
  return user ? { scope: scopeOf(user), field: user } : null;
}

// Fills a saved login ({ username, password }) or a new password from the generator ({ generated }).
function fill({ username, password, generated }) {
  const at = fillScope();
  if (!at) return false;
  const passes = passwordsIn(at.scope).filter((p) => !p.readOnly);
  quietUntil = Date.now() + 1200;
  if (generated) {
    // the new password and its confirmation (never the old one, on a change-password form)
    const targets = passes.filter((p) => passwordKind(p, passes) === 'new');
    if (!targets.length && at.field.type === 'password') targets.push(at.field);
    for (const p of targets) setValue(p, generated);
    return targets.length > 0;
  }
  const pass = passes.find((p) => passwordKind(p, passes) === 'current') || null;
  const user = at.field.type !== 'password' && fieldKind(at.field) === 'username' ? at.field : usernameFor(at.scope, pass);
  if (user && username && !user.readOnly) setValue(user, username);
  if (pass && password) setValue(pass, password);
  return Boolean(pass || (user && username));
}

ipcRenderer.on('ultima:pw-fill', (_e, { token, login }) => {
  let ok = false;
  try { ok = fill(login || {}); } catch { /* the page changed under us */ }
  ipcRenderer.send('ultima:pw-filled', { token, ok });
});

// ---------- noticing a sign-in ----------
// When a form with a password is sent (submitted, its button clicked or Enter pressed), main.js hears the username and
// password, and offers to save or update them once the page moves on (or the form goes away, on pages that sign in
// without leaving).
let lastSent = '';
function capture(scope) {
  const passes = passwordsIn(scope, true).filter((p) => p.value);
  if (!passes.length) {
    // the first step of a two-step sign-in: the username, for when the password comes
    const user = usernameFor(scope, null);
    if (user?.value.trim() && fieldKind(user) === 'username') ipcRenderer.send('ultima:pw-username', user.value.trim().slice(0, 500));
    return;
  }
  const kinds = passes.map((p) => passwordKind(p, passes));
  const old = passes.find((p, i) => kinds[i] === 'current')?.value;
  const fresh = passes.filter((p, i) => kinds[i] === 'new').map((p) => p.value);
  if (fresh.some((v) => v !== fresh[0])) return; // the new password and its confirmation differ: the page will say so
  const user = usernameFor(scope, passes[0]);
  const sent = {
    username: (user?.value || '').trim().slice(0, 500),
    password: (fresh[0] || old).slice(0, 1000),
    current: fresh[0] && old ? old.slice(0, 1000) : '',
  };
  const key = JSON.stringify(sent);
  if (key === lastSent) return;
  lastSent = key;
  setTimeout(() => { if (lastSent === key) lastSent = ''; }, 1500);
  ipcRenderer.send('ultima:pw-submit', sent);
  // a page that signs in without leaving: the form goes away (or hides) once it worked
  const field = passes[0];
  const started = Date.now();
  const watch = setInterval(() => {
    if (!field.isConnected || !shown(field)) { clearInterval(watch); ipcRenderer.send('ultima:pw-gone'); }
    if (Date.now() - started > 15000) clearInterval(watch);
  }, 300);
}

const sendable = (el) => el?.closest?.('button, input[type=submit], input[type=image], input[type=button], [role=button], a');

if (/^https?:$/.test(location.protocol)) {
  document.addEventListener('submit', (e) => { if (e.target instanceof HTMLFormElement) capture(e.target); }, true);
  document.addEventListener('click', (e) => {
    const b = sendable(e.composedPath()[0]);
    if (!b) return;
    const label = `${b.textContent} ${b.value || ''} ${b.getAttribute('aria-label') || ''} ${b.id} ${b.className}`;
    const form = b.form || b.closest('form');
    // in a form, any button that sends it; outside one, a button that says what it does (Sign in, Next…)
    if (form ? (b.type === 'submit' || b.type === 'image' || SUBMIT_HINT.test(label)) : SUBMIT_HINT.test(label)) capture(form || b.getRootNode());
  }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.composedPath()[0];
    if (e.key === 'Enter' && el instanceof HTMLInputElement && !e.isComposing) capture(scopeOf(el));
  }, true);
}
