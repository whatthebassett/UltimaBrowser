// Automatic tab groups (Settings → Productivity): tabs of the same work app (Google Docs, Jira, Slack…) or the same
// website gather in a folder of their own, named for them, once there are enough of them in a space. They're ordinary
// folders (tabfolders.js) marked `auto` with what they group, so they can be renamed, collapsed or ungrouped like any.
// What you do by hand wins: a renamed folder keeps your name, and a tab you take out stays out (until it moves to
// another app or site). An automatic folder down to one tab goes away.

// Work apps, matched by host and path. `suite` groups them together when you choose to group by suite.
const WORK_APPS = [
  ['google-docs', 'Google Docs', 'blue', 'google', (h, p) => h === 'docs.google.com' && p.startsWith('/document')],
  ['google-sheets', 'Google Sheets', 'green', 'google', (h, p) => h === 'docs.google.com' && p.startsWith('/spreadsheets')],
  ['google-slides', 'Google Slides', 'yellow', 'google', (h, p) => h === 'docs.google.com' && p.startsWith('/presentation')],
  ['google-forms', 'Google Forms', 'purple', 'google', (h, p) => h === 'docs.google.com' && p.startsWith('/forms')],
  ['google-drive', 'Google Drive', 'yellow', 'google', (h) => h === 'drive.google.com'],
  ['gmail', 'Gmail', 'red', 'google', (h) => h === 'mail.google.com'],
  ['google-calendar', 'Google Calendar', 'blue', 'google', (h) => h === 'calendar.google.com'],
  ['google-meet', 'Google Meet', 'green', 'google', (h) => h === 'meet.google.com'],
  ['google-chat', 'Google Chat', 'green', 'google', (h) => h === 'chat.google.com'],
  ['word', 'Word', 'blue', 'microsoft', (h, p, q) => h === 'word.cloud.microsoft' || /\/:w:\//.test(p) || /[?&]app=word\b/i.test(q)],
  ['excel', 'Excel', 'green', 'microsoft', (h, p, q) => h === 'excel.cloud.microsoft' || /\/:x:\//.test(p) || /[?&]app=excel\b/i.test(q)],
  ['powerpoint', 'PowerPoint', 'orange', 'microsoft', (h, p, q) => h === 'powerpoint.cloud.microsoft' || /\/:p:\//.test(p) || /[?&]app=powerpoint\b/i.test(q)],
  ['outlook', 'Outlook', 'blue', 'microsoft', (h) => /^outlook\.(office|office365|live|cloud)\.(com|microsoft)$/.test(h)],
  ['teams', 'Microsoft Teams', 'purple', 'microsoft', (h) => /^teams\.(microsoft|live|cloud)\.(com|microsoft)$/.test(h)],
  ['onedrive', 'OneDrive', 'blue', 'microsoft', (h) => h === 'onedrive.live.com' || h.endsWith('-my.sharepoint.com')],
  ['sharepoint', 'SharePoint', 'cyan', 'microsoft', (h) => h.endsWith('.sharepoint.com')],
  ['microsoft-365', 'Microsoft 365', 'orange', 'microsoft', (h) => ['www.office.com', 'office.com', 'm365.cloud.microsoft', 'www.microsoft365.com'].includes(h)],
  ['confluence', 'Confluence', 'blue', 'atlassian', (h, p) => h.endsWith('.atlassian.net') && p.startsWith('/wiki')],
  ['jira', 'Jira', 'blue', 'atlassian', (h) => h.endsWith('.atlassian.net')],
  ['trello', 'Trello', 'blue', 'atlassian', (h) => h === 'trello.com'],
  ['bitbucket', 'Bitbucket', 'blue', 'atlassian', (h) => h === 'bitbucket.org'],
  ['slack', 'Slack', 'purple', null, (h) => h === 'slack.com' || h.endsWith('.slack.com')],
  ['notion', 'Notion', 'gray', null, (h) => /(^|\.)notion\.(so|site|com)$/.test(h)],
  ['figma', 'Figma', 'purple', null, (h) => h === 'www.figma.com' || h === 'figma.com'],
  ['github', 'GitHub', 'gray', null, (h) => h === 'github.com' || h === 'gist.github.com'],
  ['gitlab', 'GitLab', 'orange', null, (h) => h === 'gitlab.com'],
  ['linear', 'Linear', 'purple', null, (h) => h === 'linear.app'],
  ['asana', 'Asana', 'pink', null, (h) => h === 'app.asana.com'],
  ['monday', 'monday.com', 'red', null, (h) => h.endsWith('.monday.com')],
  ['clickup', 'ClickUp', 'purple', null, (h) => h === 'app.clickup.com'],
  ['miro', 'Miro', 'yellow', null, (h) => h === 'miro.com'],
  ['airtable', 'Airtable', 'cyan', null, (h) => h === 'airtable.com'],
  ['zoom', 'Zoom', 'blue', null, (h) => h === 'zoom.us' || h.endsWith('.zoom.us')],
  ['salesforce', 'Salesforce', 'blue', null, (h) => h.endsWith('.lightning.force.com') || h.endsWith('.my.salesforce.com')],
  ['hubspot', 'HubSpot', 'orange', null, (h) => h === 'app.hubspot.com'],
  ['zendesk', 'Zendesk', 'green', null, (h) => h.endsWith('.zendesk.com')],
  ['dropbox', 'Dropbox', 'blue', null, (h) => h === 'www.dropbox.com' || h === 'dropbox.com'],
  ['loom', 'Loom', 'purple', null, (h) => h === 'www.loom.com'],
].map(([id, name, color, suite, match]) => ({ id, name, color, suite, match }));
const SUITES = { google: ['Google Workspace', 'blue'], microsoft: ['Microsoft 365', 'orange'], atlassian: ['Atlassian', 'blue'] };

// Well-known sites whose names their domain doesn't spell
const SITE_NAMES = {
  youtube: 'YouTube', reddit: 'Reddit', wikipedia: 'Wikipedia', amazon: 'Amazon', x: 'X', twitter: 'X', facebook: 'Facebook',
  instagram: 'Instagram', linkedin: 'LinkedIn', netflix: 'Netflix', twitch: 'Twitch', medium: 'Medium', stackoverflow: 'Stack Overflow',
  stackexchange: 'Stack Exchange', ycombinator: 'Hacker News', nytimes: 'The New York Times', bbc: 'BBC', cnn: 'CNN', google: 'Google',
  apple: 'Apple', microsoft: 'Microsoft', ebay: 'eBay', etsy: 'Etsy', pinterest: 'Pinterest', tiktok: 'TikTok', spotify: 'Spotify',
  discord: 'Discord', chatgpt: 'ChatGPT', openai: 'OpenAI', claude: 'Claude', anthropic: 'Anthropic', imdb: 'IMDb', espn: 'ESPN',
  theverge: 'The Verge', npmjs: 'npm', mozilla: 'Mozilla', wsj: 'The Wall Street Journal', theguardian: 'The Guardian',
  washingtonpost: 'The Washington Post', bloomberg: 'Bloomberg', reuters: 'Reuters', duckduckgo: 'DuckDuckGo', bing: 'Bing',
};
const MULTI_SUFFIX = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/;
// example.com for www.example.com, bbc.co.uk for news.bbc.co.uk
function registrableSite(host) {
  if (/^[\d.]+$/.test(host) || !host.includes('.')) return host;
  const parts = host.split('.');
  return parts.slice(MULTI_SUFFIX.test(host) ? -3 : -2).join('.');
}
// a site's folder color: its brand's, for the well-known ones, else one picked from its name (the same every time)
const BRAND_COLORS = {
  youtube: 'red', netflix: 'red', pinterest: 'red', reddit: 'orange', amazon: 'orange', facebook: 'blue', linkedin: 'blue',
  twitter: 'gray', x: 'gray', tiktok: 'gray', wikipedia: 'gray', instagram: 'pink', spotify: 'green', twitch: 'purple', discord: 'purple',
};
const SITE_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const colorFor = (site) => BRAND_COLORS[site.split('.')[0]] || SITE_COLORS[[...site].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SITE_COLORS.length];

// What a page groups under: { key, name, color, site } (name null for a site that's named from its tabs' titles)
function groupOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname;
  const app = WORK_APPS.find((a) => a.match(h, u.pathname, u.search));
  if (app) {
    if (B.settings.autoGroupWork === 'suite' && app.suite) return { key: `suite:${app.suite}`, name: SUITES[app.suite][0], color: SUITES[app.suite][1], work: true };
    return { key: `app:${app.id}`, name: app.name, color: app.color, work: true, app: app.id };
  }
  if (B.settings.autoGroupSites === false || u.hostname === 'localhost') return null;
  const site = registrableSite(u.hostname);
  const label = site.split('.')[0];
  return { key: `site:${site}`, name: SITE_NAMES[label] || null, color: colorFor(site), site: label };
}

const groupable = (t) => t.zone === 'normal' && !t.private && !t.splitId && !isInternal(t.url);

// ---------- what a work app's tabs are about ----------
// A work app's group is named for what its tabs share: the Jira project of its tickets ("WEB"), the repository of its
// GitHub pages, the Confluence space its pages are in, the words its documents' titles share ("Q4 Roadmap", "Q4 Budget"
// → Q4). With nothing in common, it's the app's name.
// Words in titles that say which app it is (left out), and words too plain to name a group by
const APP_WORDS = new Set(`google docs sheets slides forms drive gmail calendar meet chat microsoft word excel powerpoint
  outlook teams onedrive sharepoint office 365 online web confluence jira atlassian trello bitbucket slack notion figma
  github gitlab linear asana clickup miro airtable zoom salesforce hubspot zendesk dropbox loom monday.com`.split(/\s+/));
const PLAIN_WORDS = new Set(`the a an of for and or to in on with at by from my your our is are be untitled document
  spreadsheet presentation form copy new draft file files page pages home dashboard overview edit view issue issues
  ticket tickets board backlog summary search results inbox mail settings`.split(/\s+/));
// what a page's address says it's part of: a Jira ticket's project, a code site's repository
const repoOf = (u) => { const [owner, repo] = u.pathname.split('/').filter(Boolean); return owner && repo && !owner.startsWith('-') ? repo : null; };
const URL_CONTEXT = {
  jira: (u) => (/\/browse\/([A-Z][A-Z0-9_]+)-\d+/.exec(u.pathname) || /[?&]selectedIssue=([A-Z][A-Z0-9_]+)-\d+/.exec(u.search)
    || /\/projects\/([A-Za-z][A-Za-z0-9_]+)/.exec(u.pathname))?.[1]?.toUpperCase() || null,
  github: repoOf,
  gitlab: repoOf,
  bitbucket: repoOf,
  confluence: (u) => /\/wiki\/spaces\/([^/]+)/.exec(u.pathname)?.[1] || null,
};

// A title's parts ("Roadmap – Engineering – Confluence" → Roadmap, Engineering), without the app's own, a ticket's key
// or a file's extension; none while the page hasn't said its title yet (its address stands in for it)
function titleParts(title) {
  if (!title || /^[a-z][a-z0-9+.-]*:\/\//i.test(title)) return [];
  return title.replace(/\.(docx?|xlsx?|pptx?|pdf|csv|txt|md)\b/gi, '').split(/\s+[-–—|·•]\s+/)
    .map((s) => s.replace(/^\[?[A-Z][A-Z0-9_]+-\d+\]?:?\s*/, '').trim())
    .filter((s) => s && !s.split(/\s+/).every((w) => APP_WORDS.has(w.toLowerCase())));
}
const meaningful = (words) => words.some((w) => (w.length >= 2 || /\d/.test(w)) && !PLAIN_WORDS.has(w.toLowerCase()));

// What every title is about, or null
function sharedTopic(titles) {
  const lists = titles.map(titleParts);
  if (lists.length < 2 || lists.some((p) => !p.length)) return null;
  // a part every title has (a Confluence space, a project), the most general one: titles go from the page to its place
  for (const part of [...lists[0]].reverse()) {
    const lc = part.toLowerCase();
    if (part.length <= 40 && meaningful(part.split(/\s+/)) && lists.every((p) => p.some((x) => x.toLowerCase() === lc))) return part;
  }
  // else the longest run of words every title has (at most four, without plain words at its ends)
  const words = lists.map((p) => p.join(' ').split(/\s+/));
  const lower = words.map((w) => w.map((x) => x.toLowerCase().replace(/[,:;]$/, '')));
  const has = (ws, run) => ws.some((_, i) => run.every((r, j) => ws[i + j] === r));
  let best = null;
  for (let len = Math.min(4, words[0].length); len >= 1 && !best; len -= 1) {
    for (let i = 0; i + len <= words[0].length && !best; i += 1) {
      const run = lower[0].slice(i, i + len);
      if (lower.every((ws) => has(ws, run))) {
        let picked = words[0].slice(i, i + len).map((w) => w.replace(/[,:;]$/, ''));
        while (picked.length && PLAIN_WORDS.has(picked[0].toLowerCase())) picked = picked.slice(1);
        while (picked.length && PLAIN_WORDS.has(picked[picked.length - 1].toLowerCase())) picked = picked.slice(0, -1);
        if (picked.length && meaningful(picked)) best = picked.join(' ');
      }
    }
  }
  return best;
}

function workTopic(g, tabs) {
  const ofUrl = URL_CONTEXT[g.app];
  if (ofUrl) {
    const found = tabs.map((t) => { try { return ofUrl(new URL(t.url)); } catch { return null; } });
    if (found[0] && found.every((x) => x === found[0]) && g.app !== 'confluence') return found[0];
    const topic = sharedTopic(tabs.map((t) => t.title));
    if (topic) return topic;
    return found[0] && found.every((x) => x === found[0]) ? found[0] : null; // a Confluence space's key, when its name isn't in the titles
  }
  return sharedTopic(tabs.map((t) => t.title));
}

// A work app's group is named for what its tabs are about (above). A site's group is named for what its tabs' titles
// share ("Video – YouTube", "Other – YouTube" → YouTube), else its domain ("nytimes" → Nytimes)
function groupName(g, tabs) {
  if (g.work) return workTopic(g, tabs) || g.name;
  if (g.name) return g.name;
  const parts = tabs.map((t) => (t.title || '').split(/\s+[-–—|·•:]\s+/).map((s) => s.trim()).filter(Boolean)).filter((p) => p.length > 1);
  if (parts.length >= 2) {
    for (const pick of [(p) => p[p.length - 1], (p) => p[0]]) {
      const first = pick(parts[0]);
      if (first.length >= 2 && first.length <= 32 && parts.every((p) => pick(p).toLowerCase() === first.toLowerCase())) return first;
    }
  }
  return g.site.charAt(0).toUpperCase() + g.site.slice(1);
}

// a folder's name follows its tabs until you rename it
function refreshGroupName(f) {
  if (!f?.auto || f.name !== f.autoName) return;
  const tabs = folderTabs(f.id);
  const g = tabs[0] && groupOf(tabs[0].url);
  if (!g || g.key !== f.auto) return;
  const name = groupName(g, tabs);
  if (name !== f.name) { f.name = f.autoName = name; renderTabs(); saveSession(); }
}

// A tab arrived on a page (tabs.js): into its app's or site's folder, making one when there are enough of them
function autoGroupTab(tab) {
  if (!B.settings.autoGroup || B.private || !tab || !groupable(tab)) return;
  const g = groupOf(tab.url);
  const cur = folderById(tab.folderId);
  if (cur) {
    if (!cur.auto) return; // a folder you made: never touched
    if (g && cur.auto === g.key) { refreshGroupName(cur); return; }
    removeTabFromFolder(tab); // now on another app or site: out of this one
  }
  if (!g) { tab.autoKey = undefined; return; }
  if (tab.autoKey === g.key && !tab.folderId && !cur) return; // you took it out of this group: it stays out
  const existing = B.folders.find((f) => f.auto === g.key && f.spaceId === tab.spaceId && f.zone === 'normal');
  if (existing) {
    tab.autoKey = g.key;
    addTabToFolder(tab, existing.id);
    refreshGroupName(existing);
    return;
  }
  const same = B.tabs.filter((t) => groupable(t) && !t.folderId && t.spaceId === tab.spaceId && t.autoKey !== g.key && groupOf(t.url)?.key === g.key);
  if (!same.includes(tab)) same.push(tab);
  if (same.length < (Number(B.settings.autoGroupMin) || 2)) return;
  const f = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, spaceId: tab.spaceId, color: g.color, collapsed: false, zone: 'normal', auto: g.key };
  f.name = f.autoName = groupName(g, same);
  B.folders.push(f);
  for (const t of same) { t.folderId = f.id; t.autoKey = g.key; } // they gather where the first of them is
  renderTabs();
  saveSession();
}

// An automatic folder down to one tab goes away (that tab may group again later). Not while tabs are coming back
// (restoring, another window's sidebar): a folder whose other tabs are still on the way isn't down to one.
function tidyAutoGroups() {
  if (holdFolders) return;
  for (const f of B.folders) {
    if (!f.auto) continue;
    const tabs = folderTabs(f.id);
    if (tabs.length === 1) { tabs[0].folderId = undefined; tabs[0].autoKey = undefined; }
  }
}

// Groups the open tabs now (turning the setting on, or the button in Settings)
function autoGroupAll() {
  if (!B.settings.autoGroup) return 0;
  const before = B.folders.length;
  for (const t of [...B.tabs]) if (!t.folderId) autoGroupTab(t);
  return B.folders.length - before;
}
