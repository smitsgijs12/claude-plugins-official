// End-to-end test: two friends in two separate browsers.
//   node tools/e2e.js --mock                 against a simulated Supabase (no setup needed)
//   node tools/e2e.js --real --code=XXXX     against the Supabase project in config.js
// The real run creates two members named "Test-…", checks everything live, then deletes
// what it created (members, registrations, the photo). Needs Playwright with Chromium.
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const MOCK = !!args.mock;
const CODE = MOCK ? 'TESTCODE' : String(args.code || '');
const SHOTS = args.shots ? path.resolve(String(args.shots)) : null;
if (!MOCK && !CODE) { console.error('Use --mock, or --real --code=<groepscode>'); process.exit(2); }
const PHOTO = path.join(__dirname, 'test-photo.jpg');
const TAG = 'Test-' + Math.random().toString(36).slice(2, 6);

// ---------- static file server ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.sql': 'text/plain' };
// web.down: the site cannot be reached at all (no reception); web.hits: requests per path.
const web = { down: false, hits: {} };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (web.down) { req.socket.destroy(); return; }
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/__hang') return; // a request that never answers (the mock's stalled connection)
      if (p === '/') p = '/index.html';
      web.hits[p] = (web.hits[p] || 0) + 1;
      const f = path.join(ROOT, path.normalize(p));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// ---------- simulated Supabase (mock mode only) ----------
let tick = 0;
const iso = () => new Date(Date.now() + (tick++)).toISOString();
const srv = { groups: { vrienden: { id: 'vrienden', code: 'TESTCODE', name: 'Turflijst' } }, access: new Set(), docs: new Map(), presence: {} };
const pages = [];
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { if (!isObj(a) || !isObj(b)) return b; const r = Object.assign({}, a); for (const k of Object.keys(b)) r[k] = isObj(r[k]) && isObj(b[k]) ? merge(r[k], b[k]) : b[k]; return r; };
const member = (uid, g) => srv.access.has(uid + '|' + g);
const normCode = c => String(c == null ? '' : c).replace(/\s+/g, ' ').trim().toUpperCase();
function broadcast(ev) { pages.forEach(p => { if (!(faults[p.__label] || {}).noLive) p.evaluate(e => window.__rtPush && window.__rtPush(e), ev).catch(() => {}); }); }
// Simulated trouble per browser: faults[label] = { hang, session, anonData, signup, join, holdWrite, lostReply,
//   failWrites, failUpload, hangRead, noLive, delay, maxRows, dropOnFirstPage, holdMerge }.
//   hang: no request ever answers. session: refreshing the login fails (no network), so
//   getSession gives no session and data requests go out as the anon role, like supabase-js does.
//   anonData: the login looks fine but data requests still arrive as anon (reads empty).
//   signup: 'network' | 'disabled' | 'busy'. join: 'network' | 'hang' | 'TL429'.
//   holdWrite: the answer to saving a registration waits until the test calls releaseWrites().
//   lostReply: the registration is saved on the server, but the answer never arrives.
//   failWrites: saving and deleting fail as "no network" (reading still works). failUpload: photo uploads fail
//   the same way. hangRead: reading the documents never answers (the app's time limit ends it).
//   noLive: this browser gets no live events. delay: every answer takes this many ms.
//   holdMerge: like holdWrite, for changes to a document (a proost, a comment).
//   maxRows: the project answers at most this many rows. dropOnFirstPage: right after the first page of
//   a full load, someone deletes a document from that page.
//   (The browser's own offline mode is Playwright's setOffline; the mock follows navigator.onLine.)
const faults = {}, stats = {}, held = [];
const releaseWrites = () => held.splice(0).forEach(go => go());
const NETQ = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0 };
function handle(raw, label) {
  const q = JSON.parse(raw), F = faults[label] || {};
  const write = (q.kind === 'query' && q.d.table === 'docs' && q.d.op !== 'select') || (q.kind === 'rpc' && q.name === 'doc_merge');
  if (write && F.failWrites) return NETQ;
  if (q.kind === 'upload' && F.failUpload) return { error: { name: 'StorageUnknownError', message: 'Failed to fetch' } };
  if (q.kind === 'query' && q.d.table === 'docs' && q.d.op === 'select' && F.hangRead) return { hang: true };
  const r = handleNow(raw, label);
  const entryWrite = q.kind === 'query' && q.d.table === 'docs' && q.d.op === 'upsert' && /^entries\//.test(q.d.row.path);
  if (entryWrite && F.lostReply) return { hang: true };
  if (entryWrite && F.holdWrite) return new Promise(res => held.push(() => res(r)));
  if (q.kind === 'rpc' && q.name === 'doc_merge' && F.holdMerge) return new Promise(res => held.push(() => res(r)));
  if (F.delay) return new Promise(res => setTimeout(() => res(r), F.delay));
  return r;
}
const pick = (rows, cols) => !cols || cols === '*' ? rows : rows.map(r => Object.fromEntries(cols.split(',').map(c => [c, r[c]])));
const NET = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
function handleNow(raw, label) {
  const q = JSON.parse(raw), F = faults[label] || {}, st = stats[label] || (stats[label] = { calls: 0, signups: 0, rows: 0, uploads: 0 });
  st.calls++;
  if (F.hang) return { hang: true };
  if (q.kind === 'auth') {
    if (q.op === 'session') return F.session ? { error: NET } : {};
    st.signups++;
    if (F.signup === 'network') return { error: NET };
    if (F.signup === 'disabled') return { error: { name: 'AuthApiError', status: 422, code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' } };
    if (F.signup === 'busy') return { error: { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' } };
    return { id: 'u-' + Math.random().toString(36).slice(2, 10) };
  }
  const uid = F.session || F.anonData ? null : q.uid;
  if (q.kind === 'rpc' && q.name === 'join_group') {
    if (F.join === 'hang') return { hang: true };
    if (F.join === 'network') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0 };
    if (F.join === 'TL429') return { data: null, error: { code: 'TL429', message: 'too_many_attempts', details: 'retry_after_seconds=540', hint: 'Te vaak geprobeerd, wacht even.' }, status: 400 };
    if (!uid) return { data: null, error: { code: '42501', message: 'not signed in' }, status: 401 };
    const c = normCode(q.params.p_code);
    const g = c && Object.values(srv.groups).find(x => normCode(x.code) === c);
    if (!g) return { data: null, error: null, status: 200 };
    srv.access.add(uid + '|' + g.id); return { data: g.id, error: null, status: 200 };
  }
  if (q.kind === 'rpc' && q.name === 'doc_merge') {
    const { p_grp, p_path, p_patch } = q.params;
    if (!member(uid, p_grp)) return { data: null, error: { code: '42501', message: 'rls' } };
    const row = srv.docs.get(p_grp + '|' + p_path);
    if (!row) return { data: null, error: { code: 'P0002', message: 'document does not exist' } };
    row.data = merge(row.data, p_patch); row.updated_at = iso();
    broadcast({ eventType: 'UPDATE', new: row });
    return { data: { data: row.data, updated_at: row.updated_at }, error: null };
  }
  if (q.kind === 'upload') { st.uploads++; return {}; }
  if (q.kind === 'track') {
    const room = srv.presence[q.room] || (srv.presence[q.room] = {}); room[q.key] = [q.meta];
    broadcast({ type: 'presence', room: q.room, state: room }); return { data: 'ok' };
  }
  const d = q.d, f = Object.fromEntries(d.filters);
  if (d.table === 'group_access') return { data: [...srv.access].map(s => s.split('|')).filter(([u]) => u === f.user_id).map(([, g]) => ({ grp: g })).slice(0, d.limit || 1000), error: null };
  if (d.table === 'groups') {
    const list = Object.values(srv.groups).filter(g => member(uid, g.id) && (!f.id || g.id === f.id));
    return { data: d.maybe || d.single ? (list[0] || null) : list.slice(0, d.limit || 1000), error: null };
  }
  if (d.table === 'docs') {
    if (!member(uid, f.grp || (d.row && d.row.grp))) return d.op === 'select' ? { data: [], error: null } : { data: null, error: { code: '42501', message: 'rls' } };
    if (d.op === 'select') {
      let rows = [...srv.docs.values()].filter(r => r.grp === f.grp && (!f.path || r.path === f.path));
      for (const [c, op, v] of d.cmp) rows = rows.filter(r => op === 'in' ? v.includes(r[c]) : op === 'gt' ? r[c] > v : r[c] >= v);
      const by = d.orders.length ? d.orders : ['path'];
      rows.sort((a, b) => { for (const c of by) { if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; } return 0; });
      const [a, z] = d.range || [0, (d.limit || 1000) - 1];
      rows = rows.slice(a, Math.min(z + 1, a + (F.maxRows || 1e9)));
      st.rows += rows.length;
      if (F.dropOnFirstPage && !F.dropped && !d.cmp.length && rows.length > 10) {
        const gone = rows.find(r => r.path.startsWith('probe/'));
        if (gone) { F.dropped = gone.path; srv.docs.delete(gone.grp + '|' + gone.path); broadcast({ eventType: 'DELETE', old: { grp: gone.grp, path: gone.path } }); }
      }
      return { data: pick(rows, d.cols), error: null };
    }
    if (d.op === 'upsert') {
      const r = d.row, k = r.grp + '|' + r.path, existed = srv.docs.has(k);
      if (existed && d.ignoreDup) return { data: [], error: null };
      const row = { grp: r.grp, path: r.path, collection: r.collection, data: r.data, updated_at: iso() };
      srv.docs.set(k, row); broadcast({ eventType: existed ? 'UPDATE' : 'INSERT', new: row });
      return { data: d.single ? row : pick([row], d.cols), error: null };
    }
    // With row level security on, a live DELETE event carries only the key (grp, path).
    if (d.op === 'delete') { const k = f.grp + '|' + f.path, old = srv.docs.get(k); srv.docs.delete(k); if (old) broadcast({ eventType: 'DELETE', old: { grp: old.grp, path: old.path } }); return { data: old ? pick([old], d.cols) : [], error: null }; }
  }
  return { data: null, error: { code: 'x', message: 'unhandled' } };
}

// ---------- test ----------
(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const errors = [], results = [];
  let failed = 0;
  const check = (name, ok, detail) => { results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : '')); if (!ok) failed++; };
  // opts: device (Playwright device, e.g. devices['iPhone 13'], emulated in Chromium), sw (allow the
  // service worker), ctx (more context options, e.g. timezoneId), clock (clockAt: its start time)
  // (fake timers, so a 15 s timeout takes no real time), key() (the supabaseKey config.js serves),
  // init (script that runs before the page, e.g. to pretend to be a home-screen app).
  async function friend(label, opts) {
    opts = opts || {};
    // Service workers only where a check asks for one (sw: true): the mock answers through routes.
    const ctx = await browser.newContext(Object.assign(opts.device ? Object.assign({}, opts.device) : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
      { serviceWorkers: opts.sw ? 'allow' : 'block' }, opts.ctx || {}));
    if (opts.clock) await ctx.clock.install(opts.clockAt ? { time: opts.clockAt } : undefined);
    if (opts.init) await ctx.addInitScript(opts.init);
    if (MOCK) {
      await ctx.exposeFunction('__srv', raw => Promise.resolve(handle(raw, label)).then(r => JSON.stringify(r)));
      await ctx.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8') }));
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.TURFLIJST_CONFIG={supabaseUrl:"https://mock.supabase.co",supabaseKey:' + JSON.stringify(opts.key ? opts.key() : 'pk_test') + '};' }));
      await ctx.route('**/mockphoto/**', r => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(PHOTO) }));
      await ctx.route('**/__hang', () => {}); // never answered, and holds no connection
    }
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(label + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|ERR_NAME|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
    p.__label = label;
    pages.push(p);
    return p;
  }
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 8000 }).then(() => true, () => false);
  const poll = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  const authUid = p => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('turflijst-auth')).user.id; } catch (e) { return null; } });
  const memberRow = n => [...srv.docs.values()].find(r => r.path.startsWith('members/') && r.data.name === n);
  const memberUid = n => { const r = memberRow(n); return r && r.data.uid; };
  const A = await friend('A'), B = await friend('B');
  let C = null, D = null, canPhotoAll = false;
  const nameA = TAG + '-A', nameB = TAG + '-B';
  let invite = '';
  try {
    await A.goto(base + '#join=' + encodeURIComponent(CODE));
    check('A joins via (old style) invite link', await until(A, () => document.getElementById('gate').hidden && !!document.getElementById('who-add-name')));
    check('A address bar keeps the code as ?g=', await A.evaluate(c => location.hash === '' && location.search === '?g=' + c, encodeURIComponent(normCode(CODE))));
    await until(A, () => !document.getElementById('who-card').hidden);
    await A.fill('#who-add-name', nameA); await A.click('#who-add-btn');
    check('A added and picked own name', await until(A, n => document.getElementById('who-card').hidden && document.body.innerText.includes(n), nameA));
    await A.click('#tab-groep');
    await A.fill('#add-member-name', nameB); await A.click('#add-member-btn');
    check('A added second name', await until(A, n => document.getElementById('members').innerText.includes(n), nameB));
    invite = await A.inputValue('#invite-link');
    check('Invite link shown with ?g=CODE', invite === base + '?g=' + encodeURIComponent(normCode(CODE)), invite);

    await B.goto(base);
    check('B without link sees code screen', await until(B, () => !document.getElementById('gate-code').hidden));
    await B.fill('#gate-input', 'FOUT-' + TAG); await B.click('#gate-submit');
    check('B wrong code is refused', await until(B, () => { const e = document.getElementById('gate-error'); return !e.hidden && /kennen we niet/.test(e.textContent); }));
    await B.fill('#gate-input', '  ' + CODE.toLowerCase() + ' '); await B.click('#gate-submit');
    check('B joins with code typed in lower case with spaces', await until(B, () => document.getElementById('gate').hidden));
    check('B address bar gets ?g=CODE', await B.evaluate(c => location.search === '?g=' + c, encodeURIComponent(normCode(CODE))));
    await until(B, n => [...document.querySelectorAll('#who-chips button')].some(b => b.textContent.includes(n)), nameB, 10000);
    await B.click(`#who-chips button:has-text("${nameB}")`);
    check('Tap on a name right after the names appear is ignored', await B.evaluate(() => !document.getElementById('who-card').hidden));
    await B.waitForTimeout(650);
    await B.click(`#who-chips button:has-text("${nameB}")`);
    check('B picks own name, with a toast that can undo it', await until(B, n => document.getElementById('who-card').hidden && /Je bent nu/.test(document.getElementById('toast-text').textContent) && !document.getElementById('toast-undo').hidden, nameB));
    check('A sees B claimed the name live', await until(A, n => [...document.querySelectorAll('.member')].some(r => r.innerText.includes(n) && r.innerText.includes('ander toestel')), nameB, 10000));

    for (let i = 0; i < 3; i++) await B.click('[aria-label="Biertjes plus één"]');
    const canPhoto = canPhotoAll = await B.evaluate(() => !document.getElementById('photo-btn').hidden);
    check('Photo button available', canPhoto);
    if (canPhoto) { await B.setInputFiles('#photo-input', PHOTO); await until(B, () => !document.getElementById('photo-prev').hidden); }
    await B.fill('#caption', 'e2e ' + TAG);
    await B.click('#btn-reg');
    check('B registration saved', await until(B, () => /Geregistreerd voor/.test(document.getElementById('toast-text').textContent), null, 15000));

    await A.click('#tab-feed');
    check('A sees B post live', await until(A, t => [...document.querySelectorAll('.post')].some(p => p.innerText.includes(t)), 'e2e ' + TAG, 10000));
    if (canPhoto) check('A sees B photo', await until(A, () => { const i = document.querySelector('.post-img'); return !!(i && i.complete && i.naturalWidth > 0); }, null, 10000));
    await A.click('.post .act >> nth=0');
    await B.click('#tab-feed');
    check('B sees the proost live', await until(B, n => [...document.querySelectorAll('.post-likes')].some(e => e.textContent.includes(n)), nameA, 10000));
    check('Both shown as online', await until(A, ns => { const t = document.getElementById('online-strip').innerText; return ns.every(n => t.includes(n)); }, [nameA, nameB], 10000));

    // past nights so the progress charts have data
    await A.evaluate(async names => {
      const db = await window.backend.use('db');
      const snap = col => new Promise(r => { const un = db.collection(col).onSnapshot(s => { un(); r(s.docs.map(d => ({ id: d.id, data: d.data() }))); }); });
      const ms = await snap('members'), id = n => ms.find(m => m.data.name === n).id;
      const nights = ['2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07'];
      const plan = [[names[0], [3, 5, 2, 6]], [names[1], [4, 2, 6, 3]]];
      for (const [n, arr] of plan) for (let i = 0; i < arr.length; i++)
        await db.collection('entries').add({ memberId: id(n), by: null, counts: { mixjes: 0, biertjes: arr[i], shotjes: 1, stelz: 0, wijn: 0, barfjes: 0 }, at: nights[i] + 'T22:15:00.000Z', night: nights[i], likes: {}, comments: {} });
    }, [nameA, nameB]);
    await A.click('#tab-ranglijst'); await A.click('#seg-altijd');
    check('Progress chart drawn', await until(A, () => document.querySelectorAll('#trend-sec .ch-line').length >= 1, null, 10000));
    if (SHOTS) await A.screenshot({ path: SHOTS + '-ranglijst.png', fullPage: true });
    await B.click('#tab-ranglijst'); await B.click('#seg-altijd');
    await until(B, n => [...document.querySelectorAll('.row')].some(r => r.innerText.includes(n)), nameA);
    await B.click(`.row:has-text("${nameA}")`);
    check('B sees A profile chart', await until(B, () => document.querySelectorAll('#view-profiel .ch-bar').length >= 2, null, 10000));
    if (SHOTS) await B.screenshot({ path: SHOTS + '-profiel.png', fullPage: true });
    for (const [l, p] of [['A', A], ['B', B]]) check(l + ' no sideways scroll', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  } catch (e) {
    check('test ran to the end', false, e.message.split('\n')[0]);
  }

  // ---------- starting and joining with bad reception or a bad setup (mock only) ----------
  if (MOCK) try {
    const mark = p => p.evaluate(() => { window.__noReload = 1; });
    const notReloaded = p => p.evaluate(() => window.__noReload === 1);
    const gateMsg = p => p.evaluate(() => document.getElementById('gate-msg').hidden ? '' : document.getElementById('gate-msg-text').textContent);
    // What the app holds right now (the views read this), whichever tab is open.
    const namesShown = (p, ns) => p.evaluate(async ns => {
      const db = await window.backend.use('db');
      const names = await new Promise(r => { const un = db.collection('members').onSnapshot(s => { un(); r(s.docs.map(d => d.data().name)); }); });
      return ns.every(n => names.includes(n));
    }, ns);
    const ownNameKept = async p => {
      await p.click('#tab-tellen');
      return until(p, n => document.getElementById('who-card').hidden && [...document.querySelectorAll('#for-chips button')].some(b => b.textContent.includes(n) && b.textContent.includes('(jij)')), nameB);
    };

    // B opens the app again later; refreshing the login fails on bad reception.
    const uidB = await authUid(B), signupsB = stats.B.signups;
    faults.B = { session: true };
    await B.reload();
    check('Login refresh fails: network screen, not the owner message', await until(B, () => { const m = document.getElementById('gate-msg'), t = document.getElementById('gate-msg-text').textContent; return !m.hidden && /Geen verbinding/.test(t) && !/anonieme|Supabase/.test(t); }));
    check('Login refresh fails: stored login kept, no new account', stats.B.signups === signupsB && (await authUid(B)) === uidB);
    faults.B = {};
    await mark(B);
    await B.click('#gate-retry');
    check('Retry gets B in as the same person, without a reload', await until(B, () => document.getElementById('gate').hidden) && (await authUid(B)) === uidB && await notReloaded(B));
    check('Retry: B still has own name', await ownNameKept(B));

    // The library threw the dead login away: a new account is made and takes B's own name back.
    await B.evaluate(() => localStorage.removeItem('turflijst-auth'));
    await B.reload();
    check('Lost login: B gets back in with the saved code', await until(B, () => document.getElementById('gate').hidden));
    const uidB2 = await authUid(B);
    check('Lost login: exactly one new account', !!uidB2 && uidB2 !== uidB && stats.B.signups === signupsB + 1);
    check('Lost login: own name moved to the new login, not "bezet"', await ownNameKept(B) && await poll(() => memberUid(nameB) === uidB2));
    await B.click('#tab-feed');
    check('Lost login: delete button stays on own older registration', await until(B, t => [...document.querySelectorAll('.post')].some(p => p.innerText.includes(t) && [...p.querySelectorAll('button')].some(b => b.textContent === 'Verwijder')), 'e2e ' + TAG));

    // A's login lapses mid-evening (phone in a pocket, then a reception dip).
    faults.A = { session: true };
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    await A.waitForTimeout(400);
    check('Lapsed login: names are not wiped', await namesShown(A, [nameA, nameB]));
    const held = await A.evaluate(async () => { const db = await window.backend.use('db'); try { await db.doc('probe/x').set({ ok: 1 }); return 'saved'; } catch (e) { return e.code; } });
    check('Lapsed login: a write waits as "no connection", it is not refused', held === 'unavailable', held);
    faults.A = { anonData: true };
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    await A.waitForTimeout(400);
    check('Empty answer for a lapsed login does not wipe the list', await namesShown(A, [nameA, nameB]));
    faults.A = {};
    const back = await A.evaluate(async () => { const db = await window.backend.use('db'); try { await db.doc('probe/x').set({ ok: 1 }); await db.doc('probe/x').delete(); return 'saved'; } catch (e) { return e.code; } });
    check('Login back: writing and deleting work again', back === 'saved' && !srv.docs.has('vrienden|probe/x'), back);
    check('Lapsed login: no "Opslaan lukt niet" banner', await A.evaluate(() => !document.getElementById('banner').textContent.includes('Opslaan lukt niet')));

    // iPhone home-screen app: own storage, starts without a code. Pasting the invite link works.
    C = await friend('C', { device: devices['iPhone 13'], init: () => { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } });
    await C.goto(base);
    check('Home-screen app: code screen asks to paste the invite link', await until(C, () => !document.getElementById('gate-code').hidden && /beginscherm/.test(document.getElementById('gate-hint').textContent)));
    await C.fill('#gate-input', 'Doe je mee? ' + invite.toLowerCase() + ' tot zo!');
    await C.tap('#gate-submit');
    check('Home-screen app: pasted invite link (in chat text) joins', await until(C, () => document.getElementById('gate').hidden));
    check('Home-screen app: address bar keeps ?g=CODE for the icon', await C.evaluate(c => location.search === '?g=' + c, encodeURIComponent(normCode(CODE))));
    await C.reload();
    check('Home-screen app: reopening goes straight in', await until(C, () => !document.body.classList.contains('gated') && document.getElementById('gate').hidden && !!document.querySelector('#for-chips button')));
    check('Home-screen app: no sideways scroll', await C.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    // Joining with the code on bad reception, or after too many wrong codes.
    D = await friend('D', { clock: true });
    await D.goto(base);
    await until(D, () => !document.getElementById('gate-code').hidden);
    faults.D = { join: 'network' };
    await D.fill('#gate-input', CODE); await D.click('#gate-submit');
    const joinErr = () => until(D, () => /Geen verbinding/.test(document.getElementById('gate-error').textContent) && !document.getElementById('gate-submit').disabled && document.getElementById('gate-submit').textContent === 'Meedoen');
    check('Join without network says so, not "wrong code"', await joinErr());
    faults.D = { join: 'hang' };
    await D.click('#gate-submit');
    check('Join in progress: button says Bezig…', await until(D, () => { const b = document.getElementById('gate-submit'); return b.disabled && b.textContent === 'Bezig…'; }));
    await D.clock.fastForward(16000);
    check('Join that never answers: button comes back with the network message', await joinErr());
    faults.D = { join: 'TL429' };
    await D.click('#gate-submit');
    check('Too many wrong codes: says how long to wait', await until(D, () => /Te vaak een verkeerde code geprobeerd\. Wacht 9 minuten\./.test(document.getElementById('gate-error').textContent)));
    faults.D = {};
    await D.click('#gate-submit');
    check('Join works once the network is back', await until(D, () => document.getElementById('gate').hidden));

    // Start-up that hangs (stalled connection): a retry shows up, and it does not reload the page.
    faults.E = { hang: true };
    const E = await friend('E', { clock: true });
    await E.goto(base);
    await until(E, () => !document.getElementById('gate-loading').hidden);
    await E.clock.fastForward(13000);
    check('Hanging start-up offers "Opnieuw proberen"', await until(E, () => !document.getElementById('gate-slow').hidden));
    faults.E = {};
    await mark(E);
    await E.click('#gate-slow-retry');
    check('Retry after a hang works without a page reload', await until(E, () => !document.getElementById('gate-code').hidden) && await notReloaded(E));

    // First visit via an old link, with no network, then sign-in trouble.
    faults.F = { signup: 'network' };
    const F = await friend('F');
    await F.goto(base + '?g=OUDECODE9');
    check('First visit offline: network message with retry, no owner advice', await until(F, () => { const t = document.getElementById('gate-msg').hidden ? '' : document.getElementById('gate-msg-text').textContent; return /Geen verbinding/.test(t) && !/Supabase/.test(t) && !document.getElementById('gate-retry').hidden; }));
    await mark(F);
    await F.context().setOffline(true);
    await F.click('#gate-retry');
    check('Retry while offline: "Nog geen bereik", no reload', await until(F, () => !document.getElementById('toast').hidden && /Nog geen bereik/.test(document.getElementById('toast-text').textContent)) && await notReloaded(F));
    faults.F = { signup: 'busy' };
    await F.context().setOffline(false);
    check('Coming back online retries by itself; rate limit gets its own message', await until(F, () => /veel mensen tegelijk/.test(document.getElementById('gate-msg-text').textContent)) && await notReloaded(F));
    faults.F = { signup: 'disabled' };
    await F.click('#gate-retry');
    check('Anonymous logins off: message for whoever set the app up', await until(F, () => /wie de app beheert/.test(document.getElementById('gate-msg-text').textContent)));
    faults.F = {};
    await F.click('#gate-retry');
    check('Dead invite link: says so, with the tried code filled in', await until(F, () => !document.getElementById('gate-code').hidden && document.getElementById('gate-input').value === 'OUDECODE9' && /werkt niet \(meer\)/.test(document.getElementById('gate-error').textContent)));
    check('Dead invite link: code taken out of the address bar', await F.evaluate(() => location.search === '' && location.hash === '') && await notReloaded(F));

    // The owner pasted the secret key into config.js.
    let keyG = 'sb_secret_' + 'x'.repeat(24);
    const G = await friend('G', { key: () => keyG });
    await G.goto(base);
    const secretShown = () => until(G, () => /geheime sleutel/.test(document.getElementById('gate-msg-text').textContent) && !document.getElementById('gate-msg').hidden && document.getElementById('gate-retry').hidden);
    check('Secret key in config.js: refused with a clear message', await secretShown());
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    keyG = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ iss: 'supabase', ref: 'x', role: 'service_role' }) + '.c2ln';
    await G.reload();
    check('service_role key in config.js: refused too', await secretShown());
    check('Secret key: not a single request was sent', !stats.G || stats.G.calls === 0);
  } catch (e) {
    check('robustness checks ran to the end', false, e.message.split('\n')[0]);
  }

  // ---------- who am I: taking a name over, switching, deleting (mock only) ----------
  // C is the iPhone home-screen app (a new device for B), D runs on a fake clock.
  if (MOCK && C && D) try {
    const nameX = TAG + '-X', nameA2 = nameA + ' 2';
    const exact = n => new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    const toastIs = (p, re, ms) => until(p, src => { const t = document.getElementById('toast'); return !t.hidden && new RegExp(src).test(document.getElementById('toast-text').textContent); }, re.source, ms);
    const chipText = (p, n) => p.evaluate(n => { const b = [...document.querySelectorAll('#who-chips button')].find(b => b.textContent.includes(n)); return b ? b.textContent : ''; }, n);
    const isMe = (p, n) => until(p, n => document.getElementById('who-card').hidden && document.getElementById('night-label').textContent.includes('Jij: ' + n), n);
    const row = (p, n) => p.locator('#members .member', { has: p.locator('.nm-btn', { hasText: exact(n) }) });
    const rowBtn = (p, n, label) => row(p, n).locator('button', { hasText: label });
    const rowLabels = (p, n) => row(p, n).locator('.acts button').allTextContents();
    const named = n => [...srv.docs.values()].filter(r => r.path.startsWith('members/') && r.data.name.toLowerCase() === n.toLowerCase()).length;
    const idOf = n => memberRow(n).path.split('/')[1];
    const uidA = await authUid(A), uidB = await authUid(B), uidC = await authUid(C);

    // B's own name on a new device (C): "bezet", but tappable and explained.
    await C.tap('#tab-tellen');
    check('Taken name: chip can be tapped, says (bezet), and the text explains it', await until(C, n => { const b = [...document.querySelectorAll('#who-chips button')].find(b => b.textContent.includes(n)); return !!b && !b.disabled && /\(bezet\)/.test(b.textContent) && /\(bezet\)/.test(document.getElementById('who-text').textContent); }, nameB));
    await C.waitForTimeout(650);
    await C.evaluate(n => { const pick = () => [...document.querySelectorAll('#who-chips button')].find(b => b.textContent.includes(n)); pick().click(); pick().click(); }, nameB);
    check('Double tap on a taken name only asks "Ben jij …? Tik nog eens"', /Ben jij .*Tik nog eens/.test(await chipText(C, nameB)) && memberUid(nameB) === uidB && await C.evaluate(() => !document.getElementById('who-note').hidden));
    await C.waitForTimeout(450);
    await C.tap('#who-chips button:has-text("Ben jij")');
    check('Second tap takes the name over on this device', await isMe(C, nameB) && await poll(() => memberUid(nameB) === uidC) && await toastIs(C, /op dit toestel/));
    check('The device that lost the name is told so, not silently reset', await toastIs(B, /is nu op een ander toestel gekozen/));
    check('After taking the name over, own recent registration can still be deleted', await until(C, n => [...document.querySelectorAll('#log .log-row')].some(r => r.innerText.includes(n) && [...r.querySelectorAll('button')].some(b => b.textContent === 'Verwijder')), nameB));

    // B takes it back from Groep: "Dit ben ik" on a taken name asks first.
    await B.click('#tab-tellen');
    check('Lost device shows "Wie ben jij?" again', await until(B, () => !document.getElementById('who-card').hidden));
    await B.click('#tab-groep');
    await rowBtn(B, nameB, 'Dit ben ik').click();
    check('Groep: "Dit ben ik" on a taken name asks first', await rowBtn(B, nameB, 'Ben jij').count() === 1 && memberUid(nameB) === uidC);
    await B.waitForTimeout(450);
    await rowBtn(B, nameB, 'Ben jij').click();
    check('Groep: second tap gives B the name back, and C is told', await poll(() => memberUid(nameB) === uidB) && await toastIs(C, /is nu op een ander toestel gekozen/));

    // A switches name by accident: it asks first, and the toast can undo it.
    check('Header says who you are', await A.evaluate(n => document.getElementById('night-label').textContent.includes('Jij: ' + n), nameA));
    await A.click('#tab-groep');
    await A.fill('#add-member-name', nameX); await A.click('#add-member-btn');
    await until(A, n => [...document.querySelectorAll('#members .nm-btn')].some(b => b.textContent === n), nameX);
    await rowBtn(A, nameX, 'Dit ben ik').click();
    check('Switching to another name asks first ("Wissel naar …?")', await rowBtn(A, nameX, 'Wissel naar').count() === 1 && await A.evaluate(n => document.getElementById('night-label').textContent.includes('Jij: ' + n), nameA));
    await A.waitForTimeout(450);
    await rowBtn(A, nameX, 'Wissel naar').click();
    check('Switched, with an undo button in the toast', await poll(() => memberUid(nameX) === uidA && !memberUid(nameA)) && await toastIs(A, /Je bent nu/) && await A.evaluate(() => !document.getElementById('toast-undo').hidden));
    await A.click('#toast-undo');
    check('Undo makes A the old name again', await poll(() => memberUid(nameA) === uidA && !memberUid(nameX)) && await isMe(A, nameA));

    // Deleting a name: no double-tap deletes, undo brings back the same name, used names stay.
    const idX = idOf(nameX);
    await rowBtn(A, nameX, 'Verwijder').dblclick();
    check('Double tap on Verwijder does not delete', !!memberRow(nameX) && await rowBtn(A, nameX, 'Ja, verwijder').count() === 1);
    await A.waitForTimeout(450);
    await rowBtn(A, nameX, 'Ja, verwijder').click();
    check('A name nobody used can be deleted, with undo', await poll(() => !memberRow(nameX)) && await toastIs(A, /is verwijderd/));
    await A.click('#toast-undo');
    check('Undo puts the name back with the same id', await poll(() => !!memberRow(nameX) && idOf(nameX) === idX));
    await A.evaluate(async ([idx, cap]) => {
      const db = await window.backend.use('db');
      const es = await new Promise(r => { const un = db.collection('entries').onSnapshot(s => { un(); r(s.docs); }); });
      const e = es.find(d => d.data().caption === cap);
      await db.doc('entries/' + e.id).update({ comments: { e2e: { memberId: idx, by: null, text: 'proost', at: new Date().toISOString() } } });
    }, [idX, 'e2e ' + TAG]);
    check('A name with only a comment (no drinks) cannot be deleted', await poll(async () => { const l = await rowLabels(A, nameX); return l.length > 0 && !l.includes('Verwijder'); }));
    const labelsB = await rowLabels(A, nameB);
    check('A name in use on another device: take over or Vrijgeven, no Verwijder', labelsB.includes('Dit ben ik') && labelsB.includes('Vrijgeven') && !labelsB.includes('Verwijder'), labelsB.join(', '));

    // Vrijgeven says what it does, and the device that had the name is told.
    await rowBtn(A, nameB, 'Vrijgeven').click();
    check('Vrijgeven asks first and says what happens', await rowBtn(A, nameB, 'moet dan opnieuw kiezen').count() === 1);
    await A.waitForTimeout(450);
    await rowBtn(A, nameB, 'moet dan opnieuw kiezen').click();
    check('Vrijgeven unlinks the name, and that device is told', await poll(() => !memberUid(nameB)) && await toastIs(B, /losgekoppeld van dit toestel/));
    await B.click('#tab-tellen');
    await until(B, n => !document.getElementById('who-card').hidden && [...document.querySelectorAll('#who-chips button')].some(b => b.textContent.includes(n) && !/bezet/.test(b.textContent)), nameB);
    await B.waitForTimeout(650);
    await B.click(`#who-chips button:has-text("${nameB}")`);
    check('B picks the freed name again with one tap', await isMe(B, nameB) && await poll(() => memberUid(nameB) === uidB));

    // Confirming your own claim from the same phone (under another name) does not count.
    await A.evaluate(async ([tag, idA, idB, idX, uidA, uidB]) => {
      const db = await window.backend.use('db'), now = new Date().toISOString(), later = new Date(Date.now() + 1000).toISOString();
      const claims = {}; claims[idX] = { at: now, by: uidB, confirms: { [idB]: now }, confirmBy: { [idB]: uidB } };
      await db.doc('challenges/e2e-' + tag).set({ title: tag + ' uitdaging', points: 10, createdBy: idA, by: uidA, at: now, need: 1, closed: false, claims: claims });
      const votes = { [idA]: { side: 'ja', at: now, by: 'u-same' }, [idX]: { side: 'ja', at: later, by: 'u-same' } };
      await db.doc('bets/e2e-' + tag).set({ title: tag + ' voorspelling', odds: { ja: 2, nee: 2 }, createdBy: idA, by: uidA, at: now, need: 2, closedAt: null, void: false, stakes: {}, votes: votes });
    }, [TAG, idOf(nameA), idOf(nameB), idX, uidA, uidB]);
    const chCard = (p, t) => p.evaluate(t => { const g = [...document.querySelectorAll('#ch-list .game')].find(g => g.innerText.includes(t)); return g ? { text: g.innerText, bevestig: [...g.querySelectorAll('.claim button')].some(b => b.textContent === 'Ik zag het') } : null; }, t);
    const chTitle = TAG + ' uitdaging';
    await A.click('#tab-spel'); await A.click('#seg-ch');
    check('Self-confirmed claim is not counted', await poll(async () => { const c = await chCard(A, chTitle); return !!c && /0\/1 bevestigd/.test(c.text) && c.bevestig && !/Nog niemand/.test(c.text); }));
    await B.click('#tab-spel'); await B.click('#seg-ch');
    check('The phone that made the claim gets no Bevestig button, and is told why', await poll(async () => { const c = await chCard(B, chTitle); return !!c && /0\/1 bevestigd/.test(c.text) && !c.bevestig && /iemand anders/.test(c.text); }));
    await A.locator('#ch-list .game', { hasText: chTitle }).locator('.claim button', { hasText: 'Ik zag het' }).click();
    check('A confirm from another phone does count', await poll(async () => { const c = await chCard(A, chTitle); return !!c && /Gehaald/.test(c.text); }));
    await A.click('#seg-bet');
    check('Two votes from one phone under two names count once', await until(A, t => { const g = [...document.querySelectorAll('#bet-list .game')].find(g => g.innerText.includes(t)); return !!g && /Ja 1\/2/.test(g.innerText); }, TAG + ' voorspelling'));

    // Picking a name with no reception: the claim is sent again once there is a connection.
    faults.C = { session: true };
    await C.tap('#tab-tellen');
    await until(C, n => !document.getElementById('who-card').hidden && [...document.querySelectorAll('#who-chips button')].some(b => b.textContent.includes(n)), nameX);
    await C.waitForTimeout(650);
    await C.tap(`#who-chips button:has-text("${nameX}")`);
    await C.waitForTimeout(1500);
    check('No reception: the name is still yours on this phone', await isMe(C, nameX) && !memberUid(nameX));
    faults.C = {};
    await C.evaluate(() => window.dispatchEvent(new Event('online')));
    check('Back online: the name gets linked to this phone after all', await poll(() => memberUid(nameX) === uidC));

    // An armed "Ben jij …?" falls back by itself (fake clock), and typed names point to the chip.
    await D.click('#tab-tellen');
    await until(D, n => [...document.querySelectorAll('#who-chips button')].some(b => b.textContent.includes(n) && /bezet/.test(b.textContent)), nameA);
    await D.clock.fastForward(1000);
    await D.click(`#who-chips button:has-text("${nameA}")`);
    const armedD = /Ben jij/.test(await chipText(D, nameA));
    await D.clock.fastForward(4500);
    check('"Ben jij …?" falls back by itself after a few seconds', armedD && await until(D, n => /\(bezet\)/.test([...document.querySelectorAll('#who-chips button')].find(b => b.textContent.includes(n)).textContent), nameA) && memberUid(nameA) === uidA);
    await D.fill('#who-add-name', nameA.toUpperCase()); await D.click('#who-add-btn');
    check('Typing a name that is already there points to it, no duplicate', await toastIs(D, /staat er al\. Tik hierboven op je naam/) && /Ben jij/.test(await chipText(D, nameA)) && named(nameA) === 1);
    await D.fill('#who-add-name', nameA2); await D.click('#who-add-btn');
    check('A name that looks like an existing one asks "Bedoel je …?" first', await toastIs(D, /Bedoel je/) && !memberRow(nameA2));
    await D.click('#who-add-btn');
    check('…and a second tap adds it anyway', await isMe(D, nameA2) && !!memberRow(nameA2));

    await A.evaluate(async tag => { const db = await window.backend.use('db'); await db.doc('challenges/e2e-' + tag).delete(); await db.doc('bets/e2e-' + tag).delete(); }, TAG);
  } catch (e) {
    check('identity checks ran to the end', false, e.message.split('\n')[0]);
  }

  // ---------- Tellen: all names in view, who it is for, slow saves, undo, old tallies (mock only) ----------
  if (MOCK && C && D) try {
    const exact = n => new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    const toastIs = (p, re, ms) => until(p, src => { const t = document.getElementById('toast'); return !t.hidden && new RegExp(src).test(document.getElementById('toast-text').textContent); }, re.source, ms);
    const idOf = n => memberRow(n).path.split('/')[1];
    const entriesOf = n => [...srv.docs.values()].filter(r => r.path.startsWith('entries/') && r.data.memberId === idOf(n));
    const newest = n => entriesOf(n).sort((a, b) => a.data.at < b.data.at ? 1 : -1)[0] || { data: { counts: {} } };
    const allEntries = () => [...srv.docs.keys()].filter(k => k.startsWith('vrienden|entries/')).length;
    const out = (p, k) => p.evaluate(k => +document.getElementById('out-' + k).textContent, k);
    const regText = p => p.evaluate(() => document.getElementById('btn-reg').textContent.replace(/\u00a0/g, ' '));
    const plus = (p, label) => p.click('[aria-label="' + label + ' plus één"]');
    const forChip = (p, n) => p.locator('#for-chips button', { hasText: exact(n) });
    const pressedFor = p => p.evaluate(() => { const b = document.querySelector('#for-chips [aria-pressed="true"]'); return b ? b.textContent : ''; });
    const stale = p => p.evaluate(() => document.getElementById('stale-box').hidden ? '' : document.getElementById('stale-box').innerText);
    const open = async p => { await until(p, () => document.getElementById('gate').hidden && document.querySelectorAll('#for-chips button').length > 0, null, 10000); };
    const nameA2 = nameA + ' 2';

    // A full group of 15: every name is on screen on an iPhone, wrapped instead of scrolling sideways.
    const have = [...srv.docs.values()].filter(r => r.path.startsWith('members/')).length;
    await A.evaluate(async ([tag, n]) => {
      const db = await window.backend.use('db');
      for (let i = 1; i <= n; i++) await db.collection('members').add({ name: tag + '-Vriend' + i, createdAt: new Date().toISOString(), by: null, uid: null });
    }, [TAG, 15 - have]);
    const H = await friend('H', { device: devices['iPhone 13'] });
    await H.goto(base + '?g=' + encodeURIComponent(CODE));
    await until(H, () => document.getElementById('gate').hidden && document.querySelectorAll('#who-chips button').length === 15, null, 10000);
    const fits = sel => H.evaluate(sel => {
      const box = document.querySelector(sel), bs = [...box.querySelectorAll('button')];
      return bs.length === 15 && box.scrollWidth <= box.clientWidth && bs.every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.height >= 44; });
    }, sel);
    check('15 names: every "Wie ben jij?" name is in view, wrapped, 44 px high', await fits('#who-chips'));
    check('15 names: every "Voor wie tel je?" name is in view too', await fits('#for-chips'));
    if (SHOTS) await H.screenshot({ path: SHOTS + '-tellen-iphone.png', fullPage: true });
    // No name picked yet: Registreer looks off, but a tap says what to do instead of nothing.
    const before = allEntries();
    await H.waitForTimeout(650);
    await H.tap('[aria-label="Biertjes plus één"]');
    check('No name yet: Registreer says "Kies je naam" and is marked as not ready', await H.evaluate(() => { const b = document.getElementById('btn-reg'); return !b.disabled && b.getAttribute('aria-disabled') === 'true' && b.textContent === 'Kies je naam'; }));
    await H.tap('#btn-reg', { force: true }); // aria-disabled: Playwright waits for it, a finger does not
    check('No name yet: a tap on Registreer explains and points to the names', await toastIs(H, /Kies eerst wie je bent/) && await H.evaluate(() => document.getElementById('who-card').classList.contains('flash')) && allEntries() === before);
    check('iPhone, 15 names: no sideways scroll', await H.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await H.context().close();

    // The button says for whom.
    await A.click('#tab-tellen');
    await plus(A, 'Biertjes');
    check('Registreer says for whom ("Registreer voor <naam> →")', (await regText(A)) === 'Registreer voor ' + nameA + ' →');

    // A slow save: the counter empties at once (only of what was registered), the next round can be
    // tapped and typed meanwhile, and the line under the counters says it is on its way.
    faults.A = { holdWrite: true };
    await A.click('#btn-reg');
    check('Slow save: counter empties at once, "wordt verstuurd…" next to it and in the log', (await out(A, 'biertjes')) === 0 && await A.evaluate(() => /wordt verstuurd/.test(document.getElementById('compose-line').textContent) && [...document.querySelectorAll('#log .log-row')].some(r => /versturen/.test(r.textContent))));
    await A.click('#btn-reg', { force: true });
    check('Double tap on Registreer: the second tap does nothing (no "tel eerst" message)', await A.evaluate(() => document.getElementById('toast').hidden || !/Tel eerst/.test(document.getElementById('toast-text').textContent)));
    await plus(A, 'Shotjes'); await plus(A, 'Shotjes');
    await A.fill('#caption', 'volgende ronde');
    faults.A = {}; releaseWrites();
    check('Slow save: saved, for the drinks from before the tap', await toastIs(A, /Geregistreerd voor/, 8000) && newest(nameA).data.counts.biertjes === 1 && !newest(nameA).data.counts.shotjes && !newest(nameA).data.caption);
    check('Slow save: taps and caption from during the save are kept', (await out(A, 'biertjes')) === 0 && (await out(A, 'shotjes')) === 2 && (await A.inputValue('#caption')) === 'volgende ronde');

    // Teller wissen: away from Registreer, and undoable.
    check('Teller wissen is not next to Registreer in the header', await A.evaluate(() => !document.querySelector('.top #btn-clear') && !document.getElementById('btn-clear').hidden));
    await A.click('#btn-clear');
    check('Teller wissen empties the counter, with an undo button', (await out(A, 'shotjes')) === 0 && (await A.inputValue('#caption')) === '' && await toastIs(A, /Teller gewist/) && await A.evaluate(() => !document.getElementById('toast-undo').hidden));
    await A.click('#toast-undo');
    check('Undo puts the drinks and the caption back', (await out(A, 'shotjes')) === 2 && (await A.inputValue('#caption')) === 'volgende ronde');

    // Counting for a friend: clearly marked, survives a reload, and the next round is for yourself again.
    await forChip(A, nameB).click();
    check('For a friend: button names the friend and looks different', (await regText(A)) === 'Registreer voor ' + nameB + ' →' && await A.evaluate(() => document.getElementById('btn-reg').classList.contains('for-other')));
    check('For a friend: said next to the counters as well', await A.evaluate(n => document.getElementById('compose-line').textContent.includes('Voor ' + n), nameB));
    if (SHOTS) await A.screenshot({ path: SHOTS + '-tellen-voor-vriend.png' });
    await A.setViewportSize({ width: 320, height: 568 });
    check('320 px wide: header with "Registreer voor <naam>" fits, title and night date readable, no sideways scroll', await A.evaluate(() => {
      const t = document.getElementById('brand-title'), d = document.getElementById('night-date').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect();
      return document.documentElement.scrollWidth <= 320 && document.getElementById('btn-reg').getBoundingClientRect().right <= 320 - 12 && t.scrollWidth <= t.clientWidth && d.width > 0 && d.right <= br.right + 0.5;
    }));
    if (SHOTS) await A.screenshot({ path: SHOTS + '-tellen-320.png' });
    await A.setViewportSize({ width: 390, height: 844 });
    await A.reload(); await open(A);
    check('Reload keeps the tally, the caption and for whom', (await regText(A)) === 'Registreer voor ' + nameB + ' →' && (await out(A, 'shotjes')) === 2 && (await A.inputValue('#caption')) === 'volgende ronde');
    await A.click('#btn-reg');
    check('Registered for the friend, and told the next round is for yourself', await toastIs(A, /Je turft nu weer voor jezelf/) && newest(nameB).data.counts.shotjes === 2 && newest(nameB).data.caption === 'volgende ronde');
    check('"Voor wie tel je?" is back on yourself', (await pressedFor(A)).includes(nameA) && (await regText(A)) === 'Registreer voor ' + nameA + ' →');
    await plus(A, 'Wijn');
    await A.click('#btn-reg');
    check('The next registration goes to yourself', await toastIs(A, new RegExp('Geregistreerd voor ' + nameA)) && newest(nameA).data.counts.wijn === 1);

    // Delete in the Tellen log: asks first, and can be undone (same id back).
    const wijnPath = newest(nameA).path;
    const logRow = A.locator('#log .log-row', { hasText: '1 wijn' });
    await logRow.locator('button', { hasText: 'Verwijder' }).click();
    check('Tellen log: Verwijder asks first', srv.docs.has('vrienden|' + wijnPath) && await logRow.locator('button', { hasText: 'Ja, verwijder' }).count() === 1);
    await A.waitForTimeout(450);
    await logRow.locator('button', { hasText: 'Ja, verwijder' }).click();
    check('Tellen log: deleted, with an undo button', await poll(() => !srv.docs.has('vrienden|' + wijnPath)) && await toastIs(A, /verwijderd/) && await A.evaluate(() => !document.getElementById('toast-undo').hidden));
    await A.click('#toast-undo');
    check('Tellen log: undo puts the registration back', await poll(() => srv.docs.has('vrienden|' + wijnPath)) && await toastIs(A, /teruggezet/));

    // A tally from an earlier night that was never registered: its own card, not added to tonight.
    await A.evaluate(id => localStorage.setItem('turflijst-draft', JSON.stringify({ v: 2, counts: { biertjes: 2 }, night: '2025-01-04', at: '2025-01-05T01:30:00.000Z', forId: id, caption: 'oud' })), idOf(nameB));
    await A.reload(); await open(A);
    const st1 = await stale(A);
    check('Old tally: shown on its own card with its date and for whom, counter empty', /Nog niet geregistreerd/.test(st1) && /4 jan/.test(st1) && st1.includes(nameB) && (await out(A, 'biertjes')) === 0, st1.replace(/\n/g, ' | '));
    if (SHOTS) { await A.evaluate(() => window.scrollTo(0, 0)); await A.screenshot({ path: SHOTS + '-tellen-oude-telling.png' }); }
    await A.click('#stale-box button:has-text("Registreer voor die avond")');
    check('Old tally: registered on that night, for that friend', await poll(() => entriesOf(nameB).some(r => r.data.night === '2025-01-04' && r.data.counts.biertjes === 2 && r.data.caption === 'oud')) && await toastIs(A, /Geregistreerd/) && !(await stale(A)));
    await A.evaluate(() => localStorage.setItem('turflijst-draft', JSON.stringify({ biertjes: 1 })));
    await A.reload(); await open(A);
    check('Old-style tally (no date): card offers "Registreer voor vanavond"', /eerdere avond/.test(await stale(A)) && await A.locator('#stale-box button', { hasText: 'Registreer voor vanavond' }).count() === 1);
    await A.click('#stale-box button:has-text("Weggooien")');
    check('Old tally: Weggooien, with undo', !(await stale(A)) && await toastIs(A, /Weggegooid/) && await A.evaluate(() => !document.getElementById('toast-undo').hidden));
    await A.click('#toast-undo');
    check('Old tally: undo brings the card back', /eerdere avond/.test(await stale(A)));
    await A.click('#stale-box button:has-text("Weggooien")');

    // D (fake clock, no live updates): the save arrives but its answer never does. After 15 s it says
    // so; the registration waits on the phone (not in the counter). Trying again does not double it,
    // and does not wipe the proost it got meanwhile.
    await D.click('#tab-tellen');
    await plus(D, 'Biertjes');
    faults.D = { lostReply: true, noLive: true };
    await D.click('#btn-reg');
    const goingD = (await out(D, 'biertjes')) === 0 && await D.evaluate(() => /wordt verstuurd/.test(document.getElementById('compose-line').textContent));
    await D.clock.fastForward(16000);
    check('Save that never answers: gives up after 15 s, says it is kept, counter stays empty', goingD && await toastIs(D, /Geen bereik.*bewaard/) && (await out(D, 'biertjes')) === 0 && (await regText(D)) === 'Registreer voor ' + nameA2 + ' →');
    check('Waiting: banner says "1 registratie wacht op internet", the log "nog niet verstuurd"', await until(D, () => /1 registratie wacht op internet/.test(document.getElementById('banner').textContent) && [...document.querySelectorAll('#log .log-row')].some(r => /nog niet verstuurd/.test(r.textContent))));
    const landed = entriesOf(nameA2)[0];
    if (landed) landed.data = Object.assign({}, landed.data, { likes: { [idOf(nameA)]: true } });
    faults.D = {};
    await D.click('#outbox-retry');
    check('Nu proberen: saved once, not twice, and the proost it got meanwhile stays', !!landed && await toastIs(D, /opgeslagen voor/) && entriesOf(nameA2).length === 1 && !!entriesOf(nameA2)[0].data.likes[idOf(nameA)]);
    check('Sent: the "wacht op internet" line is gone', await until(D, () => !/wacht op internet/.test(document.getElementById('banner').textContent) && !/nog niet verstuurd/.test(document.getElementById('log').textContent)));
    // A tab left open into the next evening moves the old tally to its own card.
    await plus(D, 'Biertjes');
    await D.clock.fastForward(26 * 3600 * 1000);
    check('Tab left open until the next night: old tally moves to its own card', await until(D, () => !document.getElementById('stale-box').hidden && +document.getElementById('out-biertjes').textContent === 0));
    await D.click('#stale-box button:has-text("Weggooien")');
  } catch (e) {
    check('tellen checks ran to the end', false, e.message.split('\n')[0]);
  }

  // ---------- saving and syncing with bad reception (mock only) ----------
  if (MOCK && C && D) try {
    const toastIs = (p, re, ms) => until(p, src => { const t = document.getElementById('toast'); return !t.hidden && new RegExp(src).test(document.getElementById('toast-text').textContent); }, re.source, ms);
    const idOf = n => memberRow(n).path.split('/')[1];
    const entriesOf = n => [...srv.docs.values()].filter(r => r.path.startsWith('entries/') && r.data.memberId === idOf(n));
    const out = (p, k) => p.evaluate(k => +document.getElementById('out-' + k).textContent, k);
    const plus = (p, label) => p.click('[aria-label="' + label + ' plus één"]');
    const open = async p => { await until(p, () => document.getElementById('gate').hidden && document.querySelectorAll('#for-chips button').length > 0, null, 10000); };
    const outbox = p => p.evaluate(() => JSON.parse(localStorage.getItem('turflijst-outbox') || '[]'));
    const banner = p => p.evaluate(() => document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent);
    const colSize = (p, c) => p.evaluate(async c => { const db = await window.backend.use('db'); return new Promise(r => { const un = db.collection(c).onSnapshot(s => { un(); r(s.size); }); }); }, c);
    const putRow = (pth, data, at) => srv.docs.set('vrienden|' + pth, { grp: 'vrienden', path: pth, collection: pth.split('/')[0], data: data, updated_at: at || iso() });

    // A new phone loads a big group: page by page (this project answers 400 rows at a time), and a
    // delete between two pages makes no other document drop out. Later refreshes fetch only what changed.
    const OLD = '2025-01-01T00:00:00.000Z';
    for (let i = 0; i < 1005; i++) putRow('probe/' + String(i).padStart(5, '0'), { i: i }, OLD);
    const onServer = () => [...srv.docs.keys()].filter(k => k.startsWith('vrienden|probe/')).length;
    faults.K = { maxRows: 400, dropOnFirstPage: true };
    const K = await friend('K');
    await K.goto(base + '?g=' + encodeURIComponent(CODE));
    await until(K, () => document.getElementById('gate').hidden, null, 10000);
    let nK = 0;
    check('Full load in pages; a delete between pages drops nothing else', await poll(async () => (nK = await colSize(K, 'probe')) === onServer(), 10000) && !!faults.K.dropped, nK + '/' + onServer());
    const rows0 = stats.K.rows;
    putRow('probe/zz-new', { fresh: 1 });
    await K.evaluate(() => window.dispatchEvent(new Event('online')));
    check('A refresh after that fetches only what changed, and finds the new one', await poll(async () => (await colSize(K, 'probe')) === onServer(), 5000) && stats.K.rows - rows0 < 500, (stats.K.rows - rows0) + ' rows');
    await K.context().close();
    pages.splice(pages.indexOf(K), 1);
    for (const k of [...srv.docs.keys()]) if (k.startsWith('vrienden|probe/')) srv.docs.delete(k);

    // A late live update (B's proost, sent before A's delete) cannot bring a deleted item back.
    await A.evaluate(async () => { const db = await window.backend.use('db'); await db.doc('tomb/t1').set({ n: 1 }); });
    const liked = Object.assign({}, srv.docs.get('vrienden|tomb/t1'), { data: { n: 1, liked: true }, updated_at: iso() });
    srv.docs.set('vrienden|tomb/t1', liked); // changed on the server; its live event is still on its way
    await A.evaluate(async () => { const db = await window.backend.use('db'); await db.doc('tomb/t1').delete(); });
    await A.evaluate(ev => window.__rtPush(ev), { eventType: 'UPDATE', new: liked });
    await A.waitForTimeout(150);
    check('A late live update after a delete does not bring it back', (await colSize(A, 'tomb')) === 0);
    await A.evaluate(async () => { const db = await window.backend.use('db'); await db.doc('tomb/t1').set({ n: 2 }); });
    check('…and saving it again on the same path does show', (await colSize(A, 'tomb')) === 1);
    await A.evaluate(async () => { const db = await window.backend.use('db'); await db.doc('tomb/t1').delete(); });
    // The other way round: B's proost is saved before A's delete, but its answer only reaches B after it.
    await B.evaluate(async () => { const db = await window.backend.use('db'); await db.doc('tomb/t2').set({ n: 1 }); });
    faults.B = { holdMerge: true };
    await B.evaluate(() => { window.__merge = window.backend.use('db').then(db => db.doc('tomb/t2').update({ liked: true })).then(() => 'ok', e => e.code); });
    await poll(() => held.length > 0, 3000);
    await A.evaluate(async () => { const db = await window.backend.use('db'); await db.doc('tomb/t2').delete(); });
    await poll(async () => (await colSize(B, 'tomb')) === 0, 3000);
    faults.B = {}; releaseWrites();
    await B.evaluate(() => window.__merge);
    await B.waitForTimeout(150);
    check('A late answer to a proost does not bring a deleted item back either', (await colSize(B, 'tomb')) === 0);

    // No reception at all: the registration (with photo) waits on the phone, survives a reload, and
    // goes out exactly once when there is reception, with the time and night of the tap.
    await B.click('#tab-tellen');
    const beforeB = entriesOf(nameB).length, capB = 'offline ' + TAG;
    await B.context().setOffline(true);
    await plus(B, 'Biertjes'); await plus(B, 'Biertjes');
    await B.setInputFiles('#photo-input', PHOTO); await until(B, () => !document.getElementById('photo-prev').hidden);
    await B.fill('#caption', capB);
    await B.click('#btn-reg');
    check('Offline: Registreer says it is kept and goes by itself; counter empties', await toastIs(B, /Geen bereik.*bewaard/) && (await out(B, 'biertjes')) === 0);
    check('Offline: "1 registratie wacht op internet" with Nu proberen; log says "nog niet verstuurd"', await until(B, () => /1 registratie wacht op internet/.test(document.getElementById('banner').textContent) && !!document.getElementById('outbox-retry') && [...document.querySelectorAll('#log .log-row')].some(r => /nog niet verstuurd/.test(r.textContent))));
    if (SHOTS) { await B.waitForTimeout(7500); await B.evaluate(() => window.scrollTo(0, 0)); await B.screenshot({ path: SHOTS + '-offline.png' }); }
    check('Offline: banner lines fit, no sideways scroll', await B.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    let ob = [];
    check('Offline: kept on the phone with its time, night and photo; nothing sent', await poll(async () => { ob = await outbox(B); return ob.length === 1 && /^data:image\//.test(ob[0].photoData || ''); }) && !!ob[0].body.at && !!ob[0].body.night && entriesOf(nameB).length === beforeB);
    await B.click('#outbox-retry');
    check('Offline: Nu proberen says there is no reception yet', await toastIs(B, /Nog geen bereik/));
    // Reception back, but the server cannot be reached yet; then the app is reloaded.
    faults.B = { failWrites: true, failUpload: true };
    await B.context().setOffline(false);
    await B.waitForTimeout(300);
    await B.reload(); await open(B);
    check('After a reload the registration is still waiting, and still shown', await until(B, () => /1 registratie wacht op internet/.test(document.getElementById('banner').textContent) && [...document.querySelectorAll('#log .log-row')].some(r => /nog niet verstuurd/.test(r.textContent))) && entriesOf(nameB).length === beforeB);
    faults.B = {};
    await B.click('#outbox-retry');
    const sentB = () => entriesOf(nameB).filter(r => r.data.caption === capB);
    check('Nu proberen: sent once, with the time and night of the tap, photo included', await poll(() => sentB().length === 1) && sentB()[0].data.at === ob[0].body.at && sentB()[0].data.night === ob[0].body.night && !!sentB()[0].data.photo && entriesOf(nameB).length === beforeB + 1);
    check('Sent: told so, nothing waiting any more', await toastIs(B, /opgeslagen voor/) && (await outbox(B)).length === 0 && !/wacht op internet/.test(await banner(B)));
    check('The other phone sees it', await until(A, async c => { const db = await window.backend.use('db'); return new Promise(r => { const un = db.collection('entries').onSnapshot(s => { un(); r(s.docs.some(d => d.data().caption === c)); }); }); }, capB));

    // Offline (fake clock): after a few seconds the banner says the data may be old, and when the
    // connection is back it goes away by itself.
    await D.context().setOffline(true);
    await D.clock.fastForward(6000);
    check('Offline: banner says "Geen verbinding · bijgewerkt om hh:mm"', await until(D, () => /Geen verbinding · bijgewerkt om \d\d:\d\d/.test(document.getElementById('banner').textContent)));
    await D.context().setOffline(false);
    await D.clock.fastForward(1000);
    check('Back online: the "Geen verbinding" banner goes away by itself', await until(D, () => !/Geen verbinding/.test(document.getElementById('banner').textContent)));

    // A refresh that hangs (stalled connection) is cut off by the time limit, so the next one works.
    faults.D = { hangRead: true };
    await D.evaluate(() => window.dispatchEvent(new Event('online')));
    await D.waitForTimeout(200);
    await D.clock.fastForward(16000);
    faults.D = { noLive: true };
    putRow('probe2/late', { ok: 1 });
    await D.evaluate(() => window.dispatchEvent(new Event('online')));
    check('A refresh that hangs is cut off, and the next one gets the news', await poll(async () => (await colSize(D, 'probe2')) === 1, 5000));
    faults.D = {};
    srv.docs.delete('vrienden|probe2/late');

    // Double tap on "Uitdaging plaatsen" while the network is slow: one challenge, the button says Bezig….
    await A.click('#tab-spel'); await A.click('#seg-ch');
    const chT = TAG + ' dubbel';
    await A.fill('#ch-title', chT);
    faults.A = { delay: 800 };
    await A.dblclick('#ch-submit');
    const busyBtn = await A.evaluate(() => { const b = document.getElementById('ch-submit'); return b.disabled && b.textContent === 'Bezig…'; });
    const chals = () => [...srv.docs.values()].filter(r => r.path.startsWith('challenges/') && r.data.title === chT);
    check('Double tap on "Uitdaging plaatsen" on a slow network: one challenge, button said Bezig…', busyBtn && await toastIs(A, /Uitdaging geplaatst/, 8000) && chals().length === 1 && (await A.inputValue('#ch-title')) === '');
    faults.A = {};
    if (chals()[0]) await A.evaluate(async p => { const db = await window.backend.use('db'); await db.doc(p).delete(); }, chals()[0].path);
  } catch (e) {
    check('saving checks ran to the end', false, e.message.split('\n')[0]);
  }

  // ---------- Spel, confirms, points and toasts (mock only) ----------
  if (MOCK && C) try {
    const toastIs = (p, re, ms) => until(p, src => { const t = document.getElementById('toast'); return !t.hidden && new RegExp(src).test(document.getElementById('toast-text').textContent); }, re.source, ms);
    const idOf = n => memberRow(n).path.split('/')[1];
    const findDoc = (col, pred) => [...srv.docs.values()].find(r => r.path.startsWith(col + '/') && pred(r.data));
    const card = (p, list, t) => p.locator(list + ' .game', { hasText: t });
    const cardText = (p, list, t) => p.evaluate(([l, t]) => { const g = [...document.querySelectorAll(l + ' .game')].find(g => g.innerText.includes(t)); return g ? g.innerText : ''; }, [list, t]);
    // How high the tap area of a button is: still that button 11 px above and below what you see?
    const tapHeight = loc => loc.evaluate(b => {
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, hit = y => { const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
      return hit(r.top - 11) && hit(r.bottom + 11) ? Math.round(r.height + 22) : Math.round(r.height);
    });
    const nameX = TAG + '-X', MINUS = '\u2212';
    // A tap on a toast puts it away (it may cover the button the next step taps).
    const dismiss = p => p.evaluate(() => ['toast', 'toast-prev'].forEach(id => { const t = document.getElementById(id); if (!t.hidden) t.click(); }));

    // Confirms: a tap elsewhere disarms, a double tap only asks, undo brings it back.
    const chT = TAG + ' tafeldans';
    await A.click('#tab-spel'); await A.click('#seg-ch');
    await A.fill('#ch-title', chT); await A.click('#ch-submit');
    await toastIs(A, /Uitdaging geplaatst/);
    const chRow = () => findDoc('challenges', d => d.title === chT);
    const chA = card(A, '#ch-list', chT), chB = card(B, '#ch-list', chT);
    check('Spel: "Verwijder" is at least 40 px high to tap', (await tapHeight(chA.locator('button', { hasText: 'Verwijder' }))) >= 40);
    await chA.locator('button', { hasText: 'Verwijder' }).click();
    const armedDel = () => chA.locator('button', { hasText: 'Ja, verwijder' }).count();
    const armed1 = await armedDel();
    await chA.locator('.game-title').click();
    check('An armed "Ja, verwijder" goes back on a tap anywhere else', armed1 === 1 && await poll(async () => (await armedDel()) === 0));
    await chA.locator('button', { hasText: 'Verwijder' }).dblclick();
    check('Double tap on Verwijder only asks', !!chRow() && (await armedDel()) === 1);
    await A.waitForTimeout(450);
    await chA.locator('button', { hasText: 'Ja, verwijder' }).click();
    check('Challenge deleted, with an undo', await poll(() => !chRow()) && await toastIs(A, /Uitdaging verwijderd/) && await A.evaluate(() => !document.getElementById('toast-undo').hidden));
    await A.click('#toast-undo');
    check('Undo puts the challenge back', await poll(() => !!chRow()) && await until(A, t => [...document.querySelectorAll('#ch-list .game')].some(g => g.innerText.includes(t)), chT));

    // Claims: a double tap claims once, "Ik zag het" can be undone, "Niet gezien" clears the badge.
    await B.click('#tab-spel'); await B.click('#seg-ch');
    const claimB = () => ((chRow() || { data: {} }).data.claims || {})[idOf(nameB)];
    await chB.locator('button', { hasText: 'Ik heb het gedaan' }).dblclick();
    await B.waitForTimeout(300);
    check('Double tap on "Ik heb het gedaan": claimed, and not taken back', !!claimB() && await chB.locator('button', { hasText: /Toch niet gedaan|Intrekken\?/ }).count() === 1);
    const rowA = chA.locator('.claim', { hasText: nameB });
    check('Spel badge: the claim waits for A', await until(A, () => document.getElementById('seg-ch-n').textContent === '1' && !document.getElementById('badge-spel').hidden));
    await rowA.locator('button', { hasText: 'Ik zag het' }).click();
    const confirmedByA = () => { const c = claimB(); return !!c && !!(c.confirms || {})[idOf(nameA)]; };
    check('"Ik zag het" counts, and the toast can undo it', await poll(confirmedByA) && await toastIs(A, /Bevestigd: je zag/));
    await A.click('#toast-undo');
    check('Undo takes the confirmation back (0/2 again)', await poll(() => !!claimB() && !confirmedByA()) && await until(A, t => { const g = [...document.querySelectorAll('#ch-list .game')].find(g => g.innerText.includes(t)); return !!g && /0\/2 bevestigd/.test(g.innerText); }, chT));
    await rowA.locator('button', { hasText: 'Niet gezien' }).click();
    check('"Niet gezien" clears the Spel badge', await until(A, () => document.getElementById('badge-spel').hidden && document.getElementById('seg-ch-n').hidden) && await toastIs(A, /niet gezien/));
    check('The one who claimed sees that someone did not see it', await poll(async () => /1 niet gezien/.test(await cardText(B, '#ch-list', chT))));
    if (SHOTS) { await chA.scrollIntoViewIfNeeded(); await A.screenshot({ path: SHOTS + '-uitdaging.png' }); }
    await chB.locator('.game-title').click(); // puts back anything the double tap armed
    await chB.locator('button', { hasText: 'Toch niet gedaan' }).click();
    check('"Toch niet gedaan" asks first', !!claimB() && await chB.locator('button', { hasText: 'Intrekken?' }).count() === 1);
    await B.waitForTimeout(450);
    await chB.locator('button', { hasText: 'Intrekken?' }).click();
    check('…then takes the claim back, with an undo', await poll(() => !claimB()) && await toastIs(B, /Ingetrokken/));
    await B.click('#toast-undo');
    check('Undo puts the claim back', await poll(() => !!claimB()));
    await dismiss(A);
    await chA.locator('button', { hasText: 'Uitdaging stoppen' }).click();
    check('"Uitdaging stoppen" says what it does', await chA.locator('button', { hasText: 'Daarna kan niemand meer meedoen' }).count() === 1);
    await A.waitForTimeout(450);
    await chA.locator('button', { hasText: 'Daarna kan niemand meer meedoen' }).click();
    check('Stopped, with an undo', await poll(() => chRow().data.closed === true) && await toastIs(A, /Uitdaging gestopt/) && await A.evaluate(() => !document.getElementById('toast-undo').hidden));

    // Predictions: the result is a separate step, it closes betting, a late stake does not count,
    // a vote can be taken back, and schrappen and terugdraaien ask first and can be undone.
    const betT = TAG + ' slaapt eerst';
    await A.click('#seg-bet');
    check('Bet form: the odds say which is Ja and which is Nee', await A.evaluate(() => /Waarschijnlijk · Ja ×1,65 · Nee ×3/.test(document.getElementById('bet-odds').textContent)));
    await A.fill('#bet-title', betT); await A.click('#bet-submit');
    await toastIs(A, /Voorspelling geplaatst/);
    const betRow = () => findDoc('bets', d => d.title === betT);
    const votesOn = () => Object.values((betRow().data.votes) || {}).filter(Boolean).length;
    check('A new bet closes for stakes at the end of the night, and needs 2 votes', await poll(() => !!betRow()) && Date.parse(betRow().data.closedAt) > Date.now() && Date.parse(betRow().data.closedAt) < Date.now() + 32 * 3600 * 1000 && betRow().data.need === 2);
    const betA = card(A, '#bet-list', betT), betB = card(B, '#bet-list', betT);
    await betA.waitFor();
    const jaText = await cardText(A, '#bet-list', betT);
    check('Ja shows what the chosen 10 pnt would win (+7)', /×1,65 · \+7/.test(jaText));
    await betA.locator('button.odd').nth(0).click();
    check('A stakes 10 on Ja', await poll(() => { const s = (betRow().data.stakes || {})[idOf(nameA)]; return !!s && s.side === 'ja' && s.amount === 10; }));
    await B.click('#seg-bet');
    await betB.waitFor();
    check('The result buttons are not next to Ja/Nee: one step away', await betB.locator('button', { hasText: 'het gebeurde' }).count() === 0 && await betB.locator('button', { hasText: 'Uitslag bekend?' }).count() === 1);
    await dismiss(B);
    await betB.locator('button', { hasText: 'Uitslag bekend?' }).dblclick();
    check('Double tap on "Uitslag bekend?" only shows the choice, with a warning', votesOn() === 0 && /na jouw stem kan niemand meer inzetten/.test(await cardText(B, '#bet-list', betT)));
    if (SHOTS) { await betB.scrollIntoViewIfNeeded(); await B.screenshot({ path: SHOTS + '-voorspelling.png' }); }
    await B.waitForTimeout(450);
    await betB.locator('button', { hasText: 'Nee, het gebeurde niet' }).click();
    check('B gives the result: betting is closed for A too', await poll(() => !!(betRow().data.votes || {})[idOf(nameB)]) && await until(A, t => { const g = [...document.querySelectorAll('#bet-list .game')].find(g => g.innerText.includes(t)); return !!g && !g.querySelector('button.odd') && /Inzet gesloten/.test(g.innerText); }, betT));
    // A phone that had not seen the vote yet: its stake reaches the server afterwards.
    const br = betRow(), lateAt = new Date(Date.parse(br.data.votes[idOf(nameB)].at) + 2000).toISOString();
    br.data = Object.assign({}, br.data, { stakes: Object.assign({}, br.data.stakes, { [idOf(nameX)]: { side: 'nee', amount: 50, at: lateAt } }) }); br.updated_at = iso();
    broadcast({ eventType: 'UPDATE', new: br });
    await A.waitForTimeout(400);
    check('A stake placed after the first vote does not count', !(await betA.locator('.odd').nth(1).innerText()).includes(nameX) && /Nog niemand/.test(await betA.locator('.odd').nth(1).innerText()));
    await C.tap('#tab-spel'); await C.tap('#seg-bet');
    check('…and that phone is told its stake does not count', await until(C, t => { const g = [...document.querySelectorAll('#bet-list .game')].find(g => g.innerText.includes(t)); return !!g && /telt niet mee/.test(g.innerText); }, betT));
    const noLate = Object.assign({}, br.data.stakes); delete noLate[idOf(nameX)];
    br.data = Object.assign({}, br.data, { stakes: noLate }); br.updated_at = iso();
    broadcast({ eventType: 'UPDATE', new: br });
    check('A tap on a toast puts it away', await toastIs(B, /Gestemd/) && await B.click('#toast-text').then(() => B.evaluate(() => document.getElementById('toast').hidden)));
    await betB.locator('button', { hasText: 'Stem intrekken' }).click();
    check('Stem intrekken: the bet is open for stakes again', await poll(() => votesOn() === 0) && await until(A, t => { const g = [...document.querySelectorAll('#bet-list .game')].find(g => g.innerText.includes(t)); return !!g && !!g.querySelector('button.odd'); }, betT));
    await dismiss(A);
    await betA.locator('button', { hasText: 'Voorspelling schrappen' }).click();
    check('Schrappen says it is for everyone', await betA.locator('button', { hasText: 'Voor iedereen schrappen?' }).count() === 1);
    await A.waitForTimeout(450);
    await betA.locator('button', { hasText: 'Voor iedereen schrappen?' }).click();
    check('Geschrapt, by whom, with an undo', await poll(() => betRow().data.void === true && betRow().data.voidBy === idOf(nameA)) && await toastIs(A, /geschrapt/));
    await A.click('#toast-undo');
    check('Undo brings the prediction back', await poll(() => betRow().data.void === false));
    await dismiss(A);
    await betA.locator('button', { hasText: 'Uitslag bekend?' }).click();
    await A.waitForTimeout(450);
    await betA.locator('button', { hasText: 'Ja, het gebeurde' }).click();
    await poll(() => votesOn() === 1);
    await dismiss(B);
    await betB.locator('button', { hasText: 'Ja, het gebeurde' }).click();
    check('Two votes settle it', await poll(() => votesOn() === 2) && await until(A, t => { const g = [...document.querySelectorAll('#bet-list .game')].find(g => g.innerText.includes(t)); return !!g && /Uitslag: het gebeurde/.test(g.innerText); }, betT));
    const votesBefore = Object.assign({}, betRow().data.votes);
    await dismiss(A);
    await betA.locator('button', { hasText: 'Uitslag terugdraaien' }).click();
    await A.waitForTimeout(450);
    await betA.locator('button', { hasText: 'Terugdraaien?' }).click();
    const firstAt = Object.values(votesBefore).filter(Boolean).map(v => v.at).sort()[0];
    check('Uitslag terugdraaien: everyone votes again, betting stays closed from the first vote', await poll(() => votesOn() === 0 && betRow().data.closedAt === firstAt) && await until(A, t => { const g = [...document.querySelectorAll('#bet-list .game')].find(g => g.innerText.includes(t)); return !!g && /Inzet gesloten/.test(g.innerText) && !g.querySelector('button.odd'); }, betT));

    await A.setViewportSize({ width: 320, height: 568 });
    const narrowOk = async () => A.evaluate(() => document.documentElement.scrollWidth <= 320);
    const betNarrow = await narrowOk();
    await A.click('#seg-ch');
    check('320 px wide: Spel cards (claims, predictions) fit, no sideways scroll', betNarrow && await narrowOk());
    await A.setViewportSize({ width: 390, height: 844 });

    // Toasts: an error looks different, says what failed and offers Opnieuw; a newer toast does
    // not take away the undo of the one before.
    await A.click('#tab-feed');
    const cap = 'e2e ' + TAG, post = A.locator('.post', { hasText: cap });
    const entry = () => findDoc('entries', d => d.caption === cap);
    const likedA = () => !!((entry().data.likes || {})[idOf(nameA)]);
    const likedBefore = likedA();
    faults.A = { failWrites: true };
    await post.locator('.act').first().click();
    check('A failed proost: red toast, says what failed, with Opnieuw', await until(A, () => { const t = document.getElementById('toast'); return !t.hidden && t.classList.contains('is-err') && /Proosten lukte niet/.test(document.getElementById('toast-text').textContent) && document.getElementById('toast-undo').textContent === 'Opnieuw'; }) && likedA() === likedBefore);
    faults.A = {};
    await A.click('#toast-undo');
    check('Opnieuw sends it again', await poll(() => likedA() !== likedBefore));
    await post.locator('.act').nth(1).click();
    check('Reageer puts the cursor in the comment field', await A.evaluate(() => /^cmt-/.test((document.activeElement || {}).id || '')));
    const cmtText = 'weg ' + TAG, cmtOf = () => Object.values(entry().data.comments || {}).find(c => c && c.text === cmtText);
    await post.locator('.cmt-form input').fill(cmtText);
    await post.locator('.cmt-form input').press('Enter');
    check('A comment sent with Enter shows at once, and the keyboard closes', await until(A, t => [...document.querySelectorAll('.cmt-text')].some(c => c.textContent.includes(t)) && !/^cmt-/.test((document.activeElement || {}).id || ''), cmtText, 1000));
    await post.locator('.cmt', { hasText: cmtText }).waitFor();
    const x = post.locator('.cmt', { hasText: cmtText }).locator('.cmt-del');
    check('Comment ×: at least 40 px high to tap', !!cmtOf() && (await tapHeight(x)) >= 40);
    await x.click();
    check('Comment × deletes it, with an undo', await poll(() => !cmtOf()) && await toastIs(A, /Reactie verwijderd/));
    await A.click('#tab-tellen'); await A.click('#btn-reg', { force: true }); // aria-disabled with an empty counter: a tap says why
    check('A newer toast keeps the earlier undo on its own line', await toastIs(A, /Tel eerst/) && await A.evaluate(() => !document.getElementById('toast-prev').hidden && /Reactie verwijderd/.test(document.getElementById('toast-prev-text').textContent)));
    await A.click('#toast-prev-undo');
    check('…and that undo still works', await poll(() => !!cmtOf()));

    // Points on an iPhone: − / + steppers (a minus works without a keyboard), two taps to save
    // after it says what changes for everyone, undo, and an unsaved change is not left behind.
    await C.tap('#tab-groep');
    const ptOut = k => C.evaluate(k => document.getElementById('pt-' + k).textContent, k);
    const cfg = () => (srv.docs.get('vrienden|config/points') || { data: {} }).data;
    check('Points: steppers, no number field', await C.evaluate(() => !document.querySelector('#points-grid input')) && (await ptOut('barfjes')) === MINUS + '3');
    await C.tap('[aria-label="Barfjes: een punt minder"]'); await C.tap('[aria-label="Barfjes: een punt minder"]');
    check('iPhone: the minus works', (await ptOut('barfjes')) === MINUS + '5');
    await C.tap('#points-save');
    check('Opslaan first says what changes, for everyone and for past nights', await C.evaluate(m => { const t = document.getElementById('points-confirm'); return !t.hidden && t.textContent.includes('Barfjes ' + m + '3 → ' + m + '5') && /vorige avonden/.test(t.textContent) && document.getElementById('points-save').textContent === 'Ja, opslaan voor iedereen'; }, MINUS) && !cfg().values);
    await C.waitForTimeout(450);
    await C.tap('#points-save');
    check('The second tap saves it, only that change', await poll(() => !!cfg().values && cfg().values.barfjes === -5 && cfg().values.biertjes === 1) && await toastIs(C, /Puntentelling opgeslagen/));
    await A.click('#tab-ranglijst');
    check('Ranglijst on another phone says who changed the points', await until(A, n => { const e = document.getElementById('board-points'); return !e.hidden && e.textContent.includes('gewijzigd door ' + n); }, nameX));
    await C.tap('#toast-undo');
    check('Undo puts the old points back', await poll(() => cfg().values.barfjes === -3));
    await C.tap('[aria-label="Biertjes: een punt meer"]');
    check('A change shows Annuleren', await C.evaluate(() => !document.getElementById('points-cancel').hidden && document.getElementById('pt-biertjes').textContent === '+2'));
    await C.tap('#tab-feed');
    check('Leaving Groep with an unsaved change: dropped, and said so', await toastIs(C, /niet opgeslagen/));
    await C.tap('#tab-groep');
    check('…and Groep shows the real points again', (await ptOut('biertjes')) === '+1' && await C.evaluate(() => document.getElementById('points-save').disabled && document.getElementById('points-cancel').hidden));
    check('iPhone, Groep: no sideways scroll', await C.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (SHOTS) await C.screenshot({ path: SHOTS + '-punten-iphone.png', fullPage: true });

    await A.evaluate(async ps => { const db = await window.backend.use('db'); for (const p of ps) await db.doc(p).delete(); }, [chRow().path, betRow().path]);
  } catch (e) {
    check('spel checks ran to the end', false, e.message.split('\n')[0] + ' ' + ((e.stack || '').match(/e2e\.js:\d+/g) || []).join(','));
  }

  // ---------- on a phone: the iPhone pass, photos on bad reception, back button, a feed that stays
  // put, chart tips on touch, emoji in names, the night boundary, fonts and the offline shell (mock only) ----------
  if (MOCK && C) try {
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idOf = n => memberRow(n).path.split('/')[1];
    const addEntry = (n, caption, photo) => A.evaluate(async ([mid, caption, photo]) => {
      const db = await window.backend.use('db'), body = { memberId: mid, by: null, counts: { mixjes: 0, biertjes: 1, shotjes: 0, stelz: 0, wijn: 0, barfjes: 0 }, at: new Date().toISOString(), caption: caption, likes: {}, comments: {} };
      if (photo) { body.photo = photo; body.photoW = 900; body.photoH = 1200; }
      await db.collection('entries').add(body);
    }, [idOf(n), caption, photo || null]);
    const free = [...srv.docs.values()].filter(r => r.path.startsWith('members/') && !r.data.uid && String(r.data.name).startsWith(TAG + '-Vriend')).map(r => r.data.name);
    const photoId = canPhotoAll ? 'vrienden/e2e-' + TAG + '.jpg' : null; // the mock serves the test photo for any name
    const pcap = 'foto ' + TAG;
    if (photoId) await addEntry(nameA, pcap, photoId);

    // iPhone, photos do not load at first (a dip in reception).
    const I = await friend('I', { device: devices['iPhone 13'] });
    await I.route('**/mockphoto/**', r => r.abort());
    await I.goto(base + '?g=' + encodeURIComponent(CODE));
    await until(I, () => document.getElementById('gate').hidden && document.querySelectorAll('#who-chips button').length === 15, null, 10000);
    // 320 px (no name picked yet, empty counter): "Turflijst", the full night date and "Registreren" all fit.
    await I.setViewportSize({ width: 320, height: 568 });
    const hdr = await I.evaluate(() => {
      const t = document.getElementById('brand-title'), b = document.getElementById('btn-reg'), d = document.getElementById('night-date').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect();
      return { ok: b.textContent === 'Registreren' && t.textContent === 'Turflijst' && t.scrollWidth <= t.clientWidth && d.width > 0 && d.right <= br.right + 0.5 && b.getBoundingClientRect().right <= 320 && document.documentElement.scrollWidth <= 320,
        b: b.textContent, d: [d.left, d.right], br: [br.left, br.right] };
    });
    check('320 px wide: "Turflijst", the full night date and "Registreren" fit next to each other', hdr.ok, JSON.stringify(hdr));
    if (SHOTS) await I.screenshot({ path: SHOTS + '-header-320.png' });
    await I.setViewportSize(devices['iPhone 13'].viewport);
    await I.waitForTimeout(650);
    await I.locator('#who-chips button', { hasText: new RegExp('^' + esc(free[0]) + '$') }).tap();
    await until(I, () => document.getElementById('who-card').hidden);
    check('iPhone header: "avond van" goes before your name is shortened, the date stays whole', await I.evaluate(() => {
      const me = document.getElementById('nl-me'), pre = document.getElementById('nl-pre'), d = document.getElementById('night-date').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect();
      return /^Jij: /.test(me.textContent) && (me.scrollWidth <= me.clientWidth + 1 || getComputedStyle(pre).display === 'none') && d.width > 0 && d.right <= br.right + 0.5;
    }));
    check('iPhone: all 15 "Voor wie tel je?" names in view', await I.evaluate(() => { const bs = [...document.querySelectorAll('#for-chips button')]; return bs.length === 15 && bs.every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth; }); }));
    const smallFields = () => I.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(i => !/^(radio|checkbox|file|hidden)$/.test(i.type) && parseFloat(getComputedStyle(i).fontSize) < 16).map(i => i.id || i.className));
    const small = await smallFields();
    check('iPhone: every text field is 16px or more, so tapping it does not zoom in', !small.length, small.join(','));
    const wide = [];
    for (const t of ['spel', 'tellen', 'ranglijst', 'groep', 'feed']) { await I.tap('#tab-' + t); if (!(await I.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) wide.push(t); }
    check('iPhone: no sideways scroll on any tab', !wide.length, wide.join(','));
    await I.tap('#btn-plan');
    check('Planning: date and time have a label that stays ("Hoe laat? (mag leeg)")', await I.evaluate(() => ['ev-title', 'ev-date', 'ev-time'].every(id => { const l = document.getElementById(id).closest('label'); return !!l && l.querySelector('.fld-l').getBoundingClientRect().height > 0; }) && /mag leeg/.test(document.getElementById('ev-time').closest('label').textContent)));
    await I.tap('#ev-cancel');

    // The photo box keeps its shape while the photo is missing, says why, and the photo comes back with reception.
    const post = I.locator('.post', { hasText: pcap });
    // Found and measured in one go: every redraw makes new elements.
    const box = () => I.evaluate(t => { const p = [...document.querySelectorAll('.post')].find(p => p.innerText.includes(t)), r = p.querySelector('.post-photo').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }, pcap);
    if (photoId) {
      await post.scrollIntoViewIfNeeded();
      const missing = await until(I, t => { const p = [...document.querySelectorAll('.post')].find(p => p.innerText.includes(t)); return !!(p && p.querySelector('.photo-missing')); }, pcap, 8000);
      const b0 = await box();
      check('Photo that does not load: says so, in a box of the photo\'s own shape', missing && /laden mislukt/i.test(await post.locator('.photo-missing').textContent()) && Math.abs(b0.h - b0.w * 1200 / 900) <= 2, JSON.stringify(b0));
      await post.locator('.post-photo').tap();
      check('…the big view says so too, instead of a black screen', await until(I, () => !document.getElementById('lightbox').hidden && !document.getElementById('lightbox-msg').hidden));
      await I.evaluate(() => history.back());
      check('Back button closes the photo, and stays in the app', await until(I, () => document.getElementById('lightbox').hidden && document.getElementById('gate').hidden && !document.getElementById('view-feed').hidden) && await I.evaluate(o => location.origin === o, new URL(base).origin));
      await I.unroute('**/mockphoto/**');
      await I.evaluate(() => window.dispatchEvent(new Event('online')));
      const loaded = await until(I, t => { const p = [...document.querySelectorAll('.post')].find(p => p.innerText.includes(t)); const i = p && p.querySelector('.post-img'); return !!(i && i.complete && i.naturalWidth > 0); }, pcap, 8000);
      const b1 = await box();
      check('Reception back: the photo is tried again and shows, the post keeps its size', loaded && Math.abs(b1.h - b0.h) <= 1, JSON.stringify([b0, b1]));
      // A photo opened from a profile: the first back closes the photo, the second the profile.
      await post.locator('.post-who .nm-btn').tap();
      await until(I, () => !document.getElementById('view-profiel').hidden && !!document.querySelector('#view-profiel .grid3 button'));
      await I.locator('#view-profiel .grid3 button').first().tap();
      await until(I, () => !document.getElementById('lightbox').hidden);
      await I.evaluate(() => history.back());
      check('Photo opened in a profile: back closes the photo, the profile stays', await until(I, () => document.getElementById('lightbox').hidden && !document.getElementById('view-profiel').hidden));
      await I.evaluate(() => history.back());
      check('…a second back closes the profile, back on the feed', await until(I, () => document.getElementById('view-profiel').hidden && !document.getElementById('view-feed').hidden));
    }
    // Comments on a phone: Reageer brings up the keyboard at once; Enter shows the comment at once.
    const cpost = I.locator('.post', { hasText: pcap });
    await cpost.locator('.act').nth(1).tap();
    check('iPhone: Reageer puts the cursor in the comment field right away', await I.evaluate(() => /^cmt-/.test((document.activeElement || {}).id || '')) && !(await smallFields()).length);
    await I.keyboard.type('Proost ' + TAG);
    await I.keyboard.press('Enter');
    check('iPhone: a comment sent with Enter shows at once, and the keyboard closes', await until(I, t => [...document.querySelectorAll('.cmt-text')].some(c => c.textContent.includes(t)) && !/^cmt-/.test((document.activeElement || {}).id || ''), 'Proost ' + TAG, 1000));

    // Reading further down while someone else posts: the post you read stays put, a button says there is news.
    const k = await I.evaluate(() => { const n = document.querySelectorAll('#feed > *')[2]; window.scrollBy(0, n.getBoundingClientRect().top - 300); return n.getAttribute('data-k'); });
    await I.waitForTimeout(300);
    const topOf = () => I.evaluate(k => { const n = [...document.querySelectorAll('#feed > *')].find(x => x.getAttribute('data-k') === k); return n ? Math.round(n.getBoundingClientRect().top) : null; }, k);
    const t0 = await topOf();
    await addEntry(nameB, 'nieuw ' + TAG);
    const arrived = await until(I, t => [...document.querySelectorAll('.post')].some(p => p.innerText.includes(t)), 'nieuw ' + TAG, 8000);
    const t1 = await topOf();
    check('Feed: a new post above does not move the one you are reading', arrived && t0 !== null && Math.abs(t1 - t0) <= 1, t0 + ' -> ' + t1);
    check('…a button says "↑ 1 nieuw"', await until(I, () => { const b = document.getElementById('feed-new'); return !b.hidden && /1 nieuw/.test(b.textContent); }));
    await I.tap('#feed-new');
    check('…a tap on it goes to the top, and the button goes away', await until(I, () => window.scrollY < 5 && document.getElementById('feed-new').hidden, null, 4000));

    // Chart tips on touch: shown on a tap, gone on a tap elsewhere or when the swipe becomes scrolling.
    const tipShown = sel => I.evaluate(sel => [...document.querySelectorAll(sel + ' .tip')].some(t => !t.hidden), sel);
    await I.tap('#tab-ranglijst'); await I.tap('#seg-altijd');
    await until(I, () => !!document.querySelector('#trend-sec svg .ch-line'));
    await I.evaluate(() => document.querySelector('#trend-sec .legend').scrollIntoView({ block: 'start' }));
    await I.waitForTimeout(200);
    const tb = await I.locator('#trend-sec svg').boundingBox();
    await I.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
    check('Chart on a phone: a tap shows the tip', await tipShown('#trend-sec'));
    await I.locator('#trend-sec .legend').tap();
    check('…a tap elsewhere hides it', !(await tipShown('#trend-sec')));
    await I.locator('#board .row').filter({ has: I.locator('.nm', { hasText: new RegExp('^' + esc(nameA) + '$') }) }).tap();
    await until(I, () => document.querySelectorAll('#view-profiel .ch-hit').length >= 2);
    const hits = I.locator('#view-profiel .ch-hit');
    await hits.nth(0).tap(); await hits.nth(1).tap();
    check('Bar chart on a phone: one bar lit at a time, with its tip', await I.evaluate(() => document.querySelectorAll('#view-profiel .ch-bar.lift').length === 1) && await tipShown('#view-profiel'));
    await I.evaluate(() => document.querySelector('#view-profiel .chart svg').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch' })));
    check('…a swipe that turns into scrolling hides the tip and the lit bar', !(await tipShown('#view-profiel')) && await I.evaluate(() => !document.querySelector('#view-profiel .ch-bar.lift')));
    await I.evaluate(() => history.back());
    check('Back button closes a profile, back on the same tab', await until(I, () => document.getElementById('view-profiel').hidden && !document.getElementById('view-ranglijst').hidden));

    // Emoji in names: initials from the letters, and a name is never cut through an emoji.
    const oid = idOf(free[1]);
    const rename = n => A.evaluate(async ([id, n]) => { const db = await window.backend.use('db'); await db.doc('members/' + id).update({ name: n }); }, [oid, n]);
    const rowOf = src => until(I, src => [...document.querySelectorAll('#board .row')].some(r => new RegExp(src, 'u').test(r.querySelector('.nm').textContent)), src);
    const avatarOf = src => I.evaluate(src => { const r = [...document.querySelectorAll('#board .row')].find(r => new RegExp(src, 'u').test(r.querySelector('.nm').textContent)); return r ? r.querySelector('.av').textContent : null; }, src);
    await rename('🍺 Jan');
    check('Emoji in a name: "🍺 Jan" gets JA as initials, like "Jan"', await rowOf('^🍺 Jan$') && (await avatarOf('^🍺 Jan$')) === 'JA', await avatarOf('^🍺 Jan$'));
    await rename('Sem 🍻');
    check('…and "Sem 🍻" gets SE', await rowOf('^Sem 🍻$') && (await avatarOf('^Sem 🍻$')) === 'SE');
    await rename('J' + '🍺'.repeat(12));
    check('…a name that is too long is cut between two emoji, not through one', await rowOf('^J🍺') && await I.evaluate(() => [...document.querySelectorAll('#board .row .nm')].some(n => n.textContent === 'J' + '🍺'.repeat(11))));
    await rename(free[1]);
    await I.context().close();

    // The night ends at 07:00 on the clock, also when the clocks change; an agenda item stays during its night.
    const T = await friend('T', { clock: true, clockAt: new Date('2026-10-23T22:30:00Z'), ctx: { timezoneId: 'Europe/Amsterdam' } });
    await T.goto(base + '?g=' + encodeURIComponent(CODE));
    await until(T, () => document.getElementById('gate').hidden, null, 10000);
    const evPath = 'events/dst' + TAG.slice(5), evRow = { grp: 'vrienden', path: evPath, collection: 'events', updated_at: iso(),
      data: { title: 'Feest ' + TAG, date: '2026-10-23', time: '22:00', createdBy: idOf(nameA), by: null, at: '2026-10-20T10:00:00.000Z', going: {} } };
    srv.docs.set('vrienden|' + evPath, evRow); broadcast({ eventType: 'INSERT', new: evRow });
    const evShown = () => T.evaluate(t => [...document.querySelectorAll('#events .event')].some(e => e.innerText.includes(t)), 'Feest ' + TAG);
    await T.click('#tab-feed');
    check('Agenda: a party from Friday 22:00 is still there at 00:30, as "Nu bezig"', await until(T, t => [...document.querySelectorAll('#events .event')].some(e => e.innerText.includes(t) && e.querySelector('.cd').getAttribute('aria-label') === 'Nu bezig'), 'Feest ' + TAG));
    await T.context().clock.setSystemTime(new Date('2026-10-24T05:00:00Z'));
    await T.click('#tab-tellen'); await T.click('#tab-feed');
    check('…and gone at 07:00, when that night is over', !(await evShown()));
    const nightNow = () => T.evaluate(() => document.getElementById('night-date').textContent);
    const label = (y, m, d) => T.evaluate(([y, m, d]) => new Date(y, m - 1, d).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }), [y, m, d]);
    await T.context().clock.setSystemTime(new Date('2026-10-25T05:30:00Z')); // 06:30, the night the clocks go back
    await T.click('#tab-tellen');
    check('Night the clocks go back: 06:30 still counts for Saturday', (await nightNow()) === await label(2026, 10, 24), await nightNow());
    await T.context().clock.setSystemTime(new Date('2027-03-28T05:30:00Z')); // 07:30, the night the clocks go forward
    await T.click('#tab-feed'); await T.click('#tab-tellen');
    check('Night the clocks go forward: 07:30 is already the next day', (await nightNow()) === await label(2027, 3, 28), await nightNow());
    srv.docs.delete('vrienden|' + evPath); broadcast({ eventType: 'DELETE', old: { grp: 'vrienden', path: evPath } });
    await T.context().close();

    // Google Fonts that never answer do not hold up the app (it uses the system fonts).
    const Fo = await friend('Fo');
    await Fo.route(u => u.hostname === 'fonts.googleapis.com', () => {});
    const f0 = Date.now();
    await Fo.goto(base, { waitUntil: 'domcontentloaded' });
    check('Fonts that never arrive do not hold up the app', await until(Fo, () => !!window.backend && !document.getElementById('gate-code').hidden, null, 3000), (Date.now() - f0) + ' ms');
    await Fo.context().close();

    // The app opens without any reception (from the service worker), and with reception always gets the newest files.
    const W = await friend('W', { sw: true });
    await W.goto(base + '?g=' + encodeURIComponent(CODE));
    await until(W, () => document.getElementById('gate').hidden, null, 10000);
    const controlled = await W.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100)); return !!navigator.serviceWorker.controller; });
    web.down = true;
    let shell = false;
    try { await W.reload(); shell = await until(W, () => !!window.backend && !!document.querySelector('.gate-logo') && document.title === 'Turflijst', null, 5000); } catch (e) { shell = false; }
    web.down = false;
    check('No reception at all: the app still opens (no browser error page)', controlled && shell);
    const before = web.hits['/app.js'] || 0;
    await W.reload();
    check('With reception again the newest app.js is fetched, not the stored copy', (web.hits['/app.js'] || 0) > before && await until(W, () => !!window.backend));
    await W.context().close();
  } catch (e) {
    web.down = false;
    check('mobile checks ran to the end', false, e.message.split('\n')[0] + ' ' + ((e.stack || '').match(/e2e\.js:\d+/g) || []).join(','));
  }

  // ---------- clean up what this test created ----------
  try {
    const removed = await A.evaluate(async prefix => {
      const db = await window.backend.use('db'), assets = await window.backend.use('assets');
      const snap = col => new Promise(r => { const un = db.collection(col).onSnapshot(s => { un(); r(s.docs.map(d => ({ id: d.id, data: d.data() }))); }); });
      const ms = (await snap('members')).filter(m => String(m.data.name || '').startsWith(prefix));
      const ids = new Set(ms.map(m => m.id));
      const es = (await snap('entries')).filter(e => ids.has(e.data.memberId));
      for (const e of es) { if (e.data.photo && assets) await assets.delete(e.data.photo).catch(() => {}); await db.doc('entries/' + e.id).delete(); }
      for (const m of ms) await db.doc('members/' + m.id).delete();
      return ms.length + ' names, ' + es.length + ' registrations';
    }, TAG);
    check('Test data removed', true, removed);
    if (MOCK) check('A device whose name was deleted is told so', await until(B, () => !document.getElementById('toast').hidden && /uit de groep gehaald/.test(document.getElementById('toast-text').textContent)));
    check('B sees removal live', await until(B, t => !document.body.innerText.includes(t), TAG, 10000));
  } catch (e) {
    check('Test data removed', false, e.message.split('\n')[0]);
  }
  console.log((MOCK ? 'MOCK' : 'REAL') + ' run, tag ' + TAG);
  console.log(results.join('\n'));
  console.log(errors.length ? 'Browser errors:\n' + errors.join('\n') : 'No browser errors');
  await browser.close(); server.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
