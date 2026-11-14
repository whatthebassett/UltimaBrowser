// Chrome's client hint headers (src/main/clienthints.js): the brand, mobile and platform hints on every secure request,
// matching what pages read; the others only for a site that asked for them, on its own page's requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClientHints, chromiumBrands } = require('../src/main/clienthints');

const PAGE = {
  brands: [{ brand: 'Not?A_Brand', version: '24' }, { brand: 'Chromium', version: '152' }],
  platform: 'Windows',
  architecture: 'x86',
  bitness: '64',
  fullVersionList: [{ brand: 'Not?A_Brand', version: '24.0.0.0' }, { brand: 'Chromium', version: '152.0.7977.169' }],
  platformVersion: '19.0.0',
  model: '',
  wow64: false,
  formFactors: ['Desktop'],
  uaFullVersion: '152.0.7977.169',
};
const pageResponse = (url, acceptCh) => ({ resourceType: 'mainFrame', url, responseHeaders: acceptCh === null ? {} : { 'Accept-CH': [acceptCh] } });

test('the made-up brand is Chromium\'s for the version', () => {
  assert.deepEqual(chromiumBrands('152.0.7977.169'), PAGE.brands);
});

test('every secure request says which browser it is, as Chrome does', () => {
  const ch = new ClientHints({ fullVersion: '152.0.7977.169', platform: 'win32' });
  assert.deepEqual(ch.forRequest('https://www.google.com/search?q=x', 'https://www.google.com/'), {
    'sec-ch-ua': '"Not?A_Brand";v="24", "Chromium";v="152"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });
  assert.ok(ch.forRequest('http://localhost:8080/', ''));
  assert.equal(ch.forRequest('http://example.com/', ''), null);
  assert.equal(ch.forRequest('chrome-extension://abc/page.html', ''), null);
});

test('a site that asks for more gets it on its own page, and nowhere else', () => {
  const ch = new ClientHints({ platform: 'win32', darkMode: () => true });
  ch.setPageValues(PAGE);
  ch.noteResponse(pageResponse('https://www.google.com/', 'Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List, Sec-CH-UA-WoW64, Sec-CH-Prefers-Color-Scheme, Sec-CH-UA-Form-Factors, Sec-CH-Unknown'));
  const own = ch.forRequest('https://www.google.com/complete', 'https://www.google.com/');
  assert.equal(own['sec-ch-ua-platform-version'], '"19.0.0"');
  assert.equal(own['sec-ch-ua-full-version-list'], '"Not?A_Brand";v="24.0.0.0", "Chromium";v="152.0.7977.169"');
  assert.equal(own['sec-ch-ua-wow64'], '?0');
  assert.equal(own['sec-ch-prefers-color-scheme'], '"dark"');
  assert.equal(own['sec-ch-ua-form-factors'], '"Desktop"');
  assert.equal(Object.keys(own).length, 8);
  // embedded on another site, or another site's request: the basic hints only
  assert.equal(Object.keys(ch.forRequest('https://www.google.com/recaptcha', 'https://shop.example/')).length, 3);
  assert.equal(Object.keys(ch.forRequest('https://cdn.example/x.js', 'https://www.google.com/')).length, 3);
  // the top page is only looked up for a site that asked
  let looked = 0;
  ch.forRequest('https://other.example/', () => { looked += 1; return ''; });
  assert.equal(looked, 0);
});

test('an empty Accept-CH takes the request back; responses that aren\'t pages change nothing', () => {
  const ch = new ClientHints({ platform: 'win32' });
  ch.setPageValues(PAGE);
  ch.noteResponse(pageResponse('https://site.example/', 'Sec-CH-UA-Arch'));
  assert.equal(ch.forRequest('https://site.example/a', 'https://site.example/')['sec-ch-ua-arch'], '"x86"');
  ch.noteResponse({ ...pageResponse('https://site.example/', ''), resourceType: 'xhr' });
  assert.ok(ch.forRequest('https://site.example/a', 'https://site.example/')['sec-ch-ua-arch']);
  ch.noteResponse(pageResponse('https://site.example/', ''));
  assert.equal(ch.forRequest('https://site.example/a', 'https://site.example/')['sec-ch-ua-arch'], undefined);
});

test('until a window has read the page values, only the basic hints go out', () => {
  const ch = new ClientHints({ platform: 'darwin' });
  ch.noteResponse(pageResponse('https://site.example/', 'Sec-CH-UA-Arch, Sec-CH-UA-Platform-Version'));
  const h = ch.forRequest('https://site.example/', 'https://site.example/');
  assert.deepEqual(Object.keys(h), ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']);
  assert.equal(h['sec-ch-ua-platform'], '"macOS"');
});
