// User-Agent Client Hints. Chrome says which browser it is in Sec-CH-UA headers as well as in its user agent; Electron
// sends none, and a Chrome user agent without them is what a bot pretending to be Chrome looks like (Google then keeps
// asking whether you're human). So they're added to requests here, with the values pages read from
// navigator.userAgentData. As in Chrome: secure addresses only; the brand, mobile and platform hints on every request;
// the others only to a site that asked for them (Accept-CH on its page), on its own page's requests.

const PLATFORMS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
// hints sent only when asked for → the field of getHighEntropyValues() they come from
const ASKED = {
  'sec-ch-ua-arch': 'architecture',
  'sec-ch-ua-bitness': 'bitness',
  'sec-ch-ua-full-version': 'uaFullVersion',
  'sec-ch-ua-full-version-list': 'fullVersionList',
  'sec-ch-ua-model': 'model',
  'sec-ch-ua-platform-version': 'platformVersion',
  'sec-ch-ua-wow64': 'wow64',
  'sec-ch-ua-form-factors': 'formFactors',
  'sec-ch-prefers-color-scheme': 'colorScheme',
};
const HIGH_ENTROPY = Object.values(ASKED).filter((k) => k !== 'colorScheme');

// Chromium's made-up brand for a major version (GetGreasedUserAgentBrandVersion), listed before "Chromium" for an even
// version and after it for an odd one; replaced by what pages actually read once a window has loaded (setPageValues)
function chromiumBrands(fullVersion) {
  const major = Number(String(fullVersion).split('.')[0]) || 0;
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const grease = { brand: `Not${chars[major % chars.length]}A${chars[(major + 1) % chars.length]}Brand`, version: ['8', '99', '24'][major % 3] };
  const chromium = { brand: 'Chromium', version: String(major) };
  return major % 2 === 0 ? [grease, chromium] : [chromium, grease];
}

const quote = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;
const brandList = (brands) => brands.map((b) => `${quote(b.brand)};v=${quote(b.version)}`).join(', ');
const originOf = (url) => { try { const u = new URL(url); return u.origin === 'null' ? '' : u.origin; } catch { return ''; } };
// https, wss, and http(s) to this computer: where Chrome sends hints
const secure = (url) => /^(https|wss):\/\//i.test(url) || /^(http|ws):\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(url);

class ClientHints {
  constructor({ fullVersion = process.versions.chrome, platform = process.platform, darkMode = () => false } = {}) {
    this.brands = chromiumBrands(fullVersion);
    this.platform = PLATFORMS[platform] || 'Unknown';
    this.darkMode = darkMode;
    this.high = null; // getHighEntropyValues() as a window read it; until then only the hints every request gets
    this.asked = new Map(); // origin → Set of hint headers its page asked for
  }

  // navigator.userAgentData's values, read in one of Ultima's windows, so headers and pages always agree
  setPageValues(values) {
    if (!values || typeof values !== 'object') return;
    if (Array.isArray(values.brands) && values.brands.length) this.brands = values.brands.map((b) => ({ brand: String(b.brand), version: String(b.version) }));
    if (typeof values.platform === 'string' && values.platform) this.platform = values.platform;
    this.high = values;
  }

  // a page's response: remembers which hints its site asked for (Accept-CH; an empty one takes them back)
  noteResponse(details) {
    if (details.resourceType !== 'mainFrame') return;
    const origin = originOf(details.url);
    if (!origin || !secure(details.url)) return;
    const values = Object.entries(details.responseHeaders || {}).filter(([k]) => k.toLowerCase() === 'accept-ch').flatMap(([, v]) => v);
    if (!values.length) return;
    const hints = new Set(values.join(',').split(',').map((s) => s.trim().toLowerCase()).filter((h) => h in ASKED));
    if (hints.size) this.asked.set(origin, hints);
    else this.asked.delete(origin);
  }

  // headers to add to a request (null for none). `topUrl`: the address of the tab's page, or a function that finds it
  // (only called for a site that asked for more).
  forRequest(url, topUrl) {
    if (!secure(url)) return null;
    const out = {
      'sec-ch-ua': brandList(this.brands),
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': quote(this.platform),
    };
    const origin = this.asked.size ? originOf(url) : '';
    let asked = origin ? this.asked.get(origin) : null;
    if (asked && origin !== originOf((typeof topUrl === 'function' ? topUrl() : topUrl) || url)) asked = null;
    if (asked) {
      for (const h of asked) {
        const v = this.value(ASKED[h]);
        if (v !== null) out[h] = v;
      }
    }
    return out;
  }

  value(field) {
    if (field === 'colorScheme') return quote(this.darkMode() ? 'dark' : 'light');
    const v = this.high?.[field];
    if (v === undefined || v === null) return null;
    if (field === 'fullVersionList') return Array.isArray(v) ? brandList(v) : null;
    if (field === 'wow64') return v ? '?1' : '?0';
    if (field === 'formFactors') return Array.isArray(v) ? v.map(quote).join(', ') : null;
    return quote(v);
  }
}

module.exports = { ClientHints, chromiumBrands, HIGH_ENTROPY };
