// Shared helpers for the browser UI.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?query=' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=' },
};

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Turns whatever the user typed into a URL: explicit URL, bare domain, or a search.
function resolveInput(text, engineKey) {
  const q = text.trim();
  if (!q) return null;
  if (/^ultima:\/\/\w+/i.test(q)) return q.toLowerCase();
  if (/^(https?|file|about|data|view-source|chrome|chrome-extension):/i.test(q)) return q;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(q)) return `http://${q}`;
  if (!/\s/.test(q) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(q) && /\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(q)) return `https://${q}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(q)) return `http://${q}`;
  return searchUrl(q, engineKey);
}

function searchUrl(q, engineKey) {
  return (SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.google).url + encodeURIComponent(q);
}

function looksLikeUrl(text) {
  const r = resolveInput(text, 'google');
  return Boolean(r) && !r.startsWith(SEARCH_ENGINES.google.url);
}

function letterColor(s) {
  let n = 0;
  for (const c of s) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 55% 48%)`;
}

// Favicon <img> with a colored-letter fallback.
function favHtml(favicon, url, title) {
  const host = hostname(url) || title || '?';
  const letter = esc((host[0] || '?').toUpperCase());
  const fallback = `<span class="fav-letter" style="background:${letterColor(host)}">${letter}</span>`;
  if (!favicon) return fallback;
  return `<img class="fav" src="${esc(favicon)}" alt="" data-fallback="${esc(fallback)}">`;
}

document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.dataset.fallback) img.replaceWith(h(img.dataset.fallback));
}, true);

// Copies through the main process (see clipboard:write), then confirms with a toast, or says it didn't work.
async function copyText(text, message = 'Copied') {
  try { await window.ultima.copyText(String(text)); toast(message); } catch { toast('Couldn’t copy to the clipboard'); }
}

function toast(message, action) {
  const t = h(`<div class="toast"><span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}</div>`);
  if (action) t.querySelector('button').onclick = () => { action.run(); t.remove(); };
  $('#toasts').append(t);
  setTimeout(() => t.remove(), action ? 6000 : 3200);
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// Highlights the query tokens inside text (already-escaped output). The text is matched as it is and escaped piece by
// piece, so a match never lands inside an escape ("Q&A" searched for "a" stays "Q&A", not "&amp;").
function highlight(text, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return esc(text);
  return String(text ?? '').split(new RegExp(`(${tokens.join('|')})`, 'gi')).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

// ---------- keyboard shortcuts (bindings live in keymap.js + settings.keybindings) ----------
const KEYS = { bindings: {}, platform: 'win32' };

function loadKeys(overrides, platform = KEYS.platform) {
  KEYS.platform = platform;
  KEYS.bindings = KEYMAP.resolve(overrides, platform);
}

const keysFor = (id) => KEYS.bindings[id] || [];
const keyText = (id) => (keysFor(id)[0] ? KEYMAP.display(keysFor(id)[0], KEYS.platform) : '');
const kbdHtml = (combo) => KEYMAP.displayParts(combo, KEYS.platform).map((p) => `<kbd>${esc(p)}</kbd>`).join('');
const withKey = (label, id) => (keyText(id) ? `${label} (${keyText(id)})` : label);

function matchesKey(e, id) {
  const combo = KEYMAP.comboFromEvent(e);
  return Boolean(combo) && keysFor(id).includes(combo);
}

// Re-labels every tooltip and key hint in the static UI with the current bindings.
function refreshKeyHints() {
  $$('[data-cmd]').forEach((el) => { el.title = withKey(el.dataset.label, el.dataset.cmd); });
  $$('[data-kbd]').forEach((el) => {
    const combo = keysFor(el.dataset.kbd)[0];
    el.innerHTML = combo ? kbdHtml(combo) : '';
  });
}
