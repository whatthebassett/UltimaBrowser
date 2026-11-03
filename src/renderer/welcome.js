// The first-run welcome: a short film in the installer's world (stars, aurora, the emblem drawing itself in light, a
// synthesized score; welcome-fx.js) that sets Ultima up as it goes: light or dark and an accent color, the first
// space's name, icon and colors, Essentials from popular sites, bringing things over from another browser, and the
// default browser. A miniature Ultima beside the steps shows each choice as it's made; at the end the film dissolves
// into the real window. It runs once, in the first window (settings.onboarded), and again from Settings → About or the
// Control Palette ("Replay welcome").

// ---------- popular sites for Essentials ----------
// [id, name, address, brand color, category, popular?]; the icon is the site's own, with a lettered tile until it loads
const WELCOME_SITES = [
  // work
  ['gmail', 'Gmail', 'https://mail.google.com/', '#ea4335', 'work', 1],
  ['drive', 'Google Drive', 'https://drive.google.com/', '#1fa463', 'work', 1],
  ['docs', 'Google Docs', 'https://docs.google.com/document/', '#4285f4', 'work'],
  ['calendar', 'Google Calendar', 'https://calendar.google.com/', '#4285f4', 'work'],
  ['office', 'Microsoft 365', 'https://www.office.com/', '#d83b01', 'work', 1],
  ['outlook', 'Outlook', 'https://outlook.live.com/mail/', '#0078d4', 'work'],
  ['teams', 'Teams', 'https://teams.microsoft.com/', '#6264a7', 'work'],
  ['onedrive', 'OneDrive', 'https://onedrive.live.com/', '#0078d4', 'work'],
  ['slack', 'Slack', 'https://app.slack.com/client', '#4a154b', 'work', 1],
  ['notion', 'Notion', 'https://www.notion.so/', '#191919', 'work', 1],
  ['zoom', 'Zoom', 'https://app.zoom.us/wc/home', '#2d8cff', 'work'],
  ['figma', 'Figma', 'https://www.figma.com/files/', '#a259ff', 'work'],
  ['github', 'GitHub', 'https://github.com/', '#24292f', 'work', 1],
  ['atlassian', 'Jira & Confluence', 'https://home.atlassian.com/', '#0052cc', 'work'],
  ['trello', 'Trello', 'https://trello.com/', '#0079bf', 'work'],
  ['asana', 'Asana', 'https://app.asana.com/', '#f06a6a', 'work'],
  ['linear', 'Linear', 'https://linear.app/', '#5e6ad2', 'work'],
  ['dropbox', 'Dropbox', 'https://www.dropbox.com/home', '#0061ff', 'work'],
  ['canva', 'Canva', 'https://www.canva.com/', '#00c4cc', 'work'],
  // AI
  ['claude', 'Claude', 'https://claude.ai/', '#d97757', 'ai', 1],
  ['chatgpt', 'ChatGPT', 'https://chatgpt.com/', '#10a37f', 'ai', 1],
  ['gemini', 'Gemini', 'https://gemini.google.com/', '#4285f4', 'ai'],
  ['perplexity', 'Perplexity', 'https://www.perplexity.ai/', '#20808d', 'ai'],
  ['copilot', 'Copilot', 'https://copilot.microsoft.com/', '#0078d4', 'ai'],
  // music
  ['spotify', 'Spotify', 'https://open.spotify.com/', '#1db954', 'music', 1],
  ['applemusic', 'Apple Music', 'https://music.apple.com/', '#fa243c', 'music', 1],
  ['ytmusic', 'YouTube Music', 'https://music.youtube.com/', '#ff0000', 'music'],
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/', '#ff5500', 'music'],
  ['tidal', 'Tidal', 'https://listen.tidal.com/', '#111111', 'music'],
  ['pandora', 'Pandora', 'https://www.pandora.com/', '#3668ff', 'music'],
  // video
  ['youtube', 'YouTube', 'https://www.youtube.com/', '#ff0000', 'video', 1],
  ['netflix', 'Netflix', 'https://www.netflix.com/', '#e50914', 'video', 1],
  ['disney', 'Disney+', 'https://www.disneyplus.com/', '#113ccf', 'video'],
  ['prime', 'Prime Video', 'https://www.primevideo.com/', '#00a8e1', 'video'],
  ['max', 'Max', 'https://play.max.com/', '#002be7', 'video'],
  ['hulu', 'Hulu', 'https://www.hulu.com/', '#1ce783', 'video'],
  ['appletv', 'Apple TV+', 'https://tv.apple.com/', '#111111', 'video'],
  ['twitch', 'Twitch', 'https://www.twitch.tv/', '#9146ff', 'video'],
  // social
  ['whatsapp', 'WhatsApp', 'https://web.whatsapp.com/', '#25d366', 'social', 1],
  ['discord', 'Discord', 'https://discord.com/app', '#5865f2', 'social', 1],
  ['messenger', 'Messenger', 'https://www.messenger.com/', '#0084ff', 'social'],
  ['telegram', 'Telegram', 'https://web.telegram.org/', '#26a5e4', 'social'],
  ['instagram', 'Instagram', 'https://www.instagram.com/', '#e4405f', 'social', 1],
  ['x', 'X', 'https://x.com/', '#111111', 'social'],
  ['facebook', 'Facebook', 'https://www.facebook.com/', '#1877f2', 'social'],
  ['reddit', 'Reddit', 'https://www.reddit.com/', '#ff4500', 'social', 1],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/', '#0a66c2', 'social'],
  ['pinterest', 'Pinterest', 'https://www.pinterest.com/', '#e60023', 'social'],
  ['tiktok', 'TikTok', 'https://www.tiktok.com/', '#111111', 'social'],
  ['threads', 'Threads', 'https://www.threads.net/', '#111111', 'social'],
  ['bluesky', 'Bluesky', 'https://bsky.app/', '#0085ff', 'social'],
  // everyday
  ['google', 'Google', 'https://www.google.com/', '#4285f4', 'everyday'],
  ['maps', 'Google Maps', 'https://www.google.com/maps', '#34a853', 'everyday'],
  ['photos', 'Google Photos', 'https://photos.google.com/', '#fbbc04', 'everyday'],
  ['icloud', 'iCloud', 'https://www.icloud.com/', '#3693f3', 'everyday'],
  ['amazon', 'Amazon', 'https://www.amazon.com/', '#ff9900', 'everyday', 1],
  ['ebay', 'eBay', 'https://www.ebay.com/', '#e53238', 'everyday'],
  ['wikipedia', 'Wikipedia', 'https://www.wikipedia.org/', '#636466', 'everyday'],
  ['duolingo', 'Duolingo', 'https://www.duolingo.com/', '#58cc02', 'everyday'],
].map(([id, name, url, color, cat, popular]) => ({ id, name, url, color, cat, popular: Boolean(popular), host: new URL(url).hostname }));
// Google's products share google.com's icon, and a few sites' icons live on their main domain: these say where to look
const GOOGLE_PRODUCT_ICON = (name) => `https://ssl.gstatic.com/images/branding/product/2x/${name}_2020q4_48dp.png`;
const WELCOME_ICONS = {
  gmail: GOOGLE_PRODUCT_ICON('gmail'), drive: GOOGLE_PRODUCT_ICON('drive'), docs: GOOGLE_PRODUCT_ICON('docs'),
  calendar: GOOGLE_PRODUCT_ICON('calendar'),
  maps: 'https://ssl.gstatic.com/images/branding/product/2x/maps_48dp.png', photos: 'https://ssl.gstatic.com/images/branding/product/2x/photos_48dp.png',
  whatsapp: 'whatsapp.com', telegram: 'telegram.org', teams: 'teams.live.com', outlook: 'outlook.com', onedrive: 'onedrive.com',
  atlassian: 'atlassian.com', zoom: 'zoom.us', max: 'max.com', tidal: 'tidal.com', ytmusic: 'music.youtube.com',
};
const WELCOME_CATS = [['popular', 'Popular'], ['work', 'Work'], ['ai', 'AI'], ['music', 'Music'], ['video', 'Video'], ['social', 'Social'], ['everyday', 'Everyday']];
const WELCOME_MAX = 12;
const welcomeSite = (id) => WELCOME_SITES.find((s) => s.id === id);
const welcomeIcon = (s) => {
  const own = WELCOME_ICONS[s.id];
  return own?.startsWith('https:') ? own : `https://www.google.com/s2/favicons?domain=${own || s.host}&sz=128`;
};

const WC = { el: null, stars: null, score: null, step: 0, picks: [], cat: 'popular', query: '', busy: false, replay: false, sources: null };
const WELCOME_STEPS = ['look', 'space', 'essentials', 'bring'];
const wcSleep = (ms) => new Promise((r) => setTimeout(r, document.body.classList.contains('reduce-motion') ? Math.min(ms, 120) : ms));
const wc$ = (sel) => WC.el.querySelector(sel);

// the emblem's outline, traced from it (as in the installer), drawn in light before the emblem wipes in
const WELCOME_TRACE = [
  'M 604.9 77.8 C 601.8 80.4, 594.6 86.6, 588.9 91.6 C 573.2 105.2, 488.2 178.1, 474.0 190.0 C 400.2 252.1, 344.2 297.2, 274.5 350.9 C 197.6 410.2, 137.5 450.7, 122.5 453.6 C 107.5 456.4, 111.1 442.3, 134.4 406.5 C 137.5 401.7, 139.9 397.6, 139.7 397.4 C 139.1 396.8, 115.7 423.7, 107.3 434.6 C 85.1 463.7, 75.1 488.4, 82.8 495.3 C 95.2 506.5, 146.5 479.3, 228 418.0 C 251.0 400.8, 276.0 381.1, 295.5 365.1 C 313.7 350.0, 314.6 349.4, 307.5 356.9 C 251.3 415.9, 134.4 510.1, 72.5 546.4 C 67 549.6, 60.0 553.7, 57 555.5 C 54.0 557.3, 47.9 560.6, 43.5 562.8 C 39.1 565.0, 34.6 567.5, 33.5 568.4 L 31.5 570.0 33.5 569.3 C 37.9 567.9, 64.7 554.8, 76.2 548.4 C 101.0 534.9, 121.6 521.9, 150 502.1 C 280.1 411.4, 429.4 273.0, 606.9 78.8 C 613.3 71.8, 612.5 71.4, 604.9 77.8',
  'M 111.0 112.8 C 111.0 113.2, 114.0 115.5, 117.6 117.9 C 135.0 129.6, 145.5 143.4, 151.2 162.2 L 153.4 169.5 154.0 281.5 C 154.7 397.7, 155.2 412, 159.2 412 C 161.4 412, 194.5 389.0, 221 369.0 C 227.3 364.2, 236.0 357.8, 240.3 354.7 L 248 349.0 248 230.5 L 248 112 179.5 112 C 141.8 112, 111.0 112.3, 111.0 112.8',
  'M 387 166.1 L 387 220.1 382.2 225.3 C 377.8 230.0, 360.3 249.9, 342.6 270.3 C 338.9 274.6, 336.0 278.3, 336.2 278.5 C 336.4 278.7, 342.6 274.1, 350.0 268.3 C 357.4 262.5, 366.9 255.3, 371 252.2 C 393.8 235.2, 474.9 167.3, 479.8 161.2 C 480.7 160.0, 481.0 153.9, 480.8 136.0 L 480.5 112.5 433.8 112.2 L 387 112.0 387 166.1',
  'M 539.5 179.2 C 538.0 181.0, 516.1 203.7, 491.0 229.5 C 448.6 272.9, 427.2 294.1, 398.2 320.9 L 387 331.2 387.0 356.9 C 387.0 371.0, 386.5 385.4, 386.0 389 C 378.1 438.9, 332.2 464.9, 289.3 443.9 C 280.2 439.5, 279.8 438.9, 283.8 434.4 C 329.4 382.5, 332.6 378.7, 326.9 383.6 C 325.6 384.7, 319.9 389.5, 314.3 394.3 C 308.6 399.1, 299.4 406.9, 293.9 411.8 C 288.3 416.6, 280.5 423.2, 276.5 426.5 C 272.5 429.8, 264.2 436.8, 257.9 442.1 C 243.7 453.9, 156.4 523.9, 145.7 531.9 C 142.5 534.3, 140.2 536.5, 140.4 536.8 C 140.9 537.3, 144.1 535.6, 180.4 515.5 C 196.7 506.6, 205.8 502.1, 206.6 502.6 C 207.2 503.1, 210.9 506.3, 214.8 509.7 C 246.8 537.7, 293.9 552.2, 336.0 546.9 C 405.3 538.3, 463.0 484.3, 476.9 415.2 C 480.4 398.0, 481.0 384.1, 481.0 322.0 L 481 261.5 484.3 256.8 C 486.0 254.2, 500.0 235.2, 515.4 214.5 C 530.7 193.8, 543.0 176.7, 542.7 176.4 C 542.5 176.1, 541.0 177.4, 539.5 179.2',
];

const shouldWelcome = () => !B.settings.onboarded && !B.private;

// ---------- the film ----------
function welcomeHtml() {
  return `<div id="welcome" class="wc phase-black" role="dialog" aria-modal="true" aria-label="Welcome to Ultima">
    <canvas class="wc-stars" aria-hidden="true"></canvas>
    <div class="wc-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="wc-grain" aria-hidden="true"></div>
    <div class="wc-vignette" aria-hidden="true"></div>
    <div class="wc-streak" aria-hidden="true"></div>
    <div class="wc-bloom" aria-hidden="true"></div>
    <div class="wc-drag"></div>
    <div class="wc-top">
      <button class="wc-cbtn" data-wc="mute" title="Sound">${icon('volume', 16)}</button>
      <button class="wc-skip" data-wc="skip">Skip setup</button>
    </div>
    <section class="wc-title">
      <div class="wc-logo" aria-hidden="true">
        <div class="wc-logo-halo"></div>
        <img class="wc-logo-art" src="logo.png" alt="" draggable="false">
        <div class="wc-logo-glint"></div>
        <svg class="wc-logo-trace" viewBox="0 0 640 640">
          <defs>
            <linearGradient id="wc-ls" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#e9d5ff"/><stop offset=".55" stop-color="#a78bfa"/><stop offset="1" stop-color="#67e8f9"/></linearGradient>
            <filter id="wc-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <g fill="none" stroke="url(#wc-ls)" stroke-width="5" stroke-linejoin="round" filter="url(#wc-glow)">
            ${WELCOME_TRACE.map((d, i) => `<path pathLength="100" style="--i:${i}" d="${d}"/>`).join('')}
          </g>
        </svg>
        <div class="wc-logo-spark"></div>
      </div>
      <h1 class="wc-wordmark" aria-label="Ultima">${[...'ULTIMA'].map((c, i) => `<span style="transition-delay:${i * 90}ms">${c}</span>`).join('')}</h1>
      <p class="wc-tagline">${WC.replay ? 'Let’s make it yours, again.' : 'Let’s make it yours.'}</p>
      <div class="wc-begin">
        <button class="wc-primary" data-wc="begin"><span>Get started</span><i class="wc-sheen"></i></button>
        <p class="wc-fine">A minute or so: colors, your first orbit, Essentials and your stuff from other browsers.</p>
      </div>
    </section>
    <main class="wc-stage">
      <div class="wc-panel"></div>
      <div class="wc-preview" aria-hidden="true">${welcomeMockHtml()}</div>
    </main>
    <footer class="wc-nav">
      <button class="wc-ghost" data-wc="back">Back</button>
      <div class="wc-dots">${WELCOME_STEPS.map((s, i) => `<i data-dot="${i}"></i>`).join('')}</div>
      <button class="wc-primary small" data-wc="next"><span>Continue</span><i class="wc-sheen"></i></button>
    </footer>
    <section class="wc-finale">
      <h2>You’re all set.</h2>
      <p class="wc-sub"></p>
      <button class="wc-primary" data-wc="finish"><span>Start browsing</span><i class="wc-sheen"></i></button>
      <p class="wc-fine wc-finale-hint"></p>
    </section>
    <div class="wc-veil" aria-hidden="true"></div>
  </div>`;
}

const wcPhase = (name) => { WC.el.className = `wc phase-${name}${WC.score?.muted ? ' muted' : ''}`; };

async function startWelcome({ replay = false } = {}) {
  if (WC.el) return;
  WC.replay = replay;
  WC.step = 0;
  WC.picks = [];
  WC.cat = 'popular';
  WC.query = '';
  document.body.insertAdjacentHTML('beforeend', welcomeHtml());
  WC.el = $('#welcome');
  document.body.classList.add('welcoming');
  // the window's own buttons (Windows) sit over the film, so they take its colors
  window.ultima.setOverlay({ color: '#00000000', symbolColor: '#e8e4ff' });
  WC.stars = createStarfield(wc$('.wc-stars'));
  WC.score = createScore(Boolean(B.settings.welcomeMuted));
  WC.el.addEventListener('click', onWelcomeClick);
  WC.el.addEventListener('input', onWelcomeInput);
  WC.el.addEventListener('keydown', onWelcomeKey);
  updateMock();
  // act one: the title card
  await wcSleep(250);
  wcPhase('prologue');
  WC.score.start();
  await wcSleep(550);
  wc$('.wc-streak').classList.add('go');
  WC.score.whoosh(1.4);
  await wcSleep(450);
  wc$('.wc-title').classList.add('draw');
  setTimeout(() => WC.score?.chime([659.25, 987.77]), 1350); // with the glint and the spark at the swoosh's tip
  await wcSleep(1350);
  wc$('.wc-wordmark').classList.add('show');
  await wcSleep(850);
  wc$('.wc-tagline').classList.add('show');
  await wcSleep(900);
  if (!WC.el?.classList.contains('phase-prologue')) return; // skipped ahead (Esc, or Skip setup)
  wcPhase('intro');
  setTimeout(() => wc$('[data-wc=begin]')?.focus(), 500);
}

// act two: the steps
async function showStep(i, dir = 1) {
  if (WC.busy || !WC.el) return;
  WC.busy = true;
  const panel = wc$('.wc-panel');
  if (WC.el.classList.contains('phase-steps')) {
    panel.classList.add(dir > 0 ? 'leave' : 'leave-back');
    WC.score.whoosh(0.9);
    await wcSleep(380);
  } else {
    wcPhase('steps');
    WC.stars.mode('warp');
    WC.score.whoosh(1.4);
    WC.score.intensity(0.35);
    setTimeout(() => WC.stars?.mode('idle'), 900);
    await wcSleep(500);
  }
  WC.step = i;
  panel.className = `wc-panel step-${WELCOME_STEPS[i]} ${dir > 0 ? 'enter' : 'enter-back'}`;
  panel.innerHTML = stepHtml(WELCOME_STEPS[i]);
  WC.el.dataset.step = WELCOME_STEPS[i];
  $$('.wc-dots i', WC.el).forEach((d, n) => { d.classList.toggle('on', n === i); d.classList.toggle('done', n < i); });
  wc$('[data-wc=back]').style.visibility = i ? 'visible' : 'hidden';
  wc$('[data-wc=next] span').textContent = i === WELCOME_STEPS.length - 1 ? 'Finish' : 'Continue';
  if (WELCOME_STEPS[i] === 'bring') loadBringStep();
  updateMock();
  setTimeout(() => { WC.busy = false; (panel.querySelector('[autofocus]') || wc$('[data-wc=next]'))?.focus(); }, 450);
}

function stepHtml(step) {
  const kicker = (n, total = WELCOME_STEPS.length) => `<p class="wc-kicker">Step ${n} of ${total}</p>`;
  if (step === 'look') {
    const mode = B.settings.theme || 'dark';
    const card = (v, label, sub) => `<button class="wc-mode ${mode === v ? 'on' : ''}" data-mode="${v}"><span class="wc-mode-art wc-mode-${v}"><i></i><b></b></span><span class="wc-mode-label">${label}</span><span class="wc-mode-sub">${sub}</span></button>`;
    return `${kicker(1)}<h2>Pick your look.</h2><p class="wc-sub">Light or dark, and the color for buttons, highlights and selections. You can change both in Settings → Appearance.</p>
      <div class="wc-modes">${card('dark', 'Dark', 'Easy on the eyes')}${card('light', 'Light', 'Bright and crisp')}${card('system', document.body.classList.contains('mac') ? 'Match macOS' : 'Match Windows', 'Follows your system')}</div>
      <p class="wc-label">Accent color</p>
      <div class="wc-accents">${ACCENTS.map((c) => `<button class="wc-accent ${B.settings.accent === c ? 'on' : ''}" data-accent="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div>`;
  }
  if (step === 'space') {
    const sp = B.spaces[0];
    const current = JSON.stringify(spaceTheme(sp).colors.map((c) => hslToHex(c)));
    return `${kicker(2)}<h2>Make an orbit yours.</h2><p class="wc-sub">Orbits keep different parts of your life apart, each with its own tabs and colors. Here’s your first; make more any time.</p>
      <p class="wc-label">Name</p>
      <input class="wc-input" data-space-name maxlength="24" value="${esc(sp.name)}" spellcheck="false" autofocus>
      <p class="wc-label">Icon</p>
      <div class="wc-icons">${SPACE_ICONS.slice(0, 12).map((ic) => `<button class="wc-icon ${sp.icon === ic ? 'on' : ''}" data-space-icon="${ic}">${ic}</button>`).join('')}</div>
      <p class="wc-label">Colors</p>
      <div class="wc-presets">${THEME_PRESETS.map((p, i) => `<button class="wc-preset ${JSON.stringify(p.colors) === current ? 'on' : ''}" data-preset="${i}" style="--bg:${presetBackground(p)}" title="${esc(p.name)}"><span>${esc(p.name)}</span></button>`).join('')}</div>`;
  }
  if (step === 'essentials') {
    return `${kicker(3)}<h2>Your Essentials.</h2><p class="wc-sub">The sites you live in, always at the top of the sidebar in every orbit. Pick as many as ${WELCOME_MAX}; they’re ready the moment you click them.</p>
      <div class="wc-ess-bar">
        <div class="wc-cats">${WELCOME_CATS.map(([k, label]) => `<button class="wc-cat ${WC.cat === k ? 'on' : ''}" data-cat="${k}">${label}</button>`).join('')}</div>
        <label class="wc-search">${icon('search', 14)}<input data-site-search placeholder="Search sites" spellcheck="false" value="${esc(WC.query)}"></label>
      </div>
      <div class="wc-sites">${sitesHtml()}</div>
      <p class="wc-count">${countText()}</p>`;
  }
  // bring
  return `${kicker(4)}<h2>Bring your things.</h2><p class="wc-sub">Your bookmarks and history from the browser you used before, straight from this computer. Nothing leaves it.</p>
    <div class="wc-browsers"><div class="wc-loading">Looking for your other browsers…</div></div>
    <div class="wc-extras">
      <div class="wc-extra"><span class="wc-extra-icon">${icon('globe', 18)}</span><span class="wc-extra-text"><b>Default browser</b><span data-default-text>Open the links you click in other apps, like email and chat, in Ultima.</span></span><span data-default-ctl><button class="wc-ghost small" data-wc="default">Make default</button></span></div>
      <div class="wc-extra"><span class="wc-extra-icon">${icon('shield', 18)}</span><span class="wc-extra-text"><b>Block ads and trackers</b><span>Faster pages, and nobody following you from site to site.</span></span><label class="wc-toggle"><input type="checkbox" data-block ${B.settings.blockAds !== false ? 'checked' : ''}><span class="wc-switch"></span></label></div>
    </div>`;
}

function sitesHtml() {
  const q = WC.query.trim().toLowerCase();
  const list = q ? WELCOME_SITES.filter((s) => `${s.name} ${s.host}`.toLowerCase().includes(q))
    : WC.cat === 'popular' ? WELCOME_SITES.filter((s) => s.popular) : WELCOME_SITES.filter((s) => s.cat === WC.cat);
  if (!list.length) return `<div class="wc-none">No popular site matches “${esc(WC.query)}”. Add any site as an Essential later: right-click its tab and choose Add to Essentials.</div>`;
  return list.map((s, i) => `<button class="wc-site ${WC.picks.includes(s.id) ? 'on' : ''}" data-site="${s.id}" style="--brand:${s.color}; --i:${i}">
    <span class="wc-site-icon">${siteIconHtml(s)}</span><span class="wc-site-name">${esc(s.name)}</span><span class="wc-site-check">${icon('check', 12)}</span></button>`).join('');
}

function siteIconHtml(s) {
  const letter = `<span class="wc-letter" style="background:${s.color}">${esc(s.name[0])}</span>`;
  return `<img src="${welcomeIcon(s)}" alt="" draggable="false" data-fallback="${esc(letter)}">`;
}
const countText = () => (WC.picks.length ? `${WC.picks.length} of ${WELCOME_MAX} picked` : 'Nothing picked yet. Skip this if you like.');

// ---------- the miniature Ultima ----------
function welcomeMockHtml() {
  return `<div class="wcm">
    <div class="wcm-side">
      <div class="wcm-lights"><i></i><i></i><i></i></div>
      <div class="wcm-url"><i></i></div>
      <div class="wcm-ess"></div>
      <div class="wcm-space"><span class="wcm-space-icon"></span><span class="wcm-space-name"></span></div>
      <div class="wcm-tab on"><i></i><b style="width:70%"></b></div>
      <div class="wcm-tab"><i></i><b style="width:54%"></b></div>
      <div class="wcm-tab"><i></i><b style="width:62%"></b></div>
      <div class="wcm-tab"><i></i><b style="width:44%"></b></div>
      <div class="wcm-chips"></div>
    </div>
    <div class="wcm-page">
      <div class="wcm-hero"><b></b><i></i><i class="short"></i><span class="wcm-btn"></span></div>
      <div class="wcm-cards"><i></i><i></i><i></i></div>
    </div>
  </div>`;
}

function mockMode() {
  const m = B.settings.theme;
  return m === 'light' || (m === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark';
}

function updateMock() {
  if (!WC.el) return;
  const mock = wc$('.wcm');
  const sp = B.spaces[0];
  mock.dataset.mode = mockMode();
  mock.style.setProperty('--m-accent', B.settings.accent || '#8b5cf6');
  mock.style.setProperty('--m-on-accent', inkOn(B.settings.accent || '#8b5cf6'));
  mock.style.setProperty('--m-space', themeBackground({ ...spaceTheme(sp), intensity: Math.max(60, spaceTheme(sp).intensity) }));
  wc$('.wcm-space-icon').textContent = sp.icon;
  wc$('.wcm-space-name').textContent = sp.name;
  wc$('.wcm-chips').innerHTML = B.spaces.slice(0, 4).map((s, i) => `<span class="${i ? '' : 'on'}">${s.icon}</span>`).join('');
  drawMockEssentials();
}

function drawMockEssentials() {
  const box = wc$('.wcm-ess');
  const picks = WC.picks.map(welcomeSite);
  const shown = picks.slice(0, 8);
  box.innerHTML = shown.map((s, i) => `<span class="wcm-pin" data-pin="${s.id}" style="--brand:${s.color}">${i === 7 && picks.length > 8 ? `<em>+${picks.length - 7}</em>` : siteIconHtml(s)}</span>`).join('')
    + (picks.length < 4 ? '<span class="wcm-pin vacant"></span>'.repeat(4 - picks.length) : '');
}

// a picked site's icon flies from its tile into the miniature sidebar
function flyToMock(tile, site) {
  const from = tile.querySelector('.wc-site-icon')?.getBoundingClientRect();
  const slot = wc$(`.wcm-pin[data-pin="${site.id}"]`);
  if (!from || !slot || document.body.classList.contains('reduce-motion')) return;
  const to = slot.getBoundingClientRect();
  const ghost = h(`<span class="wc-flyer" style="--brand:${site.color}">${siteIconHtml(site)}</span>`);
  Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  WC.el.append(ghost);
  slot.style.opacity = '0';
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const s = to.width / from.width;
  ghost.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(${(1 + s) / 2 + 0.25})`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1 },
  ], { duration: 620, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' }).finished.then(() => {
    ghost.remove();
    slot.style.opacity = '';
    slot.animate([{ transform: 'scale(1.35)', filter: 'brightness(1.6)' }, { transform: 'none', filter: 'none' }], { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.3)' });
  });
}

// ---------- choices ----------
function setSpace(change) {
  const sp = B.spaces[0];
  Object.assign(sp, change);
  applySpaceTheme();
  renderSpaces();
  saveSession();
  updateMock();
}

function togglePick(tile) {
  const site = welcomeSite(tile.dataset.site);
  const i = WC.picks.indexOf(site.id);
  if (i >= 0) {
    WC.picks.splice(i, 1);
    tile.classList.remove('on');
    WC.score.tick();
    drawMockEssentials();
  } else {
    if (WC.picks.length >= WELCOME_MAX) { toastInWelcome(`Essentials hold ${WELCOME_MAX} here. Add more later from any tab.`); return; }
    WC.picks.push(site.id);
    tile.classList.add('on');
    WC.score.chime([987.77 * 2 ** ((WC.picks.length % 5) / 12)], 0);
    drawMockEssentials();
    flyToMock(tile, site);
  }
  wc$('.wc-count').textContent = countText();
}

function toastInWelcome(text) {
  const t = h(`<div class="wc-toast">${esc(text)}</div>`);
  WC.el.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}

// the step for bringing things over: the browsers on this computer, and the default browser
async function loadBringStep() {
  const box = wc$('.wc-browsers');
  if (!WC.sources) WC.sources = await window.ultima.detectBrowsers().catch(() => []);
  if (!WC.el || WELCOME_STEPS[WC.step] !== 'bring') return;
  const sources = WC.sources.filter((s) => s.has.bookmarks || s.has.history);
  box.innerHTML = sources.length ? sources.slice(0, 4).map((s, i) => {
    const [letter, bg] = BROWSER_BADGE[s.browser] || ['?', 'var(--wc-violet)'];
    return `<div class="wc-browser" data-src="${i}"><span class="wc-badge" style="background:${bg}">${letter}</span>
      <span class="wc-browser-text"><b>${esc(s.label)}</b><span data-res>${esc(s.profile)}</span></span>
      <button class="wc-ghost small" data-import="${esc(s.id)}">Import</button></div>`;
  }).join('') : '<div class="wc-loading">No other browsers here. Import from a file later in Settings → Import.</div>';
  const d = await window.ultima.defaultBrowserStatus().catch(() => null);
  if (d?.isDefault && WC.el) {
    wc$('[data-default-ctl]').innerHTML = `<span class="wc-ok">${icon('check', 14)} Done</span>`;
    wc$('[data-default-text]').textContent = 'Ultima opens the links you click in other apps.';
  }
}

async function importFrom(btn) {
  const src = WC.sources.find((s) => s.id === btn.dataset.import);
  const row = btn.closest('.wc-browser');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await window.ultima.runImport({ sourceId: src.id, what: { bookmarks: true, history: true, tabs: false, cookies: false }, partition: partitionFor(B.spaces[0].id) });
    $('[data-res]', row).textContent = describeResult(r) || 'Nothing new to bring over';
    btn.outerHTML = `<span class="wc-ok">${icon('check', 14)} Imported</span>`;
    WC.score.chime([783.99, 1174.66]);
  } catch (err) {
    $('[data-res]', row).textContent = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}

async function makeDefaultFromWelcome() {
  const r = await window.ultima.makeDefaultBrowser().catch(() => ({}));
  if (!WC.el) return;
  if (r.isDefault) {
    wc$('[data-default-ctl]').innerHTML = `<span class="wc-ok">${icon('check', 14)} Done</span>`;
    WC.score.chime([783.99, 1174.66]);
  } else if (r.openedSettings) {
    wc$('[data-default-text]').textContent = 'Windows Settings is open: click “Set default” for Ultima Browser there.';
  }
}

// ---------- events ----------
function onWelcomeClick(e) {
  const t = e.target.closest('button');
  if (!t || !WC.el) return;
  const d = t.dataset;
  if (d.wc === 'begin') showStep(0);
  else if (d.wc === 'next') { if (WC.step < WELCOME_STEPS.length - 1) showStep(WC.step + 1); else welcomeFinale(); }
  else if (d.wc === 'back') { if (WC.step > 0) showStep(WC.step - 1, -1); }
  else if (d.wc === 'skip') endWelcome({ skipped: true });
  else if (d.wc === 'finish') endWelcome();
  else if (d.wc === 'mute') {
    WC.score.setMuted(!WC.score.muted);
    WC.el.classList.toggle('muted', WC.score.muted);
    t.innerHTML = icon(WC.score.muted ? 'mute' : 'volume', 16);
    applySettings({ welcomeMuted: WC.score.muted });
  } else if (d.wc === 'default') makeDefaultFromWelcome();
  else if (d.mode) {
    applySettings({ theme: d.mode });
    $$('.wc-mode', WC.el).forEach((b) => b.classList.toggle('on', b === t));
    WC.score.tick();
    updateMock();
  } else if (d.accent) {
    applySettings({ accent: d.accent });
    $$('.wc-accent', WC.el).forEach((b) => b.classList.toggle('on', b === t));
    WC.score.tick();
    updateMock();
  } else if (d.spaceIcon) {
    setSpace({ icon: d.spaceIcon });
    $$('.wc-icon', WC.el).forEach((b) => b.classList.toggle('on', b === t));
    WC.score.tick();
  } else if (d.preset) {
    const p = THEME_PRESETS[Number(d.preset)];
    const theme = spaceTheme(B.spaces[0]);
    setSpace({ color: p.colors[0], theme: { ...theme, colors: p.colors.map(hexToHsl) } });
    $$('.wc-preset', WC.el).forEach((b) => b.classList.toggle('on', b === t));
    WC.score.tick();
  } else if (d.cat) {
    WC.cat = d.cat;
    WC.query = '';
    wc$('[data-site-search]').value = '';
    $$('.wc-cat', WC.el).forEach((b) => b.classList.toggle('on', b === t));
    wc$('.wc-sites').innerHTML = sitesHtml();
  } else if (d.site) togglePick(t);
  else if (d.import) importFrom(t);
}

function onWelcomeInput(e) {
  if (e.target.matches('[data-space-name]')) setSpace({ name: e.target.value.trim() || 'Personal' });
  else if (e.target.matches('[data-site-search]')) {
    WC.query = e.target.value;
    $$('.wc-cat', WC.el).forEach((b) => b.classList.toggle('on', !WC.query && b.dataset.cat === WC.cat));
    wc$('.wc-sites').innerHTML = sitesHtml();
  } else if (e.target.matches('[data-block]')) applySettings({ blockAds: e.target.checked, blockTrackers: e.target.checked });
}

function onWelcomeKey(e) {
  e.stopPropagation(); // Ultima's own keys in the window (the palette, tab keys…) wait until the welcome is done
  if (e.key === 'Escape' && WC.el.classList.contains('phase-prologue')) { e.preventDefault(); skipTitle(); return; }
  if (e.key === 'Enter' && !e.target.matches('button, input[data-site-search]') && WC.el.classList.contains('phase-steps')) {
    e.preventDefault();
    wc$('[data-wc=next]').click();
  }
}

// Esc during the title card: straight to Get started
function skipTitle() {
  const title = wc$('.wc-title');
  title.classList.add('draw', 'instant');
  wc$('.wc-wordmark').classList.add('show');
  wc$('.wc-tagline').classList.add('show');
  wcPhase('intro');
  wc$('[data-wc=begin]').focus();
}

// ---------- act three: the finale ----------
async function welcomeFinale() {
  if (WC.busy) return;
  WC.busy = true;
  wc$('.wc-panel').classList.add('leave');
  wc$('.wc-bloom').classList.add('go');
  WC.stars.mode('burst');
  WC.score.boom();
  WC.score.swell();
  WC.score.intensity(0.6);
  const n = WC.picks.length;
  const sp = B.spaces[0];
  wc$('.wc-finale .wc-sub').textContent = n
    ? `${sp.icon} ${sp.name} is ready, with ${n} Essential${n === 1 ? '' : 's'} waiting at the top of the sidebar.`
    : `${sp.icon} ${sp.name} is ready. Everything else is a click or a keystroke away.`;
  const palette = keyText('palette');
  wc$('.wc-finale-hint').textContent = palette ? `Tip: press ${palette} for the Control Palette, to find anything and open everything.` : '';
  await wcSleep(500);
  wcPhase('finale');
  setTimeout(() => wc$('[data-wc=finish]')?.focus(), 500);
  setTimeout(() => wc$('.wc-bloom')?.classList.remove('go'), 2000);
  WC.busy = false;
}

// The film dissolves into the real window: the picked Essentials are made, and pop into the sidebar as it clears.
async function endWelcome({ skipped = false } = {}) {
  if (!WC.el || WC.ending) return;
  WC.ending = true;
  const made = skipped ? [] : addWelcomeEssentials();
  applySettings({ onboarded: true });
  WC.score.stop(skipped ? 0.6 : 1.4);
  WC.stars.mode('warp');
  wcPhase('out');
  applyTheme(); // the window's own buttons go back to Ultima's colors
  await wcSleep(skipped ? 500 : 900);
  made.forEach((tab, i) => {
    const el = $(`.pin[data-tab="${tab.id}"]`);
    el?.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
      { duration: 520, delay: i * 70, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)', fill: 'backwards' });
  });
  await wcSleep(skipped ? 300 : 700);
  WC.stars.stop();
  WC.el.remove();
  Object.assign(WC, { el: null, stars: null, score: null, ending: false, sources: null });
  document.body.classList.remove('welcoming');
  if (!skipped) toast(keyText('palette') ? `Welcome to Ultima. Press ${keyText('palette')} for the Control Palette` : 'Welcome to Ultima');
}

// shared Essentials for the picked sites, leaving out sites that already are one
function addWelcomeEssentials() {
  const have = new Set(B.tabs.filter((t) => t.zone === 'essential').map((t) => hostname(t.homeUrl || t.url)));
  return WC.picks.map(welcomeSite).filter((s) => !have.has(hostname(s.url))).map((s) => createTab({
    url: s.url, title: s.name, favicon: welcomeIcon(s), zone: 'essential', activate: false, lazy: true,
  }));
}
