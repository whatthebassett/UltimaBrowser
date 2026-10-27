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
    if (B.settings.autoGroupWork === 'suite' && app.suite) return { key: `suite:${app.suite}`, name: SUITES[app.suite][0], color: SUITES[app.suite][1] };
    return { key: `app:${app.id}`, name: app.name, color: app.color };
  }
  if (B.settings.autoGroupSites === false || u.hostname === 'localhost') return null;
  const site = registrableSite(u.hostname);
  const label = site.split('.')[0];
  return { key: `site:${site}`, name: SITE_NAMES[label] || null, color: colorFor(site), site: label };
}

const groupable = (t) => t.zone === 'normal' && !t.private && !t.splitId && !isInternal(t.url);

// A site's group is named for what its tabs' titles share ("Video – YouTube", "Other – YouTube" → YouTube), else its
// domain ("nytimes" → Nytimes)
function groupName(g, tabs) {
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
