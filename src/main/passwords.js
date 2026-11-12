// Ultima's passwords in web pages, the main process's side. password-preload.js reports login fields and sign-ins in
// every page and frame; this picks the saved logins for a field's site and has the window draw its menu there
// (renderer/pwfill.js), fills the one picked into that frame alone, and after you sign in, offers to save or update the
// password. The vault itself (the logins, encrypted) is in data.js.
const { ipcMain, webFrameMain } = require('electron');
const { hostOf } = require('./data');
const { baseDomain } = require('./blocker');
const PWGEN = require('../renderer/pwgen');

const OFFER_WAIT = 120000; // a sign-in is offered for saving only this long after it was sent
const USERNAME_WAIT = 300000; // a username from the first step of a two-step sign-in is kept this long

function initPasswords({ data, settings, windowOf, sendTo, broadcast }) {
  // a page's own frame, by the ids the UI hands back; only frames of that page
  const frameIn = (wc, ids) => {
    if (!Array.isArray(ids)) return null;
    const frame = webFrameMain.fromId(Number(ids[0]), Number(ids[1]));
    return frame && !frame.detached && wc.mainFrame.framesInSubtree.includes(frame) ? frame : null;
  };
  // a frame's address for matching logins: its own, or its page's for an about:blank or srcdoc frame written by it
  const frameUrl = (frame) => {
    if (!frame || frame.detached) return '';
    if (/^https?:/i.test(frame.url)) return frame.url;
    return /^https?:\/\//i.test(frame.origin || '') ? `${frame.origin}/` : '';
  };
  // the page itself, or a frame of the same site as the page (not another site's frame embedded in it)
  const isTop = (wc, frame) => frame === wc.mainFrame || Boolean(frame.origin && frame.origin === wc.mainFrame.origin);
  // the logins that may be filled into a frame (data.fillableFor: never another site's, never https ones over http)
  const loginsAt = (wc, frame) => data.fillableFor(frameUrl(frame), { top: isTop(wc, frame) });
  // pages in Ultima's windows (tabs, split panes, glances) only
  const pageOf = (e) => {
    const wc = e.sender;
    return !wc.isDestroyed() && wc.getType() === 'webview' && windowOf(wc) && frameUrl(e.senderFrame) ? wc : null;
  };
  const siteMatches = (loginId, wc, frame) => loginsAt(wc, frame).some((l) => l.id === loginId);
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const usernames = new Map(); // webContents id → { username, site, at } (a two-step sign-in's first step, or the login filled)

  // ---- filling ----
  const fills = new Map(); // token → resolve(ok)
  let fillSeq = 0;
  ipcMain.on('ultima:pw-filled', (_e, d) => { fills.get(d?.token)?.(Boolean(d.ok)); fills.delete(d?.token); });
  // the frame checks its origin is still the one matched here (it may have moved on since)
  const fillFrame = (frame, login) => new Promise((resolve) => {
    fillSeq += 1;
    const token = fillSeq;
    fills.set(token, resolve);
    try { frame.send('ultima:pw-fill', { token, login, origin: frame.origin, accent: settings.data.accent }); } catch { fills.delete(token); resolve(false); return; }
    setTimeout(() => { if (fills.delete(token)) resolve(false); }, 2000);
  });

  // Fills a saved login into a page: into `frame` when given (a field's menu, a right-click), else into every frame of
  // the page that's on the login's site (the key button, the Control Palette). Never into another site's frame.
  async function fillLogin(wc, id, frame = null) {
    const cred = await data.getPassword(id);
    if (!cred || wc.isDestroyed()) return false;
    const frames = (frame ? [frame] : wc.mainFrame.framesInSubtree).filter((f) => !f.detached && siteMatches(id, wc, f));
    let ok = false;
    for (const f of frames) if (await fillFrame(f, cred)) ok = true;
    if (ok) {
      data.markLoginUsed(id);
      // on a two-step sign-in, the password step offers this login first
      if (cred.username) usernames.set(wc.id, { username: cred.username, site: baseDomain(hostOf(frameUrl(frames[0]))), at: Date.now() });
      watch(wc); // forgets it when the page closes
    }
    return ok;
  }

  // ---- the menu at a login field ----
  const menuFor = (wc, frame, extra) => ({ webContentsId: wc.id, frame: [frame.processId, frame.routingId], ...extra });
  ipcMain.on('ultima:pw-field', (e, d) => {
    const wc = pageOf(e);
    if (!wc || settings.data.passwordFieldMenu === false) return;
    const kind = ['username', 'password', 'new-password'].includes(d?.kind) ? d.kind : null;
    const r = d?.rect;
    if (!kind || !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) return;
    const url = frameUrl(e.senderFrame);
    let logins = kind === 'new-password' ? [] : loginsAt(wc, e.senderFrame).map((l) => ({
      id: l.id, name: l.name, username: l.username, site: hostOf(l.uris[0]?.uri.includes('://') ? l.uris[0].uri : `https://${l.uris[0]?.uri}`),
    }));
    // the password step of a two-step sign-in: the login for the username given (or picked) on the step before first
    const step = usernames.get(wc.id);
    let picked = false;
    if (kind === 'password' && d.alone && step && Date.now() - step.at < USERNAME_WAIT && step.site === baseDomain(hostOf(url))) {
      const mine = logins.filter((l) => same(l.username, step.username));
      if (mine.length) { logins = [...mine, ...logins.filter((l) => !mine.includes(l))]; picked = true; }
    }
    const w = windowOf(wc);
    if (!logins.length && kind !== 'new-password') { sendTo(w, 'pw-field', { webContentsId: wc.id, close: true }); return; }
    sendTo(w, 'pw-field', menuFor(wc, e.senderFrame, {
      kind, logins, picked, site: hostOf(url), typed: String(d.typed || '').slice(0, 200),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    }));
  });
  const relay = (from, to, payload) => ipcMain.on(from, (e, value) => {
    const wc = pageOf(e);
    if (wc) sendTo(windowOf(wc), to, { webContentsId: wc.id, ...payload(value) });
  });
  relay('ultima:pw-blur', 'pw-field-blur', () => ({}));
  relay('ultima:pw-typed', 'pw-field-typed', (v) => ({ typed: String(v || '').slice(0, 200) }));
  relay('ultima:pw-key', 'pw-field-key', (v) => ({ key: ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(v) ? v : null }));
  relay('ultima:pw-move', 'pw-field-move', (r) => ({ rect: r && [r.x, r.y, r.width, r.height].every(Number.isFinite) ? r : null }));

  // ---- noticing sign-ins, and offering to save or update them ----
  const pending = new Map(); // webContents id → { sent, url, frame: [pid, rid], at }
  const watched = new WeakSet();
  const offers = new Map(); // token → { kind, url, id? }
  let offerSeq = 0;

  const neverFor = (url) => {
    const host = hostOf(url);
    return (settings.data.passwordsNeverSave || []).some((h) => h === host || h === baseDomain(host));
  };
  // What to offer for a sign-in: save (a new login), update (a known one with a new password), or nothing.
  async function decide({ username, password, current }, url) {
    if (!password || settings.data.offerToSavePasswords === false || neverFor(url)) return null;
    const known = [];
    for (const l of data.passwordsFor(url)) known.push({ ...l, password: (await data.getPassword(l.id))?.password });
    if (current) {
      // a changed password: the login with the old one (or this username)
      const was = known.find((l) => l.password === current && (!username || same(l.username, username)))
        || known.find((l) => username && same(l.username, username));
      if (was) return was.password === password ? null : { kind: 'update', login: was };
      return { kind: 'save' };
    }
    if (known.some((l) => l.password === password && (!username || same(l.username, username)))) return null;
    if (username) {
      const was = known.find((l) => same(l.username, username));
      return was ? { kind: 'update', login: was } : { kind: 'save' };
    }
    const blank = known.filter((l) => !l.username);
    if (blank.length === 1 || known.length === 1) return { kind: 'update', login: blank[0] || known[0] };
    return { kind: 'save' };
  }

  async function offer(wc) {
    const p = pending.get(wc.id);
    pending.delete(wc.id);
    if (!p || Date.now() - p.at > OFFER_WAIT || wc.isDestroyed()) return;
    const sent = { ...p.sent };
    // the username from the step before, on a two-step sign-in
    const step = usernames.get(wc.id);
    if (!sent.username && step && Date.now() - step.at < USERNAME_WAIT && step.site === baseDomain(hostOf(p.url))) sent.username = step.username;
    const d = await decide(sent, p.url);
    if (!d || wc.isDestroyed()) return;
    offerSeq += 1;
    offers.set(offerSeq, { kind: d.kind, url: p.url, id: d.login?.id });
    sendTo(windowOf(wc), 'pw-offer', {
      token: offerSeq, webContentsId: wc.id, kind: d.kind, site: hostOf(p.url), username: d.kind === 'update' && !sent.username ? d.login.username : sent.username,
      password: sent.password, name: d.login?.name || '', folders: data.listPasswordFolders(),
    });
  }

  // After a sign-in, the page loading something else means it worked, unless the same page comes back with its password
  // field (a wrong password, as Chrome reads it).
  function watch(wc) {
    if (watched.has(wc)) return;
    watched.add(wc);
    wc.on('did-frame-navigate', (_e, url, _code, _status, isMainFrame, pid, rid) => {
      const p = pending.get(wc.id);
      if (!p) return;
      if (!isMainFrame) { if (p.frame[0] === pid && p.frame[1] === rid) offer(wc); return; }
      const from = p.url;
      const loaded = () => setTimeout(async () => {
        if (wc.isDestroyed() || pending.get(wc.id) !== p) return;
        let again = false;
        try {
          const a = new URL(from);
          const b = new URL(wc.getURL());
          again = a.origin === b.origin && a.pathname === b.pathname && await wc.executeJavaScript(
            '[...document.querySelectorAll("input[type=password]")].some((p) => p.getClientRects().length > 0)',
          );
        } catch { /* gone, or no answer: it moved on */ }
        if (again) pending.delete(wc.id); else offer(wc);
      }, 400);
      wc.once('did-stop-loading', loaded);
    });
    wc.once('destroyed', () => { pending.delete(wc.id); usernames.delete(wc.id); });
  }

  ipcMain.on('ultima:pw-submit', (e, d) => {
    const wc = pageOf(e);
    if (!wc || typeof d?.password !== 'string' || !d.password) return;
    pending.set(wc.id, {
      sent: { username: String(d.username || '').slice(0, 500), password: d.password.slice(0, 1000), current: String(d.current || '').slice(0, 1000) },
      url: frameUrl(e.senderFrame), frame: [e.senderFrame.processId, e.senderFrame.routingId], at: Date.now(),
    });
    watch(wc);
  });
  ipcMain.on('ultima:pw-username', (e, username) => {
    const wc = pageOf(e);
    if (wc && typeof username === 'string' && username) usernames.set(wc.id, { username: username.slice(0, 500), site: baseDomain(hostOf(frameUrl(e.senderFrame))), at: Date.now() });
  });
  ipcMain.on('ultima:pw-gone', (e) => { const wc = pageOf(e); if (wc && pending.has(wc.id)) offer(wc); });

  // the window's answer to "Save password?" / "Update password?"
  ipcMain.handle('passwords:offer-answer', async (_e, { token, action, username, password, folder } = {}) => {
    const o = offers.get(token);
    offers.delete(token);
    if (!o) return null;
    if (action === 'never') {
      const site = baseDomain(hostOf(o.url));
      settings.data.passwordsNeverSave = [...new Set([...(settings.data.passwordsNeverSave || []), site])];
      settings.save();
      broadcast('settings-changed', { passwordsNeverSave: settings.data.passwordsNeverSave });
      return null;
    }
    if (action !== 'save' || typeof password !== 'string' || !password) return null;
    if (o.kind === 'update' && o.id) return data.saveLogin({ id: o.id, password, ...(typeof username === 'string' ? { username } : {}) });
    return data.saveLogin({ username: String(username || ''), password, uris: [{ uri: new URL(o.url).origin }], folder: folder || null });
  });

  // ---- the window asking ----
  const pageById = (sender, id) => {
    const { webContents } = require('electron');
    const wc = webContents.fromId(Number(id));
    return wc && !wc.isDestroyed() && windowOf(wc) && windowOf(wc) === windowOf(sender) ? wc : null;
  };
  ipcMain.handle('passwords:field-fill', (e, { webContentsId, frame, id }) => {
    const wc = pageById(e.sender, webContentsId);
    const f = wc && frameIn(wc, frame);
    return f ? fillLogin(wc, id, f) : false;
  });
  ipcMain.handle('passwords:field-generated', (e, { webContentsId, frame, password }) => {
    const wc = pageById(e.sender, webContentsId);
    const f = wc && frameIn(wc, frame);
    return f && typeof password === 'string' && password ? fillFrame(f, { generated: password.slice(0, 1000) }) : false;
  });
  ipcMain.handle('passwords:field-menu', (e, { webContentsId, frame, open, selected }) => {
    const wc = pageById(e.sender, webContentsId);
    const f = wc && frameIn(wc, frame);
    try { f?.send('ultima:pw-menu', { open: Boolean(open), selected: Boolean(selected) }); } catch { /* gone */ }
  });
  // the logins for a page and every frame in it (a sign-in form embedded from another site), for the key button
  ipcMain.handle('passwords:for-page', (e, webContentsId) => {
    const wc = pageById(e.sender, webContentsId);
    if (!wc) return [];
    const seen = new Map();
    for (const f of wc.mainFrame.framesInSubtree) if (!f.detached) for (const l of loginsAt(wc, f)) if (!seen.has(l.id)) seen.set(l.id, l);
    return [...seen.values()];
  });

  return { fillLogin, loginsAt, strength: PWGEN.strength };
}

module.exports = { initPasswords };
