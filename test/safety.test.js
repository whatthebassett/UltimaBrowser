// Dangerous-site warnings (src/main/safety.js): a site on the phishing list is flagged, with its subdomains; sites that
// aren't, and whole services where anyone can publish (Google Sites, IPFS), never are; and the list kept on disk comes
// back as it was. Runs on a small list of its own, without Ultima or the internet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Safety, buildHashes, TEST_HOST } = require('../src/main/safety');

const LIST = ['phish-test.example', 'login.bank-test.example', 'sites.google.com', 'gateway.ipfs.io', '# a comment', ''];

async function safetyWith(lines) {
  const s = new Safety(fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-safety-')), null);
  s.hashes = await buildHashes(lines.join('\n'));
  return s;
}

test('a listed site is flagged, with its subdomains', async () => {
  const s = await safetyWith(LIST);
  assert.equal(s.check('https://phish-test.example/login'), 'phishing');
  assert.equal(s.check('http://www.phish-test.example/'), 'phishing');
  assert.equal(s.check('https://a.b.phish-test.example/x?y=1'), 'phishing');
  assert.equal(s.check('https://login.bank-test.example/'), 'phishing');
});

test('other sites are not flagged', async () => {
  const s = await safetyWith(LIST);
  assert.equal(s.check('https://bank-test.example/'), null); // only its login. subdomain is listed
  assert.equal(s.check('https://example.com/'), null);
  assert.equal(s.check('https://notphish-test.example/'), null);
  assert.equal(s.check('file:///C:/phish-test.example.html'), null);
  assert.equal(s.check('ultima://newtab'), null);
});

test('shared services are never flagged, even when listed', async () => {
  const s = await safetyWith(LIST);
  assert.equal(s.check('https://sites.google.com/view/anything'), null);
  assert.equal(s.check('https://gateway.ipfs.io/ipfs/x'), null);
});

test('nothing is flagged before the list has loaded', () => {
  const s = new Safety(os.tmpdir(), null);
  assert.equal(s.check('https://phish-test.example/'), null);
});

test('the test address always gets the warning, with or without the list', async () => {
  assert.equal(new Safety(os.tmpdir(), null).check(`http://${TEST_HOST}/`), 'test');
  const s = await safetyWith(LIST);
  assert.equal(s.check(`https://${TEST_HOST}/anything?x=1`), 'test');
  assert.equal(s.check(`https://other.${TEST_HOST}/`), null); // only that one address
});

test('a downloaded list is kept and read back', async () => {
  const lines = [...LIST];
  for (let i = 0; i < 1200; i += 1) lines.push(`filler${i}.example`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-safety-'));
  const fetched = new Safety(dir, async () => ({ status: 200, etag: '"v1"', text: lines.join('\n').padEnd(20000, '\n') }));
  assert.equal(await fetched.update(true), true);
  assert.equal(fetched.status().count, 1202); // the two shared services left out
  // not downloaded again while it's current, and unchanged when the server says so
  const again = new Safety(dir, async (_url, etag) => { assert.equal(etag, '"v1"'); return { status: 304, text: '', etag }; });
  await again.load();
  assert.equal(again.check('https://phish-test.example/'), 'phishing');
  assert.equal(await again.update(true), false);
  assert.equal(again.check('https://phish-test.example/'), 'phishing');
});
