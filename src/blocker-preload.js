// The ad blocker's part inside web pages (the rules come from main/blocker.js, through main.js). As each page and frame
// starts:
//   1. its scriptlets run in the page, before the page's own scripts (asked synchronously): small patches that take ads
//      out of the data a site loads (json-prune…), or stop an ad script (abort-on-property-read…), as in uBlock Origin
//   2. its element hiding rules are added as a user style sheet, so the page can neither override nor remove them
//   3. its procedural rules (:has-text, :upward…), which CSS can't express, are applied here and again as the page
//      changes
// A session preload (see setupSession in main.js); extension pages and Ultima's own pages are left alone.
const { ipcRenderer, webFrame, contextBridge } = require('electron');

// ---------- scriptlets (run in the page's own world; this function is copied there, so it uses nothing outside it) ----------
// Each takes uBlock Origin's arguments. Unknown scriptlets are skipped.
function runScriptlets(list) {
  const ALIASES = {
    set: 'set-constant', 'trusted-set': 'trusted-set-constant', aopr: 'abort-on-property-read', aopw: 'abort-on-property-write',
    acs: 'abort-current-script', 'abort-current-inline-script': 'abort-current-script', acis: 'abort-current-script',
    aost: 'abort-on-stack-trace', jpfr: 'json-prune-fetch-response', jpxr: 'json-prune-xhr-response',
    'trusted-rpxr': 'trusted-replace-xhr-response', 'trusted-rpfr': 'trusted-replace-fetch-response',
    nostif: 'no-setTimeout-if', 'prevent-setTimeout': 'no-setTimeout-if', 'setTimeout-defuser': 'no-setTimeout-if',
    nosiif: 'no-setInterval-if', 'prevent-setInterval': 'no-setInterval-if', 'setInterval-defuser': 'no-setInterval-if',
    aeld: 'addEventListener-defuser', 'prevent-addEventListener': 'addEventListener-defuser',
    'no-fetch-if': 'prevent-fetch', 'no-xhr-if': 'prevent-xhr', nowoif: 'no-window-open-if', 'prevent-window-open': 'no-window-open-if',
    'window.open-defuser': 'no-window-open-if', ra: 'remove-attr', rc: 'remove-class', rmnt: 'remove-node-text',
    rpnt: 'replace-node-text', 'trusted-rpnt': 'replace-node-text', 'trusted-replace-node-text': 'replace-node-text',
    'prevent-eval-if': 'noeval-if', 'nano-stb': 'adjust-setTimeout', 'nano-setTimeout-booster': 'adjust-setTimeout',
    'nano-sib': 'adjust-setInterval', 'nano-setInterval-booster': 'adjust-setInterval',
    'trusted-json-edit': 'json-edit', 'trusted-json-edit-xhr-response': 'json-edit-xhr-response',
    'trusted-json-edit-fetch-response': 'json-edit-fetch-response', 'trusted-jsonl-edit-xhr-response': 'jsonl-edit-xhr-response',
    'trusted-jsonl-edit-fetch-response': 'jsonl-edit-fetch-response',
  };
  // the page's own functions as they are now, before its scripts (or other scriptlets) could replace them
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const fnToString = Function.prototype.toString;
  const magic = `ultima${Math.random().toString(36).slice(2)}`;
  const abortError = () => new ReferenceError(magic);
  const NEVER = /[^\s\S]/;

  // an error a scriptlet threw to stop an ad script doesn't reach the page's error handlers or the console
  const onError = window.onerror;
  window.onerror = function onerror(msg, ...rest) {
    if (typeof msg === 'string' && msg.includes(magic)) return true;
    return typeof onError === 'function' ? onError.call(this, msg, ...rest) : false;
  };
  window.addEventListener('error', (e) => { if (String(e.message).includes(magic)) e.preventDefault(); });

  // "text" matches anywhere, "/re/flags" is a regular expression, "" matches everything
  const patternToRegex = (pattern, flags) => {
    if (!pattern) return /^/;
    const m = /^\/(.+)\/([dgimsuvy]*)$/.exec(pattern);
    if (m) { try { return new RegExp(m[1], flags === undefined ? m[2] : flags); } catch { return NEVER; } }
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  };
  // "!pattern" negates
  const needleTest = (needle) => {
    const not = needle.startsWith('!');
    const re = patternToRegex(not ? needle.slice(1) : needle);
    return (s) => re.test(s) !== not;
  };
  // extra arguments come in name, value pairs
  const extras = (args) => { const o = {}; for (let i = 0; i + 1 < args.length; i += 2) o[args[i]] = args[i + 1]; return o; };
  const fnText = (f) => { try { return typeof f === 'function' ? fnToString.call(f) : String(f); } catch { return ''; } };

  // propsToMatch: "url-pattern", or "prop:pattern" pairs (url, method…) a request must all match
  const matchesProps = (details, propsToMatch) => {
    if (!propsToMatch) return true;
    for (const token of propsToMatch.split(/\s+/)) {
      if (!token) continue;
      const m = /^(url|method|mode|credentials|cache|redirect|body|headers|referrer|referrerPolicy|integrity|priority):(.*)$/.exec(token);
      const prop = m ? m[1] : 'url';
      if (!patternToRegex(m ? m[2] : token).test(String(details[prop] ?? ''))) return false;
    }
    return true;
  };
  const fetchDetails = (args) => {
    const input = args[0];
    const init = args[1] || {};
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    return { url: isRequest ? input.url : String(input), method: (init.method || (isRequest && input.method) || 'GET').toUpperCase(), body: init.body };
  };

  // set-constant values (uBlock's vocabulary); trusted- variants also take any JSON
  const INVALID = {};
  const constantOf = (raw, trusted) => {
    const named = {
      undefined, false: false, true: true, null: null, "''": '', emptyStr: '', '[]': [], emptyArr: [], '{}': {}, emptyObj: {},
      noopFunc() {}, trueFunc: () => true, falseFunc: () => false, throwFunc: () => { throw abortError(); },
      noopCallbackFunc: () => function noop() {}, yes: 'yes', no: 'no', on: 'on', off: 'off', accept: 'accept', reject: 'reject',
    };
    if (Object.prototype.hasOwnProperty.call(named, raw)) {
      const v = named[raw];
      return Array.isArray(v) ? [] : v && typeof v === 'object' ? {} : v;
    }
    if (/^-?\d+$/.test(raw)) return Number(raw) <= 32767 || trusted ? Number(raw) : INVALID;
    if (trusted) { try { return jsonParse(raw); } catch { return INVALID; } }
    return INVALID;
  };

  // ---- property traps ----
  function setConstant(chain, raw, wrap, trusted) {
    let cValue = constantOf(raw, trusted);
    if (cValue === INVALID || !chain) return;
    if (wrap === 'asFunction') { const v = cValue; cValue = () => v; } else if (wrap === 'asCallback') { const v = cValue; cValue = () => () => v; } else if (wrap === 'asResolved') cValue = Promise.resolve(cValue);
    else if (wrap === 'asRejected') cValue = Promise.reject(cValue);
    let aborted = false;
    const mustAbort = (v) => {
      if (aborted) return true;
      aborted = v !== undefined && v !== null && cValue !== undefined && cValue !== null && typeof v !== typeof cValue;
      return aborted;
    };
    const trapProp = (owner, prop, configurable, handler) => {
      if (handler.init(configurable ? owner[prop] : cValue) === false) return;
      const odesc = Object.getOwnPropertyDescriptor(owner, prop);
      let prevGetter;
      let prevSetter;
      if (odesc) {
        owner[prop] = cValue;
        if (typeof odesc.get === 'function') prevGetter = odesc.get;
        if (typeof odesc.set === 'function') prevSetter = odesc.set;
      }
      try {
        Object.defineProperty(owner, prop, {
          configurable,
          get() { if (prevGetter) prevGetter.call(owner); return handler.getter(); },
          set(a) { if (prevSetter) prevSetter.call(owner, a); handler.setter(a); },
        });
      } catch { /* not configurable */ }
    };
    const trapChain = (owner, path) => {
      const pos = path.indexOf('.');
      if (pos === -1) {
        trapProp(owner, path, false, {
          init(v) { return !mustAbort(v); },
          getter() { return cValue; },
          setter(a) { if (mustAbort(a)) cValue = a; },
        });
        return;
      }
      const prop = path.slice(0, pos);
      const rest = path.slice(pos + 1);
      const v = owner[prop];
      if (v !== null && (typeof v === 'object' || typeof v === 'function')) { trapChain(v, rest); return; }
      trapProp(owner, prop, true, {
        v: undefined,
        init(x) { this.v = x; return true; },
        getter() { return this.v; },
        setter(a) { this.v = a; if (a !== null && (typeof a === 'object' || typeof a === 'function')) trapChain(a, rest); },
      });
    };
    trapChain(window, chain);
  }

  // Runs `onAccess` whenever the property at `chain` is read (or written), even if it's created later
  function trapAccess(chain, onRead, onWrite) {
    const make = (owner, path) => {
      const pos = path.indexOf('.');
      if (pos === -1) {
        const desc = Object.getOwnPropertyDescriptor(owner, path);
        let value = desc && !desc.get ? owner[path] : undefined;
        try {
          Object.defineProperty(owner, path, {
            configurable: true,
            get() { onRead(); return desc && desc.get ? desc.get.call(owner) : value; },
            set(a) { onWrite(); if (desc && desc.set) desc.set.call(owner, a); else value = a; },
          });
        } catch { /* not configurable */ }
        return;
      }
      const prop = path.slice(0, pos);
      const rest = path.slice(pos + 1);
      let v = owner[prop];
      if (v) { make(v, rest); return; }
      const desc = Object.getOwnPropertyDescriptor(owner, prop);
      if (desc && desc.set !== undefined) return;
      try {
        Object.defineProperty(owner, prop, {
          configurable: true,
          get() { return v; },
          set(a) { v = a; if (a instanceof Object) make(a, rest); },
        });
      } catch { /* not configurable */ }
    };
    make(window, chain);
  }

  // the text of the script running now (inline, or a data: URL)
  const scriptText = (el) => {
    const text = el.textContent;
    if (text.trim()) return text;
    const m = /^data:([^,]*),(.+)$/.exec(el.src.trim());
    if (!m) return '';
    try { return m[1].endsWith(';base64') ? atob(m[2]) : decodeURIComponent(m[2]); } catch { return ''; }
  };

  // ---- pruning and editing JSON ----
  // uBlock's prune paths: a.b.c, [] / {} (every item), [-] / {-} (remove the item holding the rest), * (any key)
  const findOwner = (root, path, prune) => {
    let owner = root;
    let chain = path;
    for (;;) {
      if (typeof owner !== 'object' || owner === null) return false;
      const pos = chain.indexOf('.');
      if (pos === -1) {
        if (!prune) return Object.prototype.hasOwnProperty.call(owner, chain);
        let modified = false;
        if (chain === '*') { for (const key of Object.keys(owner)) { delete owner[key]; modified = true; } } else if (Object.prototype.hasOwnProperty.call(owner, chain)) { delete owner[chain]; modified = true; }
        return modified;
      }
      const prop = chain.slice(0, pos);
      const next = chain.slice(pos + 1);
      let found = false;
      if (prop === '[-]' && Array.isArray(owner)) {
        for (let i = owner.length - 1; i >= 0; i -= 1) { if (findOwner(owner[i], next)) { owner.splice(i, 1); found = true; } }
        return found;
      }
      if (prop === '{-}' && owner instanceof Object) {
        for (const key of Object.keys(owner)) { if (findOwner(owner[key], next)) { delete owner[key]; found = true; } }
        return found;
      }
      if ((prop === '[]' && Array.isArray(owner)) || ((prop === '{}' || prop === '*') && owner instanceof Object)) {
        for (const key of Object.keys(owner)) { if (findOwner(owner[key], next, prune)) found = true; }
        return found;
      }
      if (!Object.prototype.hasOwnProperty.call(owner, prop)) return false;
      owner = owner[prop];
      chain = next;
    }
  };
  // prunes `obj` in place; true when anything was removed
  const objectPrune = (obj, rawPrune, rawNeedles) => {
    if (!rawPrune || typeof obj !== 'object' || obj === null) return false;
    const needles = rawNeedles ? rawNeedles.split(/ +/).filter(Boolean) : [];
    if (needles.length && !needles.every((p) => findOwner(obj, p))) return false;
    let pruned = false;
    for (const p of rawPrune.split(/ +/)) if (p && findOwner(obj, p, true)) pruned = true;
    return pruned;
  };

  // uBlock's JSONPath for json-edit: .key ..key .* [n] ["key"] [?.path op value]; =value at the end assigns instead of removing
  const parseJsonPath = (q) => {
    const steps = [];
    let i = 0;
    const readKey = () => { const m = /^(\*|[^.[=]+)/.exec(q.slice(i)); i += m ? m[0].length : 0; return m ? m[0] : ''; };
    const closeBracket = (from) => {
      let quote = null;
      for (let j = from; j < q.length; j += 1) {
        const c = q[j];
        if (quote) { if (c === '\\') j += 1; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === ']') return j;
      }
      return -1;
    };
    let assign;
    while (i < q.length) {
      if (q.startsWith('..', i)) { i += 2; steps.push({ desc: true, key: readKey() }); } else if (q[i] === '.') { i += 1; steps.push({ key: readKey() }); } else if (q[i] === '[') {
        const end = closeBracket(i + 1);
        if (end < 0) return null;
        const inner = q.slice(i + 1, end).trim();
        i = end + 1;
        if (inner.startsWith('?')) steps.push({ filter: parseFilter(inner.slice(1)) });
        else if (/^["']/.test(inner)) steps.push({ key: inner.slice(1, -1) });
        else steps.push({ key: inner === '*' ? '*' : inner });
      } else if (q[i] === '=') { try { assign = { value: jsonParse(q.slice(i + 1)) }; } catch { assign = { value: q.slice(i + 1) }; } break; } else steps.push({ key: readKey() || q[i++] });
    }
    return { steps, assign };
  };
  const parseFilter = (expr) => {
    const m = /^(.*?)\s*(==|!=|\^=|\$=|\*=|<=|>=|<|>)\s*(.*)$/.exec(expr);
    if (!m) return { path: parseJsonPath(expr.trim()), op: null };
    let value;
    try { value = jsonParse(m[3]); } catch { value = m[3].replace(/^["']|["']$/g, ''); }
    return { path: parseJsonPath(m[1]), op: m[2], value };
  };
  const testFilter = (f, node) => {
    if (!f.path) return false;
    const values = selectJson(node, f.path.steps).map((r) => r.value);
    if (!f.op) return values.some((v) => v !== undefined);
    return values.some((v) => {
      switch (f.op) {
        case '==': return v === f.value;
        case '!=': return v !== f.value;
        case '^=': return typeof v === 'string' && v.startsWith(f.value);
        case '$=': return typeof v === 'string' && v.endsWith(f.value);
        case '*=': return typeof v === 'string' && v.includes(f.value);
        case '<': return v < f.value;
        case '<=': return v <= f.value;
        case '>': return v > f.value;
        case '>=': return v >= f.value;
        default: return false;
      }
    });
  };
  // the nodes a path selects, as { parent, key, value }
  const selectJson = (root, steps) => {
    let refs = [{ parent: null, key: null, value: root }];
    const childrenOf = (v) => (v !== null && typeof v === 'object' ? Object.keys(v).map((k) => ({ parent: v, key: Array.isArray(v) ? Number(k) : k, value: v[k] })) : []);
    for (const step of steps) {
      const next = [];
      if (step.filter) {
        for (const r of refs) {
          if (testFilter(step.filter, r.value)) next.push(r);
          else if (Array.isArray(r.value)) for (const c of childrenOf(r.value)) if (testFilter(step.filter, c.value)) next.push(c);
        }
      } else if (step.desc) {
        const walk = (v, depth) => {
          if (depth > 64) return;
          for (const c of childrenOf(v)) {
            if (step.key === '*' || c.key === step.key || String(c.key) === step.key) next.push(c);
            walk(c.value, depth + 1);
          }
        };
        for (const r of refs) walk(r.value, 0);
      } else {
        for (const r of refs) {
          if (step.key === '*') next.push(...childrenOf(r.value));
          else if (r.value !== null && typeof r.value === 'object' && Object.prototype.hasOwnProperty.call(r.value, step.key)) next.push({ parent: r.value, key: step.key, value: r.value[step.key] });
        }
      }
      refs = next;
      if (!refs.length) break;
    }
    return refs;
  };
  // edits `obj` in place; true when anything changed
  const jsonEdit = (obj, path) => {
    if (!path || typeof obj !== 'object' || obj === null) return false;
    const refs = selectJson(obj, path.steps).filter((r) => r.parent);
    if (!refs.length) return false;
    if (path.assign) { for (const r of refs) r.parent[r.key] = path.assign.value; return true; }
    // array items go from the end, so the indexes of the others stay right
    refs.sort((a, b) => (typeof b.key === 'number' ? b.key : 0) - (typeof a.key === 'number' ? a.key : 0));
    for (const r of refs) { if (Array.isArray(r.parent) && typeof r.key === 'number') r.parent.splice(r.key, 1); else delete r.parent[r.key]; }
    return true;
  };
  const editPath = (name, q) => {
    const path = parseJsonPath(q || '');
    if (!path || !path.steps.length) return null;
    if (path.assign && !name.startsWith('trusted-')) return null; // only uBlock's trusted lists may change values
    return path;
  };

  // ---- hooks into JSON.parse, Response.json, fetch and XMLHttpRequest, shared by the scriptlets ----
  const parseHooks = [];
  const hookParse = (fn) => {
    if (!parseHooks.length) {
      JSON.parse = new Proxy(JSON.parse, {
        apply(target, thisArg, args) {
          const out = Reflect.apply(target, thisArg, args);
          for (const h of parseHooks) { try { h(out); } catch { /* the page's data is used as it was */ } }
          return out;
        },
      });
      Response.prototype.json = new Proxy(Response.prototype.json, {
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, args).then((out) => {
            for (const h of parseHooks) { try { h(out); } catch { /* as it was */ } }
            return out;
          });
        },
      });
    }
    parseHooks.push(fn);
  };
  // fetch responses: transforms get (details, text) and return new text or undefined
  const fetchHooks = [];
  const hookFetch = (fn) => {
    if (!fetchHooks.length) {
      window.fetch = new Proxy(window.fetch, {
        apply(target, thisArg, args) {
          const details = fetchDetails(args);
          for (const h of fetchHooks) { if (h.block && matchesProps(details, h.props)) return h.block(details); }
          const p = Reflect.apply(target, thisArg, args);
          const wanted = fetchHooks.filter((h) => h.transform && matchesProps(details, h.props));
          if (!wanted.length) return p;
          return p.then((res) => res.clone().text().then((text) => {
            let out = text;
            for (const h of wanted) { try { const r = h.transform(details, out); if (typeof r === 'string') out = r; } catch { /* unchanged */ } }
            if (out === text) return res;
            const copy = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
            for (const k of ['ok', 'redirected', 'type', 'url']) { try { Object.defineProperty(copy, k, { value: res[k] }); } catch { /* read-only */ } }
            return copy;
          }).catch(() => res));
        },
      });
    }
    fetchHooks.push(fn);
  };
  const xhrHooks = [];
  const xhrInfo = new WeakMap();
  const hookXhr = (fn) => {
    if (!xhrHooks.length) {
      const proto = XMLHttpRequest.prototype;
      proto.open = new Proxy(proto.open, {
        apply(target, xhr, args) { xhrInfo.set(xhr, { method: String(args[0] || 'GET').toUpperCase(), url: String(args[1]) }); return Reflect.apply(target, xhr, args); },
      });
      proto.send = new Proxy(proto.send, {
        apply(target, xhr, args) {
          const info = xhrInfo.get(xhr);
          const blocker = info && xhrHooks.find((h) => h.block && matchesProps(info, h.props));
          if (!blocker) return Reflect.apply(target, xhr, args);
          // answered here, empty, as if the server had
          setTimeout(() => {
            const empty = { json: null, arraybuffer: new ArrayBuffer(0), blob: new Blob([]), document: null }[xhr.responseType] ?? '';
            const props = { readyState: 4, status: 200, statusText: 'OK', response: empty, responseText: typeof empty === 'string' ? empty : '', responseURL: info.url };
            for (const [k, v] of Object.entries(props)) { try { Object.defineProperty(xhr, k, { value: v, configurable: true }); } catch { /* read-only */ } }
            for (const type of ['readystatechange', 'load', 'loadend']) xhr.dispatchEvent(new Event(type));
          }, 1);
          return undefined;
        },
      });
      // Rewritten on every read, not only once it has all arrived: sites that stream (Facebook) read the text as it
      // comes in. Complete lines come out the same each time, so a reader keeping its place in the text stays right.
      const cache = new WeakMap(); // xhr → { length, out }
      const transformed = (xhr, raw) => {
        const info = xhrInfo.get(xhr);
        if (!info || typeof raw !== 'string' || !raw) return raw;
        const hit = cache.get(xhr);
        if (hit && hit.length === raw.length) return hit.out;
        let out = raw;
        for (const h of xhrHooks) {
          if (!h.transform || !matchesProps(info, h.props)) continue;
          try { const r = h.transform(info, out); if (typeof r === 'string') out = r; } catch { /* unchanged */ }
        }
        cache.set(xhr, { length: raw.length, out });
        return out;
      };
      const textDesc = Object.getOwnPropertyDescriptor(proto, 'responseText');
      const respDesc = Object.getOwnPropertyDescriptor(proto, 'response');
      Object.defineProperty(proto, 'responseText', {
        ...textDesc, get: new Proxy(textDesc.get, { apply(target, xhr, args) { return transformed(xhr, Reflect.apply(target, xhr, args)); } }),
      });
      Object.defineProperty(proto, 'response', {
        ...respDesc,
        get: new Proxy(respDesc.get, {
          apply(target, xhr, args) {
            const raw = Reflect.apply(target, xhr, args);
            if (xhr.responseType === 'json' && raw && typeof raw === 'object') {
              const text = jsonStringify(raw);
              const out = transformed(xhr, text);
              return out === text ? raw : jsonParse(out);
            }
            return transformed(xhr, raw);
          },
        }),
      });
    }
    xhrHooks.push(fn);
  };
  // a JSON transform, for responses: prune or edit the parsed text (each line of it, for JSON lines)
  const jsonTransform = (edit, lines) => (details, text) => {
    const one = (t) => { let obj; try { obj = jsonParse(t); } catch { return t; } return edit(obj) ? jsonStringify(obj) : t; };
    if (!lines) return one(text);
    return text.split('\n').map((l) => (l.trim() ? one(l) : l)).join('\n');
  };
  const replaceTransform = (pattern, replacement) => {
    const re = patternToRegex(pattern, /^\/.*\/[a-z]*$/.test(pattern) ? undefined : 'g');
    return (details, text) => text.replace(re, replacement);
  };

  // nodes whose text matches, as the page adds them (scripts before they run)
  const watchNodes = (nodeName, onNode) => {
    const want = nodeName.toLowerCase();
    const check = (n) => { if (n.nodeName.toLowerCase() === want) onNode(n); };
    const walk = (root) => { check(root); if (root.querySelectorAll && want !== '#text') root.querySelectorAll(want).forEach(onNode); };
    if (document.documentElement) walk(document.documentElement);
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) { check(n); if (n.querySelectorAll && want !== '#text') n.querySelectorAll(want).forEach(onNode); }
    }).observe(document, { childList: true, subtree: true });
  };
  // elements a scriptlet changes: now, when the document is ready, and (with "stay") as the page changes
  const onElements = (selector, behavior, fn) => {
    const run = () => { try { document.querySelectorAll(selector).forEach(fn); } catch { /* bad selector */ } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
    if (/complete/.test(behavior)) window.addEventListener('load', run, { once: true });
    if (/stay/.test(behavior)) {
      let timer = null;
      new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = null; run(); }, 50); }).observe(document, { childList: true, subtree: true, attributes: true });
    }
  };
  const timerHook = (name, test) => {
    window[name] = new Proxy(window[name], {
      apply(target, thisArg, args) {
        const replace = test(args);
        if (replace === 'defuse') args[0] = function noop() {};
        else if (typeof replace === 'number') args[1] = replace;
        return Reflect.apply(target, thisArg, args);
      },
    });
  };
  const timerNeedle = (needle, delay) => {
    const matchNeedle = needleTest(needle);
    const delayNot = delay.startsWith('!');
    const d = delay ? parseInt(delayNot ? delay.slice(1) : delay, 10) : NaN;
    return (args) => {
      if (!needle && !delay) return null;
      let defuse = !needle || matchNeedle(fnText(args[0]));
      if (defuse && !Number.isNaN(d)) defuse = (args[1] === d) !== delayNot;
      return defuse ? 'defuse' : null;
    };
  };

  let current = ''; // the scriptlet's name as the rule gave it (trusted- or not)
  const lib = {
    'set-constant': (chain, raw, wrap) => setConstant(chain, raw, wrap, false),
    'trusted-set-constant': (chain, raw, wrap) => setConstant(chain, raw, wrap, true),
    'abort-on-property-read': (chain) => { if (chain) trapAccess(chain, () => { throw abortError(); }, () => {}); },
    'abort-on-property-write': (chain) => { if (chain) trapAccess(chain, () => {}, () => { throw abortError(); }); },
    'abort-current-script': (chain, needle = '', context = '') => {
      if (!chain) return;
      const thisScript = document.currentScript;
      const reNeedle = patternToRegex(needle);
      const reContext = patternToRegex(context);
      const validate = () => {
        const el = document.currentScript;
        if (!(el instanceof HTMLScriptElement) || el === thisScript) return;
        if (context && !reContext.test(el.src)) return;
        if (!reNeedle.test(scriptText(el))) return;
        throw abortError();
      };
      trapAccess(chain, validate, validate);
    },
    'abort-on-stack-trace': (chain, needle = '') => {
      if (!chain) return;
      const page = location.href.split('#')[0];
      const re = patternToRegex(needle);
      const check = () => {
        const stack = String(new Error().stack).split(page).join('inlineScript').replace(/<anonymous>/g, 'injectedScript');
        if (re.test(stack)) throw abortError();
      };
      trapAccess(chain, check, check);
    },
    'json-prune': (prune, needles) => hookParse((obj) => objectPrune(obj, prune, needles)),
    'json-prune-fetch-response': (prune, needles, ...rest) => hookFetch({ props: extras(rest).propsToMatch, transform: jsonTransform((o) => objectPrune(o, prune, needles)) }),
    'json-prune-xhr-response': (prune, needles, ...rest) => hookXhr({ props: extras(rest).propsToMatch, transform: jsonTransform((o) => objectPrune(o, prune, needles)) }),
    'json-edit': (q) => { const p = editPath(current, q); if (p) hookParse((obj) => jsonEdit(obj, p)); },
    'json-edit-fetch-response': (q, ...rest) => { const p = editPath(current, q); if (p) hookFetch({ props: extras(rest).propsToMatch, transform: jsonTransform((o) => jsonEdit(o, p)) }); },
    'json-edit-xhr-response': (q, ...rest) => { const p = editPath(current, q); if (p) hookXhr({ props: extras(rest).propsToMatch, transform: jsonTransform((o) => jsonEdit(o, p)) }); },
    'jsonl-edit-xhr-response': (q, ...rest) => { const p = editPath(current, q); if (p) hookXhr({ props: extras(rest).propsToMatch, transform: jsonTransform((o) => jsonEdit(o, p), true) }); },
    'jsonl-edit-fetch-response': (q, ...rest) => { const p = editPath(current, q); if (p) hookFetch({ props: extras(rest).propsToMatch, transform: jsonTransform((o) => jsonEdit(o, p), true) }); },
    'trusted-replace-xhr-response': (pattern, replacement = '', props = '') => { if (pattern) hookXhr({ props, transform: replaceTransform(pattern, replacement) }); },
    'trusted-replace-fetch-response': (pattern, replacement = '', props = '') => { if (pattern) hookFetch({ props, transform: replaceTransform(pattern, replacement) }); },
    'no-setTimeout-if': (needle = '', delay = '') => timerHook('setTimeout', timerNeedle(needle, delay)),
    'no-setInterval-if': (needle = '', delay = '') => timerHook('setInterval', timerNeedle(needle, delay)),
    'adjust-setTimeout': (needle = '', delay = '1000', boost = '0.05') => {
      const match = needleTest(needle);
      const factor = Math.max(0.001, Math.min(50, parseFloat(boost) || 0.05));
      timerHook('setTimeout', (args) => ((delay === '*' || args[1] === parseInt(delay, 10)) && match(fnText(args[0])) ? (args[1] || 0) * factor : null));
    },
    'adjust-setInterval': (needle = '', delay = '1000', boost = '0.05') => {
      const match = needleTest(needle);
      const factor = Math.max(0.001, Math.min(50, parseFloat(boost) || 0.05));
      timerHook('setInterval', (args) => ((delay === '*' || args[1] === parseInt(delay, 10)) && match(fnText(args[0])) ? (args[1] || 0) * factor : null));
    },
    'addEventListener-defuser': (type = '', pattern = '') => {
      const reType = /^\/.*\/[a-z]*$/.test(type) ? patternToRegex(type) : type ? new RegExp(`^${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : /^/;
      const rePattern = patternToRegex(pattern);
      EventTarget.prototype.addEventListener = new Proxy(EventTarget.prototype.addEventListener, {
        apply(target, thisArg, args) {
          if (reType.test(String(args[0])) && rePattern.test(fnText(args[1]))) return undefined;
          return Reflect.apply(target, thisArg, args);
        },
      });
    },
    'prevent-fetch': (props = '', body = '', type = '') => {
      if (!props) return;
      const text = { emptyObj: '{}', emptyArr: '[]', emptyStr: '', true: 'true', false: 'false' }[body] ?? '';
      hookFetch({
        props,
        block(details) {
          const res = new Response(text, { status: 200, statusText: 'OK' });
          try { Object.defineProperty(res, 'url', { value: details.url }); if (type) Object.defineProperty(res, 'type', { value: type }); } catch { /* read-only */ }
          return Promise.resolve(res);
        },
      });
    },
    'prevent-xhr': (props = '') => { if (props) hookXhr({ props, block: true }); },
    'no-window-open-if': (pattern = '') => {
      const match = needleTest(pattern);
      window.open = new Proxy(window.open, {
        apply(target, thisArg, args) {
          if (match(String(args[0] ?? ''))) return null;
          return Reflect.apply(target, thisArg, args);
        },
      });
    },
    'remove-attr': (attrs = '', selector = '', behavior = '') => {
      const names = attrs.split(/\s*\|\s*/).filter(Boolean);
      if (!names.length) return;
      onElements(selector || names.map((a) => `[${a}]`).join(','), behavior, (el) => names.forEach((a) => el.removeAttribute(a)));
    },
    'remove-class': (classes = '', selector = '', behavior = '') => {
      const names = classes.split(/\s*\|\s*/).filter(Boolean);
      if (!names.length) return;
      onElements(selector || names.map((c) => `.${c}`).join(','), behavior, (el) => el.classList.remove(...names));
    },
    'remove-node-text': (nodeName = '', pattern = '') => {
      if (!nodeName || !pattern) return;
      const re = patternToRegex(pattern);
      watchNodes(nodeName, (n) => { if (re.test(n.textContent)) n.textContent = ''; });
    },
    'replace-node-text': (nodeName = '', pattern = '', replacement = '', ...rest) => {
      if (!nodeName || !pattern) return;
      const re = patternToRegex(pattern, /^\/.*\/[a-z]*$/.test(pattern) ? undefined : 'gms');
      const condition = extras(rest).condition;
      const reCondition = condition ? patternToRegex(condition) : null;
      watchNodes(nodeName, (n) => {
        const text = n.textContent;
        if (reCondition && !reCondition.test(text)) return;
        const out = text.replace(re, replacement);
        if (out !== text) n.textContent = out;
      });
    },
    'noeval-if': (needle = '') => {
      const match = patternToRegex(needle);
      window.eval = new Proxy(window.eval, { apply(target, thisArg, args) { return match.test(String(args[0])) ? undefined : Reflect.apply(target, thisArg, args); } });
    },
    'set-local-storage-item': (key = '', raw = '') => {
      if (!key) return;
      try {
        if (raw === '$remove$') { localStorage.removeItem(key); return; }
        const v = constantOf(raw, false);
        if (v !== INVALID) localStorage.setItem(key, typeof v === 'string' ? v : jsonStringify(v));
      } catch { /* storage unavailable */ }
    },
    'set-cookie': (name = '', value = '', path = '/') => {
      if (!name || !/^(?:true|false|yes|no|y|n|ok|on|off|accept|accepted|reject|rejected|allow|deny|necessary|essential|-?\d+|)$/i.test(value)) return;
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${path === 'none' ? '/' : path || '/'}; SameSite=Lax`;
    },
  };

  for (const [rawName, ...args] of list) {
    const name = ALIASES[rawName] || rawName;
    const fn = lib[name];
    if (!fn) continue;
    current = rawName;
    try { fn(...args); } catch { /* one scriptlet failing doesn't stop the rest */ }
  }
}

// ---------- procedural rules (run here, in the preload's own world) ----------
const PROCEDURAL = /:(?:has-text|contains|-abp-contains|-abp-has|upward|remove|remove-attr|remove-class|matches-path|matches-css|matches-css-before|matches-css-after|matches-attr|matches-prop|min-text-length|watch-attr|xpath|style|if|if-not)\(/;
// operators that are plain CSS unless what's inside them is procedural
const NATIVE_UNLESS = new Set(['has', 'not', 'is', 'where']);

// the index of the ) closing the ( at `open`
function closingParen(s, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// "div.ad:has-text(Sponsored):upward(2)" → [{ css: 'div.ad' }, { op: 'has-text', arg: 'Sponsored' }, { op: 'upward', arg: '2' }]
function segments(s) {
  const out = [];
  let css = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { css += s.slice(i, i + 2); i += 2; continue; }
    if (c === '"' || c === "'") { const end = s.indexOf(c, i + 1); const j = end < 0 ? s.length : end + 1; css += s.slice(i, j); i = j; continue; }
    if (c === '[') { const end = s.indexOf(']', i); const j = end < 0 ? s.length : end + 1; css += s.slice(i, j); i = j; continue; }
    if (c === ':') {
      const m = /^:(-?[a-z][a-z-]*)\(/.exec(s.slice(i));
      if (m) {
        const open = i + m[0].length - 1;
        const close = closingParen(s, open);
        if (close < 0) return null;
        const arg = s.slice(open + 1, close);
        // :has-text( and the like, or :has( / :not( holding one; anything else (:nth-child(…)) stays CSS
        if (PROCEDURAL.test(`:${m[1]}(`) || (NATIVE_UNLESS.has(m[1]) && PROCEDURAL.test(arg))) {
          if (css) out.push({ css });
          css = '';
          out.push({ op: m[1], arg });
        } else css += s.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }
    css += c;
    i += 1;
  }
  if (css) out.push({ css });
  return out;
}

const ACTIONS = new Set(['remove', 'style', 'remove-attr', 'remove-class']);
function compileRule(raw) {
  const segs = segments(raw.trim());
  if (!segs || !segs.length) return null;
  let action = null;
  const last = segs[segs.length - 1];
  if (last.op && ACTIONS.has(last.op)) { action = last; segs.pop(); }
  if (!segs.length || segs.some((t) => t.op === 'matches-prop' || t.op === 'others')) return null;
  const watchAttrs = segs.some((t) => t.op === 'watch-attr');
  return { tasks: segs, action, watchAttrs, seen: new WeakSet() };
}

const textMatcher = (arg) => {
  const m = /^\/(.+)\/([imsu]*)$/.exec(arg);
  if (m) { try { return new RegExp(m[1], m[2]); } catch { return /[^\s\S]/; } }
  const text = arg.replace(/^(["'])(.*)\1$/, '$2');
  return { test: (s) => s.includes(text) };
};
const subRules = new Map(); // the selectors inside :has() and :not(), compiled once
const subRule = (arg) => { if (!subRules.has(arg)) subRules.set(arg, compileRule(arg)); return subRules.get(arg); };

// mode: 'root' (from the document), 'within' (inside each node, for :has), 'self' (the nodes themselves, for :not)
function runTasks(tasks, roots, mode) {
  let nodes = roots;
  let first = true;
  for (const t of tasks) {
    if (t.css !== undefined) {
      const sel = t.css.trim();
      if (!sel) { first = false; continue; }
      const out = new Set();
      const comb = /^[>+~]/.test(sel) ? sel[0] : /^\s/.test(t.css) || (first && mode === 'within') ? ' ' : '';
      for (const n of nodes) {
        if (first && mode === 'root' && comb !== '+' && comb !== '~') { document.querySelectorAll(comb === '>' ? `:scope ${sel}` : sel).forEach((m) => out.add(m)); break; }
        if (comb === ' ' || comb === '>') {
          if (n.querySelectorAll) n.querySelectorAll(`:scope ${sel}`).forEach((m) => out.add(m));
        } else if (comb === '+' || comb === '~') {
          const rest = sel.slice(1).trim();
          for (let sib = n.nextElementSibling; sib; sib = sib.nextElementSibling) {
            if (sib.matches(rest)) out.add(sib);
            if (comb === '+') break;
          }
        } else if (n.matches && n.matches(sel)) out.add(n);
      }
      nodes = [...out];
    } else nodes = runOp(t, nodes, first && mode === 'root');
    first = false;
    if (!nodes.length) break;
  }
  return nodes;
}

function runOp({ op, arg }, nodes, fromDocument) {
  switch (op) {
    case 'has-text': case 'contains': case '-abp-contains': {
      const re = textMatcher(arg);
      return nodes.filter((n) => n.textContent && re.test(n.textContent));
    }
    case 'has': case '-abp-has': case 'if': {
      const sub = subRule(arg);
      return sub ? nodes.filter((n) => runTasks(sub.tasks, [n], 'within').length > 0) : [];
    }
    case 'not': case 'if-not': {
      const sub = subRule(arg);
      return sub ? nodes.filter((n) => runTasks(sub.tasks, [n], 'self').length === 0) : nodes;
    }
    case 'is': case 'where': {
      const sub = subRule(arg);
      return sub ? nodes.filter((n) => runTasks(sub.tasks, [n], 'self').length > 0) : [];
    }
    case 'upward': {
      const out = new Set();
      const n = /^\d+$/.test(arg.trim()) ? Number(arg) : 0;
      for (const node of nodes) {
        let up = null;
        if (n) { up = node; for (let k = 0; k < n && up; k += 1) up = up.parentElement; } else { try { up = node.parentElement && node.parentElement.closest(arg); } catch { up = null; } }
        if (up && up !== document.documentElement && up !== document.body) out.add(up);
      }
      return [...out];
    }
    case 'matches-css': case 'matches-css-before': case 'matches-css-after': {
      const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(arg);
      if (!m) return [];
      const re = /^\/.*\/[a-z]*$/.test(m[2]) ? textMatcher(m[2]) : { test: (s) => s === m[2] };
      const pseudo = op === 'matches-css-before' ? '::before' : op === 'matches-css-after' ? '::after' : null;
      return nodes.filter((n) => n.nodeType === 1 && re.test(getComputedStyle(n, pseudo).getPropertyValue(m[1])));
    }
    case 'matches-attr': {
      const m = /^\s*("?)(.+?)\1\s*(?:=\s*("?)(.*)\3)?\s*$/.exec(arg);
      if (!m) return [];
      const name = textMatcher(m[2]);
      const value = m[4] === undefined ? null : textMatcher(m[4]);
      return nodes.filter((n) => n.attributes && [...n.attributes].some((a) => name.test(a.name) && (!value || value.test(a.value))));
    }
    case 'min-text-length': return nodes.filter((n) => (n.textContent || '').length >= Number(arg));
    case 'watch-attr': return nodes;
    case 'matches-path': return textMatcher(arg).test(location.pathname + location.search) ? nodes : [];
    case 'xpath': {
      const out = new Set();
      for (const n of fromDocument ? [document] : nodes) {
        try {
          const r = document.evaluate(arg, n, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < r.snapshotLength; i += 1) if (r.snapshotItem(i).nodeType === 1) out.add(r.snapshotItem(i));
        } catch { /* bad expression */ }
      }
      return [...out];
    }
    default: return [];
  }
}

function act(rule, el) {
  const a = rule.action;
  if (!a) { el.style.setProperty('display', 'none', 'important'); return; }
  if (a.op === 'remove') el.remove();
  else if (a.op === 'remove-attr') el.removeAttribute(a.arg.trim());
  else if (a.op === 'remove-class') el.classList.remove(a.arg.trim());
  else if (a.op === 'style' && !/url\s*\(/i.test(a.arg)) {
    for (const decl of a.arg.split(';')) {
      const m = /^\s*([\w-]+)\s*:\s*(.+?)\s*(?:!important)?\s*$/.exec(decl);
      if (m) el.style.setProperty(m[1], m[2], 'important');
    }
  }
}

function startProcedural(selectors) {
  const rules = selectors.map(compileRule).filter(Boolean);
  if (!rules.length) return;
  let timer = null;
  const apply = () => {
    timer = null;
    for (const rule of rules) {
      let nodes;
      try { nodes = runTasks(rule.tasks, [document], 'root'); } catch { continue; }
      for (const el of nodes) {
        if (el.nodeType !== 1 || rule.seen.has(el)) continue;
        rule.seen.add(el);
        act(rule, el);
      }
    }
  };
  const schedule = () => { if (!timer) timer = setTimeout(apply, 80); };
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true, attributes: rules.some((r) => r.watchAttrs) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  schedule();
}

// ---------- start ----------
if (/^https?:$/.test(location.protocol)) {
  let scriptlets = [];
  try { scriptlets = ipcRenderer.sendSync('ultima:scriptlets') || []; } catch { /* none */ }
  if (scriptlets.length) {
    try {
      if (process.contextIsolated) contextBridge.executeInMainWorld({ func: runScriptlets, args: [scriptlets] });
      else runScriptlets(scriptlets);
    } catch { /* the page runs without them */ }
  }
  ipcRenderer.invoke('ultima:cosmetics').then((c) => {
    if (c && c.css) webFrame.insertCSS(c.css, { cssOrigin: 'user' });
    if (c && c.procedural && c.procedural.length) startProcedural(c.procedural);
  }).catch(() => {});
}
