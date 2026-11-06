// Warnings for dangerous sites: phishing sites that pose as your bank, your email or a shop to take your password or
// card. Ultima checks the sites you go to against a list of active phishing domains, Phishing.Database
// (github.com/mitchellkrogza/Phishing.Database, MIT License, © Mitchell Krog, Nissar Chababy and contributors),
// downloaded and refreshed while Ultima runs. Everything is checked on this computer: no address you visit is sent
// anywhere.
// The list is kept as 64-bit hashes of its domains, sorted (a few megabytes instead of tens), so a check is a binary
// search. A site is flagged when its host, or a parent domain down to its base domain, is on the list. Some entries
// are whole services where anyone can publish (sites.google.com, an IPFS gateway…): those are never flagged, as that
// would block every page there.
const fs = require('fs');
const path = require('path');
const { hostOf, baseDomain, hostChain } = require('./blocker');

const LIST = {
  id: 'phishing-database',
  name: 'Phishing.Database',
  url: 'https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt',
};
const HOUR = 60 * 60 * 1000;
const REFRESH = 12 * HOUR;
// A test address that always gets the warning, list or no list, to check it works. .invalid names can never exist, so
// nothing is ever reached, even after Continue anyway.
const TEST_HOST = 'phishing-test.ultimabrowser.invalid';

// Big companies' own domains, where any listed host is a shared service (Google Sites, Cloud Storage, Instagram's
// link redirect…) rather than a phishing site of its own
const NEVER_BASES = new Set(`google.com googleapis.com gstatic.com youtube.com microsoft.com microsoftonline.com live.com
  office.com outlook.com apple.com icloud.com amazon.com facebook.com instagram.com whatsapp.com linkedin.com github.com
  x.com twitter.com yahoo.com dropbox.com paypal.com wix.com ipfs.io dweb.link cloudflare-ipfs.com`.split(/\s+/));

// 64 bits of hash from two 32-bit FNV-1a passes with different starting points
function hash64(s) {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (BigInt(a >>> 0) << 32n) | BigInt(b >>> 0);
}

function has(sorted, h) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid];
    if (v === h) return true;
    if (v < h) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// the list's text → its domains' hashes, sorted (the shared services left out). It's a few hundred milliseconds of
// work, so it goes a slice at a time, letting Ultima carry on between slices.
const nextTurn = () => new Promise((r) => { setImmediate(r); });
async function buildHashes(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i % 20000 === 0 && i) await nextTurn();
    const d = lines[i].trim().toLowerCase().replace(/\.$/, '');
    if (!d || d.startsWith('#') || /[\s/]/.test(d) || NEVER_BASES.has(baseDomain(d))) continue;
    out.push(hash64(d));
  }
  await nextTurn();
  return BigUint64Array.from(out).sort();
}

class Safety {
  constructor(dir, fetchList) {
    this.dir = dir;
    this.fetchList = fetchList; // (url, etag) => Promise<{ status, text, etag }>
    this.hashes = new BigUint64Array(0);
    this.meta = {}; // { updated, checked, etag, count, error }
    this.updating = null;
  }

  // the kept list, read without holding Ultima up
  async load() {
    try { this.meta = JSON.parse(await fs.promises.readFile(path.join(this.dir, 'lists.json'), 'utf8')); } catch { /* first run */ }
    try {
      const buf = await fs.promises.readFile(path.join(this.dir, `${LIST.id}.bin`));
      this.hashes = new BigUint64Array(new Uint8Array(buf).buffer); // (copied: a file's buffer needn't be aligned)
    } catch { /* not downloaded yet */ }
  }

  // 'phishing' when the address's site is on the list, 'test' for the test address, otherwise null
  check(url) {
    if (!/^(https?|wss?|ftp):/i.test(url || '')) return null;
    const host = hostOf(url).replace(/\.$/, '');
    if (host === TEST_HOST) return 'test';
    if (!this.hashes.length) return null;
    if (!host || NEVER_BASES.has(baseDomain(host))) return null;
    const base = baseDomain(host);
    for (const h of hostChain(host)) {
      if (has(this.hashes, hash64(h))) return 'phishing';
      if (h === base) break;
    }
    return null;
  }

  // Downloads the list when it's due (or `force`), only if it has changed since; resolves to whether it did
  update(force = false) {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      if (!force && this.meta.checked && Date.now() - this.meta.checked < REFRESH && this.hashes.length) return false;
      try {
        const res = await this.fetchList(LIST.url, this.hashes.length ? this.meta.etag : null);
        this.meta.checked = Date.now();
        if (res.status === 304) { delete this.meta.error; return false; }
        if (res.status !== 200 || res.text.length < 10000) throw new Error(`HTTP ${res.status}`);
        const hashes = await buildHashes(res.text);
        if (hashes.length < 1000) throw new Error('not the list');
        await fs.promises.mkdir(this.dir, { recursive: true });
        const file = path.join(this.dir, `${LIST.id}.bin`);
        await fs.promises.writeFile(`${file}.tmp`, Buffer.from(hashes.buffer));
        await fs.promises.rename(`${file}.tmp`, file);
        this.hashes = hashes;
        Object.assign(this.meta, { updated: Date.now(), etag: res.etag || null, count: hashes.length });
        delete this.meta.error;
        return true;
      } catch (err) {
        this.meta.error = String(err.message || err);
        return false;
      } finally {
        try {
          await fs.promises.mkdir(this.dir, { recursive: true });
          await fs.promises.writeFile(path.join(this.dir, 'lists.json'), JSON.stringify(this.meta));
        } catch { /* kept next time */ }
      }
    })().finally(() => { this.updating = null; });
    return this.updating;
  }

  status() {
    return { ready: this.hashes.length > 0, count: this.hashes.length, updated: this.meta.updated || 0, error: this.meta.error || null, updating: Boolean(this.updating), source: LIST.name };
  }
}

module.exports = { Safety, hash64, buildHashes, TEST_HOST };
