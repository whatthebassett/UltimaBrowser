// Ultima's own ad and tracker blocker. It reads filter lists in the Adblock Plus / uBlock Origin format (EasyList and
// uBlock Origin's lists for ads, EasyPrivacy and uBlock's privacy list for trackers), downloaded while Ultima runs and
// kept up to date, and answers three questions for main.js:
//   match(url, type, pageUrl, lists)        should this request be blocked? (the filter that blocks it, or null)
//   cosmetics(frameUrl, pageUrl, lists)     the CSS hiding ad boxes on a page, and the procedural rules for its script
//   scriptlets(frameUrl, pageUrl, lists)    the scriptlets to run in the page (see blocker-preload.js)
// Network filters supported: || and | anchors, ^ separators, * wildcards, /regular expressions/, @@ exceptions, and the
// options third-party / first-party, domain=, resource types (script, image, xmlhttprequest…), important, match-case,
// badfilter, and the page-wide exceptions document, elemhide, generichide and specifichide. Filters with options it
// doesn't know (redirect, csp, removeparam…) are left out rather than half-applied, as are popup filters.
// Cosmetic filters: plain element hiding, :style(), procedural operators (:has-text, :upward, :remove…, applied by the
// page's script) and +js() scriptlets; HTML filtering (##^) isn't supported. uBlock's !#if / !#include work.
const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const crypto = require('crypto');

// which list a filter came from, so ads and trackers can be turned off separately
const ADS = 1;
const TRACKERS = 2;

const TYPES = {
  document: 1, subdocument: 2, stylesheet: 4, script: 8, image: 16, font: 32, object: 64,
  xmlhttprequest: 128, ping: 256, media: 512, websocket: 1024, other: 2048,
};
const TYPE_ALIASES = { css: 'stylesheet', frame: 'subdocument', xhr: 'xmlhttprequest', beacon: 'ping', doc: 'document', 'object-subrequest': 'object' };
const ALL_TYPES = 4095;
const DEFAULT_TYPES = ALL_TYPES & ~TYPES.document; // a filter without types blocks everything a page loads
// Electron's resourceType → filter type
const REQUEST_TYPES = {
  mainFrame: TYPES.document, subFrame: TYPES.subdocument, stylesheet: TYPES.stylesheet, script: TYPES.script,
  image: TYPES.image, font: TYPES.font, object: TYPES.object, xhr: TYPES.xmlhttprequest, ping: TYPES.ping,
  cspReport: TYPES.other, media: TYPES.media, webSocket: TYPES.websocket, other: TYPES.other,
};
// page-wide exceptions (@@…$document, $elemhide, $generichide)
const PAGE_ALL = 1; // nothing is blocked or hidden on the page
const PAGE_NO_HIDE = 2; // no element hiding
const PAGE_NO_GENERIC_HIDE = 4; // only the site's own element hiding rules
const PAGE_NO_SPECIFIC_HIDE = 8; // only the generic element hiding rules

// Two-part public suffixes, so third-party checks treat bbc.co.uk and news.bbc.co.uk as one site (the common ones,
// not the whole Public Suffix List)
const MULTI_SUFFIXES = new Set(`co.uk org.uk ac.uk gov.uk me.uk net.uk ltd.uk plc.uk co.jp ne.jp or.jp ac.jp go.jp
  com.au net.au org.au edu.au gov.au co.nz org.nz net.nz co.za org.za com.br net.br org.br com.mx com.ar com.co
  com.cn net.cn org.cn com.hk com.tw com.sg com.my com.ph com.vn com.pk com.sa com.eg com.ng com.tr com.ua co.in
  net.in org.in co.kr or.kr co.il co.id co.th ac.th com.pe com.ve com.ec com.uy com.bd com.np com.qa com.kw
  github.io gitlab.io blogspot.com herokuapp.com appspot.com netlify.app vercel.app pages.dev workers.dev
  cloudfront.net azurewebsites.net firebaseapp.com web.app`.split(/\s+/));

function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}
function baseDomain(host) {
  if (!host || /^[\d.]+$/.test(host) || host.startsWith('[')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const n = MULTI_SUFFIXES.has(parts.slice(-2).join('.')) ? 3 : 2;
  return parts.slice(-n).join('.');
}
// a host and every parent domain: a.b.example.com, b.example.com, example.com, com
function* hostChain(host) {
  for (let h = host; h; ) {
    yield h;
    const dot = h.indexOf('.');
    h = dot < 0 ? '' : h.slice(dot + 1);
  }
}
const inDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
// "example.*" in a domain list: example.com, example.co.uk, www.example.de…
const entityMatch = (host, entity) => {
  const name = entity.slice(0, -2);
  return [...hostChain(host)].some((h) => h.startsWith(`${name}.`) && baseDomain(h) === h);
};

// domain=a.com|~b.a.com (network) or a.com,~b.a.com (element hiding)
function parseDomains(text, sep) {
  const d = { inc: [], exc: [] };
  for (let x of text.toLowerCase().split(sep)) {
    x = x.trim();
    if (!x) continue;
    if (x.startsWith('~')) d.exc.push(x.slice(1)); else d.inc.push(x);
  }
  return d;
}
function domainsMatch(d, host) {
  const hit = (list) => list.some((x) => (x.endsWith('.*') ? entityMatch(host, x) : inDomain(host, x)));
  if (d.exc.length && hit(d.exc)) return false;
  return d.inc.length ? hit(d.inc) : true;
}

// ---------- network filters ----------
// "||ads.example.com^$script" → { pattern, allow, types, party, domains, important, matchCase, page, list }, or
// { badfilter: the filter it turns off }
function parseNetwork(line, list) {
  let text = line;
  const allow = text.startsWith('@@');
  if (allow) text = text.slice(2);
  let opts = '';
  const dollar = text.lastIndexOf('$');
  // options follow the last $ (a $ inside a /regular expression/ is followed by more of it, which isn't an option)
  if (dollar >= 0 && /^[\w~,=.|*-]+$/.test(text.slice(dollar + 1))) {
    opts = text.slice(dollar + 1);
    text = text.slice(0, dollar);
  }
  const f = { pattern: text, allow, types: 0, party: 0, domains: null, important: false, matchCase: false, page: 0, list };
  let notTypes = 0;
  const optList = opts ? opts.split(',') : [];
  if (optList.includes('badfilter')) {
    const rest = optList.filter((o) => o !== 'badfilter');
    return { badfilter: `${allow ? '@@' : ''}${text}${rest.length ? `$${rest.join(',')}` : ''}` };
  }
  for (const opt of optList) {
    const neg = opt.startsWith('~');
    const [rawName, value = ''] = (neg ? opt.slice(1) : opt).split('=');
    const name = TYPE_ALIASES[rawName] || rawName;
    if (name === 'third-party' || name === '3p' || name === 'strict3p') f.party = neg ? 1 : 3;
    else if (name === 'first-party' || name === '1p' || name === 'strict1p') f.party = neg ? 3 : 1;
    else if (name === 'domain' || name === 'from') f.domains = parseDomains(value, '|');
    else if (name === 'important') f.important = true;
    else if (name === 'match-case') f.matchCase = true;
    else if (name === 'all') f.types |= ALL_TYPES;
    else if (name === 'elemhide' || name === 'ehide') { if (!allow) return null; f.page |= PAGE_NO_HIDE; }
    else if (name === 'generichide' || name === 'ghide') { if (!allow) return null; f.page |= PAGE_NO_GENERIC_HIDE; }
    else if (name === 'specifichide' || name === 'shide') { if (!allow) return null; f.page |= PAGE_NO_SPECIFIC_HIDE; }
    else if (name === '_' || /^_+$/.test(name)) continue; // uBlock's no-op option
    else if (name === 'document') {
      if (!allow) return null; // blocking whole pages isn't done; only page-wide exceptions are
      if (!neg) f.page |= PAGE_ALL;
    } else if (TYPES[name]) {
      if (neg) notTypes |= TYPES[name]; else f.types |= TYPES[name];
    } else return null; // popup, redirect, csp, removeparam, badfilter… not supported
  }
  if (!f.types) f.types = f.page ? 0 : DEFAULT_TYPES & ~notTypes;
  // a blocking filter that would match every request everywhere is a mistake (or needs an option we skipped)
  if (!allow && /^[|*]*$/.test(f.pattern) && !f.domains) return null;
  return f;
}

const isRegexFilter = (p) => p.length > 2 && p.startsWith('/') && p.endsWith('/');
// "||host^" with nothing else: the bulk of both lists, matched by host lookup instead of a pattern
const PURE_HOST = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^$/;

function compile(f) {
  if (f.re !== undefined) return f.re;
  const flags = f.matchCase ? '' : 'i';
  try {
    if (isRegexFilter(f.pattern)) f.re = new RegExp(f.pattern.slice(1, -1), flags);
    else {
      let p = f.pattern;
      let start = '';
      let end = '';
      if (p.startsWith('||')) { start = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]*\\.)?'; p = p.slice(2); } else if (p.startsWith('|')) { start = '^'; p = p.slice(1); }
      if (p.endsWith('|')) { end = '$'; p = p.slice(0, -1); }
      const body = p.replace(/[.+?${}()[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\^/g, '(?:[^\\w.%-]|$)').replace(/\|/g, '\\|');
      f.re = new RegExp(start + body + end, flags);
    }
  } catch { f.re = null; } // a regular expression this engine can't read: the filter never matches
  return f.re;
}

// the words a filter's pattern must contain as whole words of the URL; one of them indexes it
function tokensOf(f) {
  if (isRegexFilter(f.pattern)) return [];
  let s = f.pattern.toLowerCase();
  s = s.startsWith('||') ? `^${s.slice(2)}` : s.startsWith('|') ? `^${s.slice(1)}` : `*${s}`;
  s = s.endsWith('|') ? `${s.slice(0, -1)}^` : s.endsWith('^') ? s : `${s}*`;
  return (s.match(/[^a-z0-9%*][a-z0-9%]{2,}(?=[^a-z0-9%*])/g) || []).map((t) => t.slice(1));
}

class NetworkIndex {
  constructor() {
    this.hosts = new Map(); // pure ||host^ filters: host → list bits
    this.hostFilters = new Map(); // ||host^ with options: host → [filter]
    this.tokens = new Map(); // token → [filter]
    this.rest = []; // filters with no usable token, tried for every request
  }

  add(f, token) {
    const host = PURE_HOST.exec(f.pattern.toLowerCase());
    if (host && !f.domains && !f.party && f.types === DEFAULT_TYPES && !f.important && !f.page) {
      this.hosts.set(host[1], (this.hosts.get(host[1]) || 0) | f.list);
    } else if (host) {
      const list = this.hostFilters.get(host[1]);
      if (list) list.push(f); else this.hostFilters.set(host[1], [f]);
      f.host = true;
    } else if (token) {
      const list = this.tokens.get(token);
      if (list) list.push(f); else this.tokens.set(token, [f]);
    } else this.rest.push(f);
  }

  // the first filter (an important one if there is one) matching the request, from the lists in `lists`
  find(req, lists) {
    let found = null;
    const take = (f) => {
      if (!(f.list & lists) || !filterMatches(f, req)) return false;
      if (!found || (f.important && !found.important)) found = f;
      return found.important;
    };
    for (const h of hostChain(req.host)) {
      const bits = this.hosts.get(h);
      if (bits & lists) { found = found || { pattern: `||${h}^`, list: bits & lists }; break; }
    }
    for (const h of hostChain(req.host)) {
      for (const f of this.hostFilters.get(h) || []) if (take(f)) return found;
    }
    for (const t of req.tokens) {
      for (const f of this.tokens.get(t) || []) if (take(f)) return found;
    }
    for (const f of this.rest) if (take(f)) return found;
    return found;
  }
}

function filterMatches(f, req) {
  if (!(f.types & req.type)) return false;
  if (f.party === 3 && !req.thirdParty) return false;
  if (f.party === 1 && req.thirdParty) return false;
  if (f.domains && !domainsMatch(f.domains, req.pageHost)) return false;
  if (f.host) return true; // found by its host already
  const re = compile(f);
  return Boolean(re) && re.test(req.url);
}

// ---------- element hiding, procedural hiding and scriptlets ----------
// Operators plain CSS can't do: the page's script (blocker-preload.js) applies rules using them
const PROCEDURAL_OPS = /:(?:has-text|contains|-abp-contains|-abp-has|upward|remove|remove-attr|remove-class|matches-path|matches-css|matches-css-before|matches-css-after|matches-attr|matches-prop|min-text-length|watch-attr|xpath|others|style)\(/;
const hideRule = (sel) => `${sel}{display:none!important}`;
const importantCss = (css) => css.split(';').map((d) => d.trim()).filter(Boolean)
  .map((d) => (/!important$/i.test(d) ? d : `${d} !important`)).join(';');

// +js(name, arg, 'quoted, arg') → ['name', 'arg', 'quoted, arg'] (uBlock's syntax: \, escapes a comma)
function splitArgs(s) {
  const out = [];
  let i = 0;
  for (;;) {
    while (s[i] === ' ') i += 1;
    const q = s[i];
    let arg = null;
    if (q === '"' || q === "'" || q === '`') {
      for (let j = i + 1; j < s.length; j += 1) {
        if (s[j] === '\\') { j += 1; continue; }
        if (s[j] !== q) continue;
        if (/^\s*(,|$)/.test(s.slice(j + 1))) {
          arg = s.slice(i + 1, j).split(`\\${q}`).join(q);
          i = j + 1;
          while (s[i] === ' ') i += 1;
        }
        break;
      }
    }
    if (arg === null) {
      arg = '';
      for (; i < s.length && s[i] !== ','; i += 1) {
        if (s[i] === '\\' && s[i + 1] === ',') i += 1;
        arg += s[i];
      }
      arg = arg.trim();
    }
    out.push(arg);
    if (s[i] !== ',') return out;
    i += 1;
  }
}

// What a cosmetic rule is: { kind: 'css' | 'proc' | 'js', key } (null when it can't be applied)
//   css   a style sheet rule: hiding (the usual) or :style()
//   proc  a procedural selector for the page's script
//   js    a scriptlet: key is JSON ["name", ...args]; "" (from #@#+js()) means every scriptlet
function classifyCosmetic(selector, trusted) {
  if (selector.startsWith('+js(')) {
    if (!selector.endsWith(')')) return null;
    const args = splitArgs(selector.slice(4, -1));
    if (!args[0]) return { kind: 'js', key: '' };
    const name = args[0].replace(/\.js$/, '');
    if (name.startsWith('trusted-') && !trusted) return null; // only uBlock's own lists may use these
    return { kind: 'js', key: JSON.stringify([name, ...args.slice(1)]) };
  }
  if (selector.startsWith('^') || selector.startsWith('+')) return null; // HTML filtering and the like
  const style = /^(.*?):style\((.*)\)$/.exec(selector);
  if (style && !PROCEDURAL_OPS.test(style[1])) {
    if (/[{}]/.test(style[1]) || /[{}]|url\s*\(|expression\s*\(/i.test(style[2]) || !style[1].trim()) return null;
    return { kind: 'css', key: `${style[1]}{${importantCss(style[2])}}` };
  }
  if (PROCEDURAL_OPS.test(selector)) return /:others\(/.test(selector) ? null : { kind: 'proc', key: selector };
  if (/[{}]/.test(selector)) return null;
  return { kind: 'css', key: hideRule(selector) };
}

// One kind of cosmetic rule, generic and per site, with the lists each came from and the exceptions
class CosmeticStore {
  constructor() {
    this.generic = new Map(); // key → list bits
    this.byHost = new Map(); // host → Map(key → list bits)
    this.unhideByHost = new Map(); // host → Set(key)
    this.unhideAll = new Set(); // keys excepted everywhere
  }

  add(key, list, hosts) {
    if (!hosts) { this.generic.set(key, (this.generic.get(key) || 0) | list); return; }
    for (const h of hosts) {
      let m = this.byHost.get(h);
      if (!m) { m = new Map(); this.byHost.set(h, m); }
      m.set(key, (m.get(key) || 0) | list);
    }
  }

  unhide(key, hosts) {
    if (!hosts) { this.unhideAll.add(key); return; }
    for (const h of hosts) {
      const set = this.unhideByHost.get(h);
      if (set) set.add(key); else this.unhideByHost.set(h, new Set([key]));
    }
  }

  // the site's own rules and the exceptions that apply on `host`
  forHost(host, lists) {
    const own = new Set();
    const unhide = new Set();
    for (const h of hostChain(host)) {
      for (const [k, bits] of this.byHost.get(h) || []) if (bits & lists) own.add(k);
      for (const k of this.unhideByHost.get(h) || []) unhide.add(k);
    }
    return { own: [...own].filter((k) => !unhide.has(k) && !this.unhideAll.has(k)), unhide };
  }

  genericFor(lists, unhide) {
    return [...this.generic].filter(([k, bits]) => bits & lists && !unhide.has(k) && !this.unhideAll.has(k)).map(([k]) => k);
  }
}

// uBlock's !#if conditions, as a Chromium browser that isn't uBlock Origin Lite or a phone
const ENV = new Set(['env_chromium', 'ext_ublock', 'cap_user_stylesheet', 'true']);
function evalCondition(expr) {
  const tokens = expr.match(/\|\||&&|[()!]|[\w.-]+/g) || [];
  let i = 0;
  const not = () => {
    if (tokens[i] === '!') { i += 1; return !not(); }
    if (tokens[i] === '(') { i += 1; const v = or(); i += 1; return v; } // eslint-disable-line no-use-before-define
    return ENV.has(tokens[i++]);
  };
  const and = () => { let v = not(); while (tokens[i] === '&&') { i += 1; v = not() && v; } return v; };
  const or = () => { let v = and(); while (tokens[i] === '||') { i += 1; v = and() || v; } return v; };
  return or();
}

// ---------- the engine ----------
class Engine {
  constructor(sources) {
    this.block = new NetworkIndex();
    this.allow = new NetworkIndex();
    this.pageExceptions = []; // @@ filters with page-wide options
    this.css = new CosmeticStore();
    this.proc = new CosmeticStore();
    this.js = new CosmeticStore();
    this.pageCache = new Map(); // page URL → page-wide exception bits
    this.cssCache = new Map(); // host + flags + lists → { css, procedural }
    this.genericCss = new Map(); // lists → the generic hiding style sheet
    this.rules = 0;
    const network = [];
    const badfilters = new Set();
    for (const source of sources) this.parse(source, network, badfilters);
    const live = network.filter(({ f }) => !badfilters.has(f.raw));
    // index each filter under the rarest of its words, so a request looks at as few filters as possible
    const counts = new Map();
    for (const { tokens } of live) for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
    const common = new Set(['http', 'https', 'www', 'com', 'js', 'net', 'org']);
    for (const { f, tokens } of live) {
      delete f.raw;
      let best = null;
      let bestScore = Infinity;
      for (const t of tokens) {
        const score = (counts.get(t) || 0) * (common.has(t) ? 1000 : 1) - t.length / 100;
        if (score < bestScore) { best = t; bestScore = score; }
      }
      (f.allow ? this.allow : this.block).add(f, best);
      if (f.allow && f.page) this.pageExceptions.push(f);
    }
    this.rules += live.length;
  }

  parse({ text, list, trusted = false }, network, badfilters) {
    const conditions = []; // !#if nesting: { outer, cond }
    let active = true;
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (line.startsWith('!#if ')) { const cond = evalCondition(line.slice(5)); conditions.push({ outer: active, cond }); active = active && cond; continue; }
      if (line.startsWith('!#else')) { const c = conditions[conditions.length - 1]; if (c) active = c.outer && !c.cond; continue; }
      if (line.startsWith('!#endif')) { const c = conditions.pop(); active = c ? c.outer : true; continue; }
      if (!active || !line || line.startsWith('!') || line.startsWith('[')) continue;
      const cos = /^([^#/]*?)(##|#@#|#\?#|#@\?#)(.+)$/.exec(line);
      if (cos) { this.addCosmetic(cos[1], cos[2].includes('@'), cos[3], list, trusted); continue; }
      if (/#[@?$%]*[$%]#/.test(line) || line.includes('$$')) continue; // snippet, CSS injection and HTML filters
      const f = parseNetwork(line, list);
      if (!f) continue;
      if (f.badfilter) { badfilters.add(f.badfilter); continue; }
      f.raw = line;
      network.push({ f, tokens: tokensOf(f) });
    }
  }

  addCosmetic(domainText, isException, selector, list, trusted) {
    const rule = classifyCosmetic(selector.trim(), trusted);
    if (!rule) return;
    const store = this[rule.kind];
    // "a.com,~b.a.com##x" applies on a.com but not b.a.com; "~a.com##x" everywhere but a.com; "*" is everywhere
    const domains = parseDomains(domainText.replace(/>>/g, ''), ',');
    domains.inc = domains.inc.filter((d) => d !== '*' && !d.startsWith('/'));
    domains.exc = domains.exc.filter((d) => !d.startsWith('/'));
    const hosts = domains.inc.length ? domains.inc : null;
    if (isException) { store.unhide(rule.key, hosts); return; }
    if (!hosts && rule.kind === 'proc') return; // procedural rules for every site would cost every page too much
    this.rules += 1;
    store.add(rule.key, list, hosts);
    if (domains.exc.length) store.unhide(rule.key, domains.exc);
  }

  // page-wide exceptions for a page (@@||site^$document and the like)
  pageFlags(pageUrl) {
    if (!pageUrl) return 0;
    let bits = this.pageCache.get(pageUrl);
    if (bits !== undefined) return bits;
    bits = 0;
    const host = hostOf(pageUrl);
    const req = { url: pageUrl, host, pageHost: host, thirdParty: false, type: ALL_TYPES };
    for (const f of this.pageExceptions) if (filterMatchesPage(f, req)) bits |= f.page;
    if (this.pageCache.size > 500) this.pageCache.clear();
    this.pageCache.set(pageUrl, bits);
    return bits;
  }

  // The filter that blocks a request, or null. `lists` is which lists are on (ADS | TRACKERS).
  match(url, resourceType, pageUrl, lists) {
    const type = REQUEST_TYPES[resourceType] || TYPES.other;
    if (type === TYPES.document || !lists || !/^(https?|wss?):/i.test(url)) return null;
    if (this.pageFlags(pageUrl) & PAGE_ALL) return null;
    const host = hostOf(url);
    const pageHost = hostOf(pageUrl) || host;
    const req = {
      url, host, type, pageHost,
      thirdParty: baseDomain(host) !== baseDomain(pageHost),
      tokens: new Set(url.toLowerCase().match(/[a-z0-9%]{2,}/g) || []),
    };
    const hit = this.block.find(req, lists);
    if (!hit || hit.important) return hit;
    return this.allow.find(req, ADS | TRACKERS) ? null : hit;
  }

  // What hides ads in a frame: { css, procedural } — the generic rules plus the site's own, minus its exceptions
  cosmetics(frameUrl, pageUrl, lists) {
    const none = { css: '', procedural: [] };
    const flags = this.pageFlags(pageUrl) | this.pageFlags(frameUrl);
    if (!lists || flags & (PAGE_ALL | PAGE_NO_HIDE)) return none;
    const host = hostOf(frameUrl);
    const key = `${host}|${flags}|${lists}`;
    const cached = this.cssCache.get(key);
    if (cached) return cached;
    const specific = !(flags & PAGE_NO_SPECIFIC_HIDE);
    const { own, unhide } = this.css.forHost(host, lists);
    const parts = specific ? [own.join('\n')] : [];
    if (!(flags & PAGE_NO_GENERIC_HIDE)) {
      if ([...unhide].some((k) => this.css.generic.has(k))) parts.push(this.css.genericFor(lists, unhide).join('\n'));
      else {
        if (!this.genericCss.has(lists)) this.genericCss.set(lists, this.css.genericFor(lists, new Set()).join('\n'));
        parts.push(this.genericCss.get(lists));
      }
    }
    const result = { css: parts.filter(Boolean).join('\n'), procedural: specific ? this.proc.forHost(host, lists).own : [] };
    if (this.cssCache.size > 200) this.cssCache.clear();
    this.cssCache.set(key, result);
    return result;
  }

  // The scriptlets to run in a frame, as [name, ...args] (#@#+js() on the site turns them all off)
  scriptlets(frameUrl, pageUrl, lists) {
    const flags = this.pageFlags(pageUrl) | this.pageFlags(frameUrl);
    if (!lists || flags & (PAGE_ALL | PAGE_NO_HIDE)) return [];
    const { own, unhide } = this.js.forHost(hostOf(frameUrl), lists);
    if (unhide.has('') || this.js.unhideAll.has('')) return [];
    const generic = flags & PAGE_NO_GENERIC_HIDE ? [] : this.js.genericFor(lists, unhide);
    return [...new Set([...(flags & PAGE_NO_SPECIFIC_HIDE ? [] : own), ...generic])].map((k) => JSON.parse(k));
  }
}

function filterMatchesPage(f, req) {
  if (f.domains && !domainsMatch(f.domains, req.host)) return false;
  if (f.host) return [...hostChain(req.host)].some((h) => `||${h}^` === f.pattern.toLowerCase());
  const re = compile(f);
  return Boolean(re) && re.test(req.url);
}

// ---------- lists ----------
// Downloaded at run time (not shipped with Ultima) and refreshed when they're older than they say they last
// ("! Expires: 4 days"). Until the first download, a short built-in list of the biggest ad and tracking networks.
// uBlock Origin's lists are "trusted": their trusted- scriptlets may run, as in uBlock Origin.
const UBO = 'https://ublockorigin.github.io/uAssets/filters';
const LISTS = [
  { id: 'easylist', name: 'EasyList', list: ADS, url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', name: 'EasyPrivacy', list: TRACKERS, url: 'https://easylist.to/easylist/easyprivacy.txt' },
  { id: 'ublock', name: 'uBlock filters', list: ADS, url: `${UBO}/filters.txt`, trusted: true },
  { id: 'ublock-privacy', name: 'uBlock filters – Privacy', list: TRACKERS, url: `${UBO}/privacy.txt`, trusted: true },
  { id: 'ublock-quick-fixes', name: 'uBlock filters – Quick fixes', list: ADS, url: `${UBO}/quick-fixes.txt`, trusted: true },
  { id: 'ublock-unbreak', name: 'uBlock filters – Unbreak', list: ADS | TRACKERS, url: `${UBO}/unbreak.txt`, trusted: true },
];
// Ultima's own rules, for ads the lists miss
const ULTIMA_RULES = `
! WordPress AdRotate ad slots: a box holding only a link through AdRotate's click counter (class gofollow)
##.a-single:has(> a.gofollow)
##.g-single:has(> a.gofollow)
##.a-block:has(> a.gofollow)
! …and the box around such a slot when the slot is all it holds (it may keep its size empty, e.g. an aspect ratio)
##div:has(> .a-single:only-child > a.gofollow)
##div:has(> .g-single:only-child > a.gofollow)
`;
const BUILT_IN = {
  [ADS]: `doubleclick.net googlesyndication.com googleadservices.com adservice.google.com amazon-adsystem.com adnxs.com
    criteo.com criteo.net taboola.com outbrain.com pubmatic.com rubiconproject.com openx.net casalemedia.com adsrvr.org
    advertising.com moatads.com media.net 33across.com sharethrough.com smartadserver.com yieldmo.com adform.net
    teads.tv revcontent.com mgid.com zedo.com popads.net propellerads.com exoclick.com`,
  [TRACKERS]: `google-analytics.com googletagmanager.com analytics.google.com hotjar.com hotjar.io mixpanel.com
    segment.io segment.com scorecardresearch.com quantserve.com chartbeat.com newrelic.com nr-data.net fullstory.com
    mouseflow.com crazyegg.com clarity.ms bat.bing.com connect.facebook.net analytics.tiktok.com ads-twitter.com
    static.ads-twitter.com px.ads.linkedin.com snap.licdn.com amplitude.com heap.io heapanalytics.com kissmetrics.com`,
};
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// The built engine, kept beside the lists (V8's own format): its key's length, its key, then the engine. Read back, its
// parts are plain objects again, so they get their classes back; the per-page caches start empty.
const ENGINE_CACHE = 'engine.bin';
function writeEngineCache(file, key, engine) {
  try {
    const body = v8.serialize({ ...engine, pageCache: null, cssCache: null, genericCss: null });
    const head = Buffer.from(key, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(head.length);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, Buffer.concat([len, head, body]));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* built again next time */ }
}
function readEngineCache(file, key) {
  try {
    const buf = fs.readFileSync(file);
    const n = buf.readUInt32LE(0);
    if (buf.toString('utf8', 4, 4 + n) !== key) return null;
    const e = v8.deserialize(buf.subarray(4 + n));
    Object.setPrototypeOf(e, Engine.prototype);
    for (const k of ['block', 'allow']) Object.setPrototypeOf(e[k], NetworkIndex.prototype);
    for (const k of ['css', 'proc', 'js']) Object.setPrototypeOf(e[k], CosmeticStore.prototype);
    Object.assign(e, { pageCache: new Map(), cssCache: new Map(), genericCss: new Map() });
    return e;
  } catch { return null; } // none yet, from other lists, or unreadable
}

class Blocker {
  constructor(dir, fetchText) {
    this.dir = dir;
    this.fetchText = fetchText; // (url) => Promise<string>
    this.meta = {}; // list id → { updated, version, rules }
    this.engine = null;
    this.updating = null;
    try { this.meta = JSON.parse(fs.readFileSync(path.join(dir, 'lists.json'), 'utf8')); } catch { /* first run */ }
  }

  // builds the engine from the lists on disk (or the built-in one), or takes the copy kept from the last build of the
  // same lists (building takes a few hundred milliseconds, while Ultima starts)
  load() {
    const key = this.cacheKey();
    const kept = readEngineCache(path.join(this.dir, ENGINE_CACHE), key);
    if (kept) {
      this.engine = kept;
      return kept;
    }
    const sources = [];
    for (const l of LISTS) {
      try { sources.push({ text: fs.readFileSync(path.join(this.dir, `${l.id}.txt`), 'utf8'), list: l.list, trusted: l.trusted }); } catch { /* not downloaded yet */ }
    }
    sources.push({ text: ULTIMA_RULES, list: ADS });
    for (const [list, hosts] of Object.entries(BUILT_IN)) {
      if (!sources.some((s) => s.list & Number(list) && s.text !== ULTIMA_RULES)) sources.push({ text: hosts.trim().split(/\s+/).map((h) => `||${h}^`).join('\n'), list: Number(list) });
    }
    this.engine = new Engine(sources);
    // kept for next time, a little later (writing it takes a moment too)
    clearTimeout(this.cacheTimer);
    const engine = this.engine;
    this.cacheTimer = setTimeout(() => writeEngineCache(path.join(this.dir, ENGINE_CACHE), key, engine), 5000);
    this.cacheTimer.unref?.();
    return this.engine;
  }

  // what an engine is built from: this file (Ultima's own rules and how lists are read) and each list as it is on disk
  cacheKey() {
    const parts = [process.versions.v8, crypto.createHash('sha1').update(fs.readFileSync(__filename)).digest('hex')];
    for (const l of LISTS) {
      try { const s = fs.statSync(path.join(this.dir, `${l.id}.txt`)); parts.push(`${l.id}:${s.size}:${s.mtimeMs}`); } catch { parts.push(`${l.id}:-`); }
    }
    return parts.join('|');
  }

  // A list with the lists it includes (uBlock's !#include, from the same folder) put in their place
  async fetchList(url, depth = 0) {
    const text = await this.fetchText(url);
    if (depth >= 2 || !text.includes('!#include ')) return text;
    const parts = [];
    for (const line of text.split(/\r?\n/)) {
      const inc = /^!#include\s+(\S+)/.exec(line);
      if (!inc) { parts.push(line); continue; }
      const sub = new URL(inc[1], url);
      if (sub.origin !== new URL(url).origin) continue;
      try { parts.push(await this.fetchList(sub.href, depth + 1)); } catch { /* left out until the next update */ }
    }
    return parts.join('\n');
  }

  // Downloads lists that are due (all of them when `force`); resolves to whether any changed
  update(force = false) {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      let changed = false;
      for (const l of LISTS) {
        const m = this.meta[l.id];
        if (!force && m?.updated && Date.now() - m.updated < (m.expires || (m.expiresDays || 4) * DAY)) continue;
        try {
          const text = await this.fetchList(l.url);
          if (!/^! Title:/m.test(text) || text.length < 1000) throw new Error('not a filter list');
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(path.join(this.dir, `${l.id}.txt`), text);
          const exp = /^! Expires: (\d+) (day|hour)/m.exec(text);
          const expires = exp ? Number(exp[1]) * (exp[2] === 'hour' ? HOUR : DAY) : 4 * DAY;
          this.meta[l.id] = { updated: Date.now(), version: /^! Version: (\S+)/m.exec(text)?.[1] || '', expires: Math.max(6 * HOUR, Math.min(expires, 14 * DAY)) };
          changed = true;
        } catch (err) {
          this.meta[l.id] = { ...this.meta[l.id], error: String(err.message || err) };
        }
      }
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'lists.json'), JSON.stringify(this.meta));
      if (changed) this.load();
      return changed;
    })().finally(() => { this.updating = null; });
    return this.updating;
  }

  status() {
    return {
      ready: Boolean(this.engine),
      rules: this.engine?.rules || 0,
      updating: Boolean(this.updating),
      lists: LISTS.map((l) => ({ id: l.id, name: l.name, updated: this.meta[l.id]?.updated || 0, error: this.meta[l.id]?.error })),
    };
  }
}

module.exports = { Blocker, Engine, ADS, TRACKERS, hostOf, baseDomain, hostChain, splitArgs };
