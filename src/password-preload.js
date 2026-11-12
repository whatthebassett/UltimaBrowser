// Ultima's passwords in web pages. Finds login, sign-up and change-password fields and tells main.js when one is
// focused, so Ultima can show its menu of saved logins there (pwfill.js draws it); fills the login you pick; and notices
// when you sign in, so Ultima can offer to save or update the password. A session preload (see setupSession in
// main.js) that runs in every frame, in the preload's own world, so pages can't see or change it. Saved passwords reach
// it only to be filled in, and only into the frame main.js checked against the login's site.
//
// Pages build sign-in forms every way there is, so fields are found by what they are rather than how they're coded:
// through open shadow roots (web components), without a <form>, with odd or missing names, an email or phone field as
// the username, fields added or shown later (single-page apps, modals), and the two steps of a two-step sign-in.
const { ipcRenderer, webFrame } = require('electron');

// the page's origin: its own, or its parent's for an about:blank or srcdoc frame a page writes its sign-in form into
const ORIGIN = (() => {
  if (/^https?:$/.test(location.protocol)) return location.origin;
  try { return /^https?:\/\//.test(self.origin) ? self.origin : null; } catch { return null; }
})();

const USERNAME_HINT = /user|e-?mail|log ?in|logon|account|identifier|phone|mobile|member|customer|client.?id|nick|handle|benutzer|courriel|usuario|utilisateur|identifiant|correo/i;
const PASSWORD_NAME = /pass(word|wd|wort)|^pass$|^pw$|pwd|kennwort|contrase|mot.?de.?passe|senha/i;
const NEW_HINT = /new|confirm|repeat|retype|again|verify|password2|passwd2|pwd2/i;
const CURRENT_HINT = /old|current|existing/i;
const SIGNUP_HINT = /sign.?up|register|registration|create|join|enrol|new.?account/i;
// text fields that are never a username: search boxes, newsletters, codes and the like
const NOT_LOGIN = /search|query|newsletter|subscri|coupon|promo|voucher|gift|comment|message|captcha|one-time|otp|2fa|totp|security.?code|zip|postal/i;
const SUBMIT_HINT = /log ?in|sign ?in|sign ?on|sign ?up|register|continue|next|submit|create|join|save|update|change|weiter|anmelden|connexion|entrar|iniciar/i;

const autocomplete = (el) => (el.getAttribute('autocomplete') || '').toLowerCase();
const isInput = (el) => el?.localName === 'input' && el.namespaceURI === 'http://www.w3.org/1999/xhtml';
const editable = (el) => !el.disabled && !el.readOnly;

// what a field says about itself: its name, id, autocomplete, placeholder, aria label and <label>
function attrs(el) {
  let label = '';
  try { label = [...(el.labels || [])].map((l) => l.textContent).join(' '); } catch { /* none */ }
  const by = el.getAttribute('aria-labelledby');
  if (by) label += ` ${by.split(/\s+/).map((id) => el.getRootNode().getElementById?.(id)?.textContent || '').join(' ')}`;
  return `${el.name} ${el.id} ${autocomplete(el)} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${label.trim().slice(0, 80)}`;
}

// On screen, or could be: not hidden by itself or a parent, not see-through, not shoved off the page (a trick to have
// hidden fields filled).
function shown(el) {
  if (!el?.isConnected || el.disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const view = el.ownerDocument.defaultView || window;
  if (r.right + view.scrollX < 0 || r.bottom + view.scrollY < 0) return false;
  try {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  } catch {
    const s = view.getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
  }
  return true;
}

// ---------- the page, through shadow roots ----------
// up one level, out of a shadow root to its host (by node type: a frame's nodes are of another realm)
const up = (n) => (n.parentNode?.nodeType === 11 && n.parentNode.host) || n.parentNode;
const isDoc = (n) => n?.nodeType === 9;
const styleOf = (el) => (el.ownerDocument.defaultView || window).getComputedStyle(el);
function within(box, el) {
  for (let n = el; n; n = up(n)) if (n === box) return true;
  return false;
}
// every element of these kinds, in page order, including those in open shadow roots
function deepAll(names, root, out = []) {
  for (const el of root.querySelectorAll('*')) {
    if (names.has(el.localName)) out.push(el);
    if (el.shadowRoot) deepAll(names, el.shadowRoot, out);
  }
  return out;
}
function deepActive(doc = document) {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

// A page's fields, looked at once per task (a focus or a click looks at the same fields many times over).
const snaps = new Map(); // document → its fields
function snapshot(doc = document) {
  let snap = snaps.get(doc);
  if (!snap) {
    const all = deepAll(new Set(['input']), doc).filter((i) => i.type !== 'hidden');
    const seen = new Map();
    snap = {
      all,
      order: new Map(all.map((el, i) => [el, i])),
      shown: (el) => { if (!seen.has(el)) seen.set(el, shown(el)); return seen.get(el); },
    };
    snaps.set(doc, snap);
    queueMicrotask(() => snaps.delete(doc));
  }
  return snap;
}

// ---------- what a field is ----------
// a password field, also one shown as text (its "show password" eye) or a text field styled to hide what's typed
const wasPassword = new WeakSet();
function isPassword(el) {
  if (el.type === 'password') { wasPassword.add(el); return true; }
  if (el.type !== 'text') return false;
  const ac = autocomplete(el);
  if (ac.includes('one-time-code')) return false;
  if (/(current|new)-password/.test(ac) || wasPassword.has(el)) return true;
  const security = styleOf(el).webkitTextSecurity;
  if (security && security !== 'none') return true;
  const named = `${el.name} ${el.id}`;
  return PASSWORD_NAME.test(el.name) || PASSWORD_NAME.test(el.id) ? !USERNAME_HINT.test(named) : false;
}
const looksLikeUsername = (el) => /username|email|webauthn/.test(autocomplete(el)) || el.type === 'email' || USERNAME_HINT.test(attrs(el));
// a field a username could be typed in: text, email or phone (a number field only when it says it's an account)
function isTextish(el) {
  if (isPassword(el)) return false;
  if (!['text', 'email', 'tel', 'number'].includes(el.type)) return false;
  if (el.type === 'number' && !USERNAME_HINT.test(attrs(el))) return false;
  return !(NOT_LOGIN.test(attrs(el)) && !/username|email/.test(autocomplete(el)));
}

function formOf(el) {
  if (el.form) return el.form;
  for (let n = up(el); n && !isDoc(n); n = up(n)) if (n.localName === 'form') return n;
  return null;
}

// A login's fields: those of a <form> (also inside its web components), or of a part of the page without one.
function makeGroup(doc, form, box) {
  const s = snapshot(doc);
  const fields = s.all.filter((i) => (form ? i.form === form || within(form, i) : within(box, i) && !formOf(i)));
  const vis = fields.filter(s.shown);
  return { form, box: form || box, fields, passes: vis.filter(isPassword), texts: vis.filter(isTextish), at: (el) => s.order.get(el) ?? -1 };
}

// The login a field belongs to: its form, or with no form, the smallest part of the page around it that also holds the
// other half of a login (a password field for a username, a username for a password), else the whole page.
function groupOf(el) {
  const doc = el.ownerDocument;
  const form = formOf(el);
  if (form) return makeGroup(doc, form);
  const s = snapshot(doc);
  const pass = isPassword(el);
  const others = s.all.filter((i) => i !== el && !formOf(i) && s.shown(i) && (pass ? isTextish(i) : isPassword(i)));
  if (others.length) for (let n = up(el); n && !isDoc(n); n = up(n)) if (others.some((o) => within(n, o))) return makeGroup(doc, null, n);
  return makeGroup(doc, null, doc);
}

// what a button or form sends: its form, or the smallest part of the page around the button with a login field in it
function groupFrom(node) {
  const doc = node.ownerDocument;
  if (node.localName === 'form') return makeGroup(doc, node);
  if (isInput(node)) return groupOf(node);
  const form = formOf(node);
  if (form) return makeGroup(doc, form);
  const fields = snapshot(doc).all.filter((i) => !formOf(i) && (isPassword(i) || isTextish(i)));
  for (let n = up(node); n && !isDoc(n); n = up(n)) if (fields.some((f) => within(n, f))) return makeGroup(doc, null, n);
  return makeGroup(doc, null, doc);
}

const groupHint = (g) => (isDoc(g.box) ? '' : `${g.box.id} ${g.box.getAttribute('class') || ''} ${g.box.getAttribute('action') || ''} ${g.box.getAttribute('name') || ''}`);

// current (signing in, or the old password when changing it) or new (signing up, the new one and its confirmation)
function passwordKind(el, passes, g) {
  const ac = autocomplete(el);
  if (ac.includes('new-password')) return 'new';
  if (ac.includes('current-password')) return 'current';
  const a = attrs(el);
  if (CURRENT_HINT.test(a)) return 'current';
  if (NEW_HINT.test(a)) return 'new';
  if (passes.length <= 1) return SIGNUP_HINT.test(groupHint(g)) ? 'new' : 'current';
  // two: a new password and its confirmation; three: the old one, then the new one twice
  return passes.length >= 3 && passes.indexOf(el) === 0 ? 'current' : 'new';
}
const currentPassword = (g) => g.passes.find((p) => passwordKind(p, g.passes, g) === 'current') || (g.passes.length === 1 ? g.passes[0] : null);

// The username for a password field: the text field before it (the closest that looks like a username if several do),
// or on a step with no password (the first of a two-step sign-in), the one that looks like it.
function usernameFor(g, pass) {
  const at = pass ? g.at(pass) : Infinity;
  const texts = g.texts.filter((t) => g.at(t) < at);
  const named = texts.filter(looksLikeUsername);
  return named[named.length - 1] || (pass ? texts[texts.length - 1] : null) || null;
}

// What a focused field is to Ultima: username, password or new-password (null: not a login field)
function fieldKind(el) {
  if (!isInput(el) || !editable(el) || !shown(el)) return null;
  const g = groupOf(el);
  if (isPassword(el)) return passwordKind(el, g.passes, g) === 'new' ? 'new-password' : 'password';
  if (!isTextish(el)) return null;
  if (g.passes.length) {
    const pass = currentPassword(g);
    return pass && usernameFor(g, pass) === el ? 'username' : null;
  }
  // the username step of a two-step sign-in (not a contact or checkout form that asks for an email)
  const busy = g.texts.length > 2 || (!isDoc(g.box) && deepAll(new Set(['textarea']), g.box).length > 0);
  return looksLikeUsername(el) && !busy ? 'username' : null;
}

// ---------- filling ----------
// Sets a field as if typed, so the page's own scripts notice: the browser's own value setter (React, Vue and Angular
// watch the property, not the field), then the events typing would send.
const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
function setValue(el, value) {
  const key = (type) => el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, composed: true, cancelable: true }));
  key('keydown');
  valueSetter.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }));
  key('keyup');
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// a soft ring in Ultima's accent color on the fields just filled
function glow(els, accent) {
  const c = /^#[0-9a-f]{3,8}$/i.test(accent || '') ? accent : '#8b5cf6';
  for (const el of els) {
    try {
      el.animate([{ boxShadow: `0 0 0 2px ${c}, 0 0 14px ${c}66` }, { boxShadow: `0 0 0 2px ${c}00, 0 0 14px ${c}00` }], { duration: 1100, easing: 'ease-out' });
    } catch { /* fine without */ }
  }
}

let current = null; // { el, kind }: the login field the menu is for
let menu = { open: false, selected: false }; // as Ultima draws it (main.js tells this page)
let quiet = { until: 0, els: new Set() }; // just filled: focus coming back to those fields doesn't open the menu again
const isQuiet = (el) => Date.now() < quiet.until && quiet.els.has(el);

// The best place to fill when no field was picked (the key button, the Control Palette): the focused login field, else
// the first current password field, else the first username field.
function fillTarget() {
  if (current?.el.isConnected && shown(current.el)) return current.el;
  for (const doc of [document, ...blankDocs()]) {
    const focused = deepActive(doc);
    if (isInput(focused) && fieldKind(focused)) return focused;
  }
  for (const doc of [document, ...blankDocs()]) {
    const s = snapshot(doc);
    const passes = s.all.filter((p) => s.shown(p) && editable(p) && isPassword(p));
    const pass = passes.find((p) => currentPassword(groupOf(p)) === p) || passes[0];
    const user = pass || s.all.find((t) => s.shown(t) && fieldKind(t) === 'username');
    if (user) return user;
  }
  return null;
}

// Fills a saved login ({ username, password }) or a new password from the generator ({ generated }).
function fill({ username, password, generated }, accent) {
  const field = fillTarget();
  if (!field) return false;
  const g = groupOf(field);
  const passes = g.passes.filter(editable);
  const done = [];
  const put = (el, value) => { if (el.value !== value) setValue(el, value); done.push([el, value]); };
  if (generated) {
    // the new password and its confirmation (never the old one, on a change-password form)
    const targets = passes.filter((p) => passwordKind(p, g.passes, g) === 'new');
    if (!targets.length && isPassword(field) && editable(field)) targets.push(field);
    for (const p of targets) put(p, generated);
  } else {
    const fieldPass = isPassword(field) && editable(field) && passwordKind(field, g.passes, g) === 'current' ? field : null;
    const pass = fieldPass || (currentPassword(g) && editable(currentPassword(g)) ? currentPassword(g) : null);
    const user = !isPassword(field) && fieldKind(field) === 'username' ? field : usernameFor(g, pass);
    if (user && username && editable(user)) put(user, username);
    if (pass && password) put(pass, password);
  }
  quiet = { until: Date.now() + 1200, els: new Set([field, ...done.map(([el]) => el)]) };
  glow(done.map(([el]) => el), accent);
  // a page that redraws its form as it hears the first field can clear the next one: fill it again once
  setTimeout(() => { for (const [el, value] of done) if (el.isConnected && el.value === '' && editable(el)) setValue(el, value); }, 180);
  return done.length > 0;
}

ipcRenderer.on('ultima:pw-fill', (_e, { token, login, origin, accent }) => {
  let ok = false;
  // only into the frame main.js checked: not one that has since moved to another site
  if (ORIGIN && (!origin || origin === ORIGIN)) {
    try { ok = fill(login || {}, accent); } catch { /* the page changed under us */ }
  }
  ipcRenderer.send('ultima:pw-filled', { token, ok });
});

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
    const frame = deepAll(new Set(['iframe', 'frame']), document).find((f) => f.contentWindow === e.source);
    const own = frame && await frameOffset();
    if (!own) return;
    const r = frame.getBoundingClientRect();
    const s = styleOf(frame);
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
  // a field in an about:blank frame this page wrote: add where that frame sits
  for (let doc = el.ownerDocument; doc !== document; doc = doc.defaultView.frameElement.ownerDocument) {
    const fe = doc.defaultView?.frameElement;
    if (!fe) return null;
    const b = fe.getBoundingClientRect();
    off.x += b.left + fe.clientLeft;
    off.y += b.top + fe.clientTop;
  }
  const r = el.getBoundingClientRect();
  const z = webFrame.getZoomFactor();
  return { x: (off.x + r.left) * z, y: (off.y + r.top) * z, width: r.width * z, height: r.height * z };
}

// ---------- the menu at a login field ----------
async function report(el, kind) {
  current = { el, kind };
  // a password field with no username beside it: the second step of a two-step sign-in
  const alone = kind === 'password' && !usernameFor(groupOf(el), el);
  const rect = await rectOf(el);
  if (rect && current?.el === el) ipcRenderer.send('ultima:pw-field', { kind, rect, alone, typed: kind === 'username' ? el.value.slice(0, 200) : '' });
}

function leave() {
  if (!current) return;
  current = null;
  ipcRenderer.send('ultima:pw-blur');
}

// Looked at just after the focus lands (a page's own focus handler may make the field editable first), and again for a
// little while if it isn't on screen yet (a modal that focuses its field as it fades or slides in).
let focusSeq = 0;
function onFocus(el) {
  const inner = blankDocOf(el);
  if (inner) { watch(inner); onFocus(deepActive(inner)); return; }
  const seq = ++focusSeq;
  let tries = 0;
  const look = () => {
    if (seq !== focusSeq || !el?.isConnected || deepActive(el.ownerDocument) !== el) return;
    if (isInput(el) && !shown(el) && tries++ < 15) { setTimeout(look, 100); return; }
    const kind = fieldKind(el);
    if (!kind) { leave(); return; }
    if (isQuiet(el)) { current = { el, kind }; return; }
    report(el, kind);
  };
  setTimeout(look, 0);
}

// While the menu is open it follows its field (scrolling, a modal still moving into place) and closes if the field goes.
let follow = null;
let lastRect = '';
function following(on) {
  clearInterval(follow);
  follow = null;
  if (!on) return;
  lastRect = '';
  follow = setInterval(async () => {
    if (!current) { following(false); return; }
    if (!current.el.isConnected || !shown(current.el)) { leave(); following(false); return; }
    const rect = await rectOf(current.el);
    const key = rect && [rect.x, rect.y, rect.width, rect.height].map(Math.round).join();
    if (rect && key !== lastRect) { lastRect = key; ipcRenderer.send('ultima:pw-move', rect); }
  }, 150);
}

// A frame this page wrote into (an about:blank frame it builds or document.write()s) gets no preload of its own: this
// one looks after it. Frames with their own mark their window (in this preload's world, which pages can't see).
const MINE = Symbol.for('ultima.passwords');
window[MINE] = true;
const watched = new WeakMap(); // document → its root element when watched (document.open() wipes listeners and root)
function blankDocOf(el) {
  if (el?.localName !== 'iframe' && el?.localName !== 'frame') return null;
  try {
    const doc = el.contentDocument;
    return doc?.defaultView && !el.contentWindow[MINE] && doc.defaultView.origin === ORIGIN ? doc : null;
  } catch { return null; }
}
const blankDocs = () => deepAll(new Set(['iframe', 'frame']), document).map(blankDocOf).filter((d) => d && watched.has(d));
// the focus going into such a frame: this window loses it, with no focus event on the frame element
function intoFrame(doc) {
  const inner = blankDocOf(deepActive(doc));
  if (!inner) return;
  watch(inner);
  onFocus(deepActive(inner));
}

function watch(doc) {
  if (watched.get(doc) === doc.documentElement) return;
  watched.set(doc, doc.documentElement);
  const win = doc.defaultView;
  win.addEventListener('blur', () => setTimeout(() => intoFrame(doc), 0));
  doc.addEventListener('focusin', (e) => onFocus(e.composedPath()[0]), true);
  doc.addEventListener('focusout', (e) => {
    if (current && e.composedPath()[0] === current.el) { focusSeq += 1; ipcRenderer.send('ultima:pw-blur'); }
  }, true);
  // clicking a field that already has the focus opens the menu again (after it was closed)
  doc.addEventListener('mousedown', (e) => {
    const el = e.composedPath()[0];
    if (e.button === 0 && el === deepActive(doc) && !menu.open) { quiet.until = 0; onFocus(el); }
  }, true);
  doc.addEventListener('input', (e) => {
    if (!current || e.composedPath()[0] !== current.el || !e.isTrusted) return;
    // a username narrows the menu to the logins it starts; typing a password closes it
    if (current.kind === 'username') ipcRenderer.send('ultima:pw-typed', current.el.value.slice(0, 200));
    else if (menu.open) ipcRenderer.send('ultima:pw-blur');
  }, true);
  let moving = false;
  win.addEventListener('scroll', () => {
    if (!current || !menu.open || moving) return;
    moving = true;
    requestAnimationFrame(async () => {
      moving = false;
      const rect = current && await rectOf(current.el);
      if (rect) ipcRenderer.send('ultima:pw-move', rect);
    });
  }, { capture: true, passive: true });
  win.addEventListener('pagehide', () => { if (current) ipcRenderer.send('ultima:pw-blur'); });

  // The menu's keys, while it's open: arrows move through it, Enter fills the login picked, Esc closes it. Heard on the
  // window before the page's own handlers, so a page's shortcuts or modal don't take them.
  win.addEventListener('keydown', (e) => {
    if (!current || e.composedPath()[0] !== current.el || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const key = e.key;
    if (!menu.open) {
      if (key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); quiet.until = 0; report(current.el, current.kind); }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Escape' || (key === 'Enter' && menu.selected)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      ipcRenderer.send('ultima:pw-key', key);
    } else if (key === 'Tab') ipcRenderer.send('ultima:pw-blur');
  }, true);

  // signing in (see capture)
  doc.addEventListener('submit', (e) => { if (e.target?.localName === 'form') capture(e.target); }, true);
  doc.addEventListener('click', (e) => {
    const b = sendable(e.composedPath()[0]);
    if (!b) return;
    const label = `${b.textContent} ${b.value || ''} ${b.getAttribute('aria-label') || ''} ${b.id} ${b.getAttribute('class') || ''}`;
    const form = formOf(b);
    // in a form, any button that sends it; outside one, a button that says what it does (Sign in, Next…)
    if (form ? (b.type === 'submit' || b.type === 'image' || SUBMIT_HINT.test(label)) : SUBMIT_HINT.test(label)) capture(form || b);
  }, true);
  doc.addEventListener('keydown', (e) => {
    const el = e.composedPath()[0];
    if (e.key === 'Enter' && isInput(el) && !e.isComposing) capture(el);
  }, true);
}
if (ORIGIN) watch(document);

ipcRenderer.on('ultima:pw-menu', (_e, state) => {
  menu = { open: Boolean(state?.open), selected: Boolean(state?.selected) };
  if (menu.open !== Boolean(follow)) following(menu.open);
});

// ---------- noticing a sign-in ----------
// When a login is sent (a form submitted, its button clicked or Enter pressed), main.js hears the username and
// password, and offers to save or update them once the page moves on (or the form goes away, on pages that sign in
// without leaving).
let lastSent = '';
function capture(node) {
  const g = groupFrom(node);
  const passes = g.fields.filter((p) => isPassword(p) && p.value);
  if (!passes.length) {
    // the first step of a two-step sign-in: the username, for when the password comes
    const user = usernameFor(g, null);
    if (user?.value.trim() && looksLikeUsername(user)) ipcRenderer.send('ultima:pw-username', user.value.trim().slice(0, 500));
    return;
  }
  const kinds = passes.map((p) => passwordKind(p, passes, g));
  const old = passes.find((p, i) => kinds[i] === 'current')?.value;
  const fresh = passes.filter((p, i) => kinds[i] === 'new').map((p) => p.value);
  if (fresh.some((v) => v !== fresh[0])) return; // the new password and its confirmation differ: the page will say so
  const user = usernameFor(g, passes[0]);
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
