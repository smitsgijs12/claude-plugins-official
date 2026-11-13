// End-to-end test: two friends in two separate browsers.
//   node tools/e2e.js --mock                 against a simulated Supabase (no setup needed)
//   node tools/e2e.js --real --code=XXXX     against the Supabase project in config.js
// The real run creates two members named "Test-…", checks everything live, then deletes
// what it created (members, registrations, the photo). Needs Playwright with Chromium.
const { chromium } = require('playwright');
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
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
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
function broadcast(ev) { pages.forEach(p => p.evaluate(e => window.__rtPush && window.__rtPush(e), ev).catch(() => {})); }
function handle(raw) {
  const q = JSON.parse(raw), uid = q.uid;
  if (q.kind === 'rpc' && q.name === 'join_group') {
    const g = Object.values(srv.groups).find(x => x.code === String(q.params.p_code).trim());
    if (!g) return { data: null, error: null };
    srv.access.add(uid + '|' + g.id); return { data: g.id, error: null };
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
  if (q.kind === 'track') {
    const room = srv.presence[q.room] || (srv.presence[q.room] = {}); room[q.key] = [q.meta];
    broadcast({ type: 'presence', room: q.room, state: room }); return { data: 'ok' };
  }
  const d = q.d, f = Object.fromEntries(d.filters);
  if (d.table === 'group_access') return { data: [...srv.access].map(s => s.split('|')).filter(([u]) => u === f.user_id).map(([, g]) => ({ grp: g })).slice(0, d.limit || 1000), error: null };
  if (d.table === 'groups') { const g = srv.groups[f.id]; return { data: g && member(uid, g.id) ? g : null, error: null }; }
  if (d.table === 'docs') {
    if (!member(uid, f.grp || (d.row && d.row.grp))) return d.op === 'select' ? { data: [], error: null } : { data: null, error: { code: '42501', message: 'rls' } };
    if (d.op === 'select') { const rows = [...srv.docs.values()].filter(r => r.grp === f.grp).sort((a, b) => a.path < b.path ? -1 : 1); const [a, z] = d.range || [0, 999]; return { data: rows.slice(a, z + 1), error: null }; }
    if (d.op === 'upsert') { const r = d.row, k = r.grp + '|' + r.path, existed = srv.docs.has(k); const row = { grp: r.grp, path: r.path, collection: r.collection, data: r.data, updated_at: iso() }; srv.docs.set(k, row); broadcast({ eventType: existed ? 'UPDATE' : 'INSERT', new: row }); return { data: row, error: null }; }
    if (d.op === 'delete') { srv.docs.delete(f.grp + '|' + f.path); broadcast({ eventType: 'DELETE', old: { grp: f.grp, path: f.path } }); return { data: null, error: null }; }
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
  async function friend(label) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    if (MOCK) {
      await ctx.exposeFunction('__srv', raw => JSON.stringify(handle(raw)));
      await ctx.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8') }));
      await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.TURFLIJST_CONFIG={supabaseUrl:"https://mock.supabase.co",supabaseKey:"pk_test"};' }));
      await ctx.route('**/mockphoto/**', r => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(PHOTO) }));
    }
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(label + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|ERR_NAME/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
    pages.push(p);
    return p;
  }
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 8000 }).then(() => true, () => false);
  const A = await friend('A'), B = await friend('B');
  const nameA = TAG + '-A', nameB = TAG + '-B';
  try {
    await A.goto(base + '#join=' + encodeURIComponent(CODE));
    check('A joins via invite link', await until(A, () => document.getElementById('gate').hidden && !!document.getElementById('who-add-name')));
    check('A link code removed from address bar', await A.evaluate(() => location.hash === ''));
    await until(A, () => !document.getElementById('who-card').hidden);
    await A.fill('#who-add-name', nameA); await A.click('#who-add-btn');
    check('A added and picked own name', await until(A, n => document.getElementById('who-card').hidden && document.body.innerText.includes(n), nameA));
    await A.click('#tab-groep');
    await A.fill('#add-member-name', nameB); await A.click('#add-member-btn');
    check('A added second name', await until(A, n => document.getElementById('members').innerText.includes(n), nameB));
    check('Invite link shown', (await A.inputValue('#invite-link')).includes('#join='));

    await B.goto(base);
    check('B without link sees code screen', await until(B, () => !document.getElementById('gate-code').hidden));
    await B.fill('#gate-input', 'FOUT-' + TAG); await B.click('#gate-submit');
    check('B wrong code is refused', await until(B, () => !document.getElementById('gate-error').hidden));
    await B.fill('#gate-input', CODE); await B.click('#gate-submit');
    check('B joins with code', await until(B, () => document.getElementById('gate').hidden));
    await until(B, n => [...document.querySelectorAll('#who-chips button')].some(b => b.textContent.includes(n)), nameB, 10000);
    await B.click(`#who-chips button:has-text("${nameB}")`);
    check('A sees B claimed the name live', await until(A, n => [...document.querySelectorAll('.member')].some(r => r.innerText.includes(n) && r.innerText.includes('ander account')), nameB, 10000));

    for (let i = 0; i < 3; i++) await B.click('[aria-label="Biertjes plus één"]');
    const canPhoto = await B.evaluate(() => !document.getElementById('photo-btn').hidden);
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
