// Tests supabase/setup.sql in PGlite (Postgres in WebAssembly) with a small stand-in for
// Supabase's auth and storage schemas. Nothing is installed in this repo; put PGlite in
// any folder and pass that folder:
//
//   mkdir -p /tmp/pglite && (cd /tmp/pglite && npm i @electric-sql/pglite)
//   node tools/sql-test.mjs /tmp/pglite [path/to/setup.sql]
//
// or set PGLITE_DIR=/tmp/pglite. Prints PASS/FAIL per check; exits with 1 on any FAIL.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pgDir = process.argv[2] || process.env.PGLITE_DIR;
const sqlPath = process.argv[3] || path.join(here, '..', 'supabase', 'setup.sql');
if (!pgDir) {
  console.error('Usage: node tools/sql-test.mjs <folder with @electric-sql/pglite installed> [setup.sql]');
  process.exit(2);
}
const { PGlite } = createRequire(path.join(path.resolve(pgDir), 'package.json'))('@electric-sql/pglite');

const PLACEHOLDER = 'KIES-EEN-' + 'GROEPSCODE';
const RAW = fs.readFileSync(sqlPath, 'utf8');
const withCode = code => RAW.replaceAll(PLACEHOLDER, code);
const SQL = withCode('  test-code ');  // lower case and spaces on purpose: stored as TEST-CODE

// Roughly what a fresh Supabase project has: roles, auth.uid(), storage, the realtime
// publication, and default grants to anon/authenticated on everything new in public.
const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id serial primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create publication supabase_realtime;
grant usage on schema public, auth, storage to authenticated, anon;
grant select, insert, delete on storage.objects to authenticated;
grant usage on all sequences in schema storage to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;
async function freshDb() { const db = new PGlite(); await db.exec(STUB); return db; }

const out = [];
let failed = 0, finished = false;
// Print results also when a statement crashes the run halfway.
process.on('exit', code => {
  console.log(out.join('\n'));
  if (!finished) console.log('\nStopped early (see the error above)');
  else console.log(failed ? `\n${failed} FAILED` : `\nAll ${out.length} checks PASS`);
  if (!finished || failed) process.exitCode = 1;
});
const ok = (name, cond) => { if (!cond) failed++; out.push((cond ? 'PASS ' : 'FAIL ') + name); };
async function fails(name, fn, test) {
  try { await fn(); ok(name, false); }
  catch (e) { ok(name, test ? !!test(e) : true); if (test && !test(e)) out.push('     got: ' + (e.code || '') + ' ' + e.message); }
}
function mkAs(db) {
  return async function as(uid, q, params) {
    if (uid === 'anon') await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    else await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    try { return await db.query(q, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  };
}
const U = n => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n.repeat(12)}`;
const A = U('1'), B = U('2'), C = U('3'), D = U('4'), E = U('5'), X = U('6');
const denied = e => /permission denied/i.test(e.message);
const lastRows = res => res[res.length - 1].rows;
const sleep = ms => new Promise(f => setTimeout(f, ms));
const canon = v => v && typeof v === 'object' && !Array.isArray(v)
  ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
const same = (a, b) => canon(a) === canon(b);

// ---------- the example code is refused, and the file can be filled in safely ----------
ok('example code appears exactly once in setup.sql (safe to search-and-replace)', RAW.split(PLACEHOLDER).length === 2);
{
  const db = await freshDb();
  await fails('unedited setup.sql refuses to create the group', () => db.exec(RAW),
    e => e.code === '22023' && /voorbeeldcode/.test(e.message) && /jullie groep/.test(e.hint || ''));
  const r = await db.query(`select to_regclass('public.groups') is null as gone`);
  ok('nothing is created with the example code', r.rows[0].gone === true
    || (await db.query(`select count(*)::int n from public.groups`)).rows[0].n === 0);
  await fails('a code under 8 characters is refused at setup', () => db.exec(withCode('kort 12')), e => /korter dan 8/.test(e.message));
  await fails('the README example code is refused at setup', () => db.exec(withCode('nieuwe-groepscode')), e => /voorbeeldcode/.test(e.message));
}

// ---------- main database ----------
const db = await freshDb();
const as = mkAs(db);
let res = await db.exec(SQL);
ok('setup result shows the stored code', lastRows(res)[0].groepscode === 'TEST-CODE' && lastRows(res)[0].controle === 'In orde');
res = await db.exec(SQL); // second run
ok('second run succeeds', lastRows(res)[0].groepscode === 'TEST-CODE');
res = await db.exec(RAW); // update from the repo: example code still in the file
ok('re-run with the example code keeps the existing code', lastRows(res)[0].groepscode === 'TEST-CODE');
res = await db.exec(withCode('ANDERE-CODE-123'));
ok('re-run with another code keeps the existing code', lastRows(res)[0].groepscode === 'TEST-CODE');

await db.exec(`grant select, insert, update, delete on public.docs, public.groups, public.group_access to authenticated;
insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}'), ('${E}'), ('${X}');
insert into public.groups (id, code) values ('ander', 'andere groep');`);

// not a member yet: cannot read or write
let r = await as(A, `select count(*)::int n from public.docs`); ok('non-member reads nothing', r.rows[0].n === 0);
await fails('non-member insert blocked', () => as(A, `insert into public.docs (grp, path, collection, data) values ('vrienden','members/x','members','{}')`), e => /row-level security/.test(e.message));
r = await as(A, `select public.join_group('fout') g`); ok('wrong code returns null', r.rows[0].g === null);
r = await as(A, `select public.join_group(' TEST-CODE ') g`); ok('right code joins', r.rows[0].g === 'vrienden');
r = await as(B, `select public.join_group('TEST-CODE') g`); ok('second user joins', r.rows[0].g === 'vrienden');
r = await as(C, `select public.join_group($1) g`, ['\t test-code\u200b\u00a0']); ok('code ignores case, tabs and invisible characters', r.rows[0].g === 'vrienden');
{ // same result as normCode() in backend.js for odd whitespace and invisible characters
  const normCode = c => String(c == null ? '' : c).replace(/[\u200B-\u200F\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const samples = ['\u3000ab\u2003 cd\u202f', ' x\u200dy\u00a0z\n', 'a\u2028b\u205fc\u1680d', '\ufeffBier 2026  '];
  const got = await Promise.all(samples.map(x => db.query(`select public.norm_group_code($1) n`, [x]).then(q => q.rows[0].n)));
  ok('server normalises codes exactly like the app', got.every((n, i) => n === normCode(samples[i])));
}
r = await db.query(`select count(*)::int n from public.groups where code = 'ANDERE GROEP'`); ok('codes are stored upper case', r.rows[0].n === 1);
r = await as(C, `select public.join_group('andere   groep') g`); ok('extra inner spaces do not matter', r.rows[0].g === 'ander');
await db.exec(`delete from public.group_access where user_id = '${C}' and grp = 'ander'`);
r = await as(X, `select public.join_group('TESTCODE') g`); ok('a missing dash is still a wrong code', r.rows[0].g === null);
await fails('anon cannot call join_group', () => as('anon', `select public.join_group('TEST-CODE')`), denied);
await fails('app cannot call the code helpers', () => as(A, `select public.group_code_problem('x')`), denied);

await as(A, `insert into public.docs (grp, path, collection, data) values ('vrienden','entries/e1','entries','{"memberId":"m1","likes":{},"comments":{}}')`);
r = await as(B, `select public.doc_merge('vrienden','entries/e1','{"likes":{"m2":true}}'::jsonb) x`);
r = await as(A, `select public.doc_merge('vrienden','entries/e1','{"likes":{"m1":true},"comments":{"c1":{"text":"hoi"}}}'::jsonb) x`);
const merged = r.rows[0].x;
ok('nested merge keeps both likes', merged.data.likes.m1 === true && merged.data.likes.m2 === true && merged.data.comments.c1.text === 'hoi' && merged.data.memberId === 'm1');
ok('merge returns updated_at', typeof merged.updated_at === 'string');
r = await as(A, `select public.doc_merge('vrienden','entries/e1','{"comments":{"c1":null}}'::jsonb) x`);
ok('null replaces a value', r.rows[0].x.data.comments.c1 === null);
await fails('merge on missing doc fails', () => as(A, `select public.doc_merge('vrienden','entries/nope','{}'::jsonb)`), e => /does not exist/.test(e.message));
r = await as(B, `select updated_by::text u from public.docs where path='entries/e1'`); ok('updated_by set by trigger', r.rows[0].u === A);
// other group isolation
await db.exec(`insert into public.docs (grp, path, collection, data) values ('ander','members/z','members','{"name":"Z"}')`);
r = await as(A, `select count(*)::int n from public.docs where grp='ander'`); ok('other group invisible', r.rows[0].n === 0);
await fails('cannot merge into other group', () => as(A, `select public.doc_merge('ander','members/z','{"name":"hack"}'::jsonb)`));
r = await as(A, `select data->>'name' n from public.docs where path='members/z'`); ok('other group unchanged', r.rows.length === 0);
r = await db.query(`select data->>'name' n from public.docs where path='members/z'`); ok('other group data intact (superuser view)', r.rows[0].n === 'Z');
// photos
await as(A, `insert into storage.objects (bucket_id, name) values ('photos','vrienden/a.jpg')`); ok('member uploads to own group folder', true);
await fails('upload to other folder blocked', () => as(A, `insert into storage.objects (bucket_id, name) values ('photos','ander/b.jpg')`));
r = await as(A, `select count(*)::int n from public.groups`); ok('member sees own group only', r.rows[0].n === 1);
r = await as(A, `select code from public.groups`); ok('member can read invite code', r.rows[0].code === 'TEST-CODE');
r = await db.query(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='docs'`); ok('docs in realtime publication', r.rows[0].n === 1);
r = await db.query(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename in ('docs_history','join_misses')`);
ok('history and misses are not published', r.rows[0].n === 0);

// ---------- photo delete really deletes (storage runs DELETE ... RETURNING) ----------
await db.exec(`insert into storage.objects (bucket_id, name) values ('photos','vrienden/b.jpg'), ('photos','ander/z.jpg')`);
r = await as(B, `delete from storage.objects where bucket_id = 'photos' and name = 'vrienden/b.jpg' returning name`);
ok('member deletes a photo and gets it back from RETURNING', r.rows.length === 1);
r = await db.query(`select count(*)::int n from storage.objects where name = 'vrienden/b.jpg'`); ok('photo is gone after delete', r.rows[0].n === 0);
r = await as(A, `select name from storage.objects order by name`); ok('member sees only own group photos', r.rows.map(x => x.name).join() === 'vrienden/a.jpg');
r = await as(A, `delete from storage.objects where name = 'ander/z.jpg' returning name`); ok('member cannot delete other group photo', r.rows.length === 0);
r = await as(X, `select count(*)::int n from storage.objects`); ok('non-member sees no photos', r.rows[0].n === 0);
r = await as(X, `delete from storage.objects where name = 'vrienden/a.jpg' returning name`); ok('non-member cannot delete photos', r.rows.length === 0);
r = await db.query(`select count(*)::int n from storage.objects where name in ('vrienden/a.jpg','ander/z.jpg')`); ok('other photos intact', r.rows[0].n === 2);

// ---------- rate limit on wrong codes ----------
for (let i = 1; i <= 9; i++) await as(D, `select public.join_group($1)`, ['gok-nummer-' + i]);
for (let i = 0; i < 5; i++) await as(D, `select public.join_group('gok-nummer-1')`);
r = await db.query(`select count(*)::int n from public.join_misses where user_id = '${D}'`); ok('the same wrong code counts once', r.rows[0].n === 9);
r = await as(D, `select public.join_group('gok-nummer-10') g`); ok('10th wrong code still returns null', r.rows[0].g === null);
await fails('11th different wrong code raises TL429', () => as(D, `select public.join_group('gok-nummer-11')`), e => {
  const s = +(/retry_after_seconds=(\d+)/.exec(e.detail || '') || [])[1];
  return e.code === 'TL429' && e.message === 'too_many_attempts' && /Te vaak geprobeerd/.test(e.hint || '') && s >= 1 && s <= 600;
});
await fails('right code is refused while locked', () => as(D, `select public.join_group('TEST-CODE')`), e => e.code === 'TL429');
r = await as(D, `select public.join_group('gok-nummer-3') g`); ok('an old wrong code again just returns null', r.rows[0].g === null);
r = await as(E, `select public.join_group('iets anders') g`); ok('other logins are not locked', r.rows[0].g === null);
await db.exec(`update public.join_misses set at = at - interval '11 minutes' where user_id = '${D}'`);
r = await as(D, `select public.join_group('test-code') g`); ok('after 10 minutes the right code works again', r.rows[0].g === 'vrienden');
await db.exec(`insert into public.join_misses (user_id, code_hash, at)
  select '${E}', md5('dag' || i), now() - interval '23 hours' + i * interval '1 minute' from generate_series(1, 30) i`);
await fails('30 wrong codes in a day lock for longer', () => as(E, `select public.join_group('nog een gok')`), e => {
  const s = +(/retry_after_seconds=(\d+)/.exec(e.detail || '') || [])[1];
  return e.code === 'TL429' && s > 600;
});
await db.exec(`insert into public.join_misses (user_id, code_hash) select '${A}', md5('a' || i) from generate_series(1, 10) i`);
r = await as(A, `select public.join_group('TEST-CODE') g`); ok('a member with the right code is never locked out', r.rows[0].g === 'vrienden');
await fails('a member guessing other codes is limited too', () => as(A, `select public.join_group('ander geheim')`), e => e.code === 'TL429');
await db.exec(`delete from public.join_misses where user_id = '${A}'; insert into public.join_misses (user_id, code_hash, at) values ('${X}', 'oud', now() - interval '25 hours')`);
await as(X, `select public.join_group('nog fouter')`);
r = await db.query(`select count(*)::int n from public.join_misses where code_hash = 'oud'`); ok('misses older than a day are cleaned up', r.rows[0].n === 0);
await fails('app cannot read join_misses', () => as(X, `select * from public.join_misses`), denied);

// ---------- group code rules ----------
await fails('changing a code to under 8 characters is refused', () => db.exec(`update public.groups set code = 'kort' where id = 'ander'`), e => /korter dan 8/.test(e.message));
await fails('changing a code to the example code is refused', () => db.query(`update public.groups set code = $1 where id = 'ander'`, [PLACEHOLDER.toLowerCase()]), e => /voorbeeldcode/.test(e.message));
await fails('the README example for a new code is refused as is', () => db.exec(`update public.groups set code = 'NIEUWE-GROEPSCODE' where id = 'ander'`), e => /voorbeeldcode/.test(e.message));
await db.exec(`update public.groups set code = '  andere   groep 2 ' where id = 'ander'`);
r = await db.query(`select code from public.groups where id = 'ander'`); ok('changed code is stored normalised', r.rows[0].code === 'ANDERE GROEP 2');

// ---------- history of overwritten and deleted documents ----------
r = await db.query(`select op, data, changed_by::text b, was_by::text w from public.docs_history where path = 'entries/e1' order by id`);
ok('every merge keeps the old version', r.rows.length === 3 && r.rows.every(x => x.op === 'update'));
ok('history has the original data, who changed it and who wrote it', same(r.rows[0].data, { memberId: 'm1', likes: {}, comments: {} })
  && r.rows[0].b === B && r.rows[0].w === A);
await as(A, `update public.docs set data = data where path = 'entries/e1'`);
r = await db.query(`select count(*)::int n from public.docs_history where path = 'entries/e1'`); ok('an update without changes is not stored', r.rows[0].n === 3);
await as(A, `insert into public.docs (grp, path, collection, data) values ('vrienden', 'members/m1', 'members', $1)`, [JSON.stringify({ name: 'Anna', uid: A })]);
// PGlite's clock has millisecond steps: pause so "before" is strictly between the changes.
await sleep(5);
const before = (await db.query(`select now()::text t`)).rows[0].t;
await sleep(5);
await as(B, `delete from public.docs where grp = 'vrienden' and path = 'entries/e1'`);
r = await db.query(`select op, changed_by::text b, data from public.docs_history where path = 'entries/e1' order by id desc limit 1`);
ok('a delete keeps the deleted document', r.rows[0].op === 'delete' && r.rows[0].b === B && r.rows[0].data.likes.m1 === true);
await fails('app cannot read history', () => as(A, `select * from public.docs_history`), denied);
await fails('app cannot write history', () => as(A, `insert into public.docs_history (grp, path, collection, data, op) values ('vrienden','x','x','{}','delete')`), denied);
await fails('app cannot clear history', () => as(A, `delete from public.docs_history`), denied);
await fails('app cannot prune history', () => as(A, `select public.docs_history_prune()`), denied);
// README "Wie heeft dat gedaan?"
r = await db.query(`select h.changed_at, h.op, h.path, coalesce(m.data->>'name', h.changed_by::text, 'SQL Editor') as wie
  from public.docs_history h
  left join public.docs m on m.grp = h.grp and m.collection = 'members' and m.data->>'uid' = h.changed_by::text
 where h.grp = 'vrienden' and h.changed_at > now() - interval '1 day'
 order by h.changed_at desc, h.id desc limit 100`);
ok('README query shows who changed what', r.rows[0].path === 'entries/e1' && r.rows[0].wie === B && r.rows.some(x => x.wie === 'Anna'));
// README "Iets kwijt?" restore
await db.query(`insert into public.docs (grp, path, collection, data)
select distinct on (path) grp, path, collection, data
  from public.docs_history
 where grp = 'vrienden' and changed_at > $1::timestamptz
 order by path, changed_at, id
on conflict (grp, path) do update set data = excluded.data`, [before]);
r = await as(A, `select data from public.docs where path = 'entries/e1'`);
ok('README restore query brings a deleted document back', r.rows.length === 1 && r.rows[0].data.likes.m2 === true && r.rows[0].data.memberId === 'm1');
await db.exec(`insert into public.docs_history (grp, path, collection, data, op, changed_at) values
  ('vrienden', 'old/u', 'old', '{}', 'update', now() - interval '31 days'),
  ('vrienden', 'old/d', 'old', '{}', 'delete', now() - interval '31 days'),
  ('vrienden', 'old/dd', 'old', '{}', 'delete', now() - interval '181 days')`);
r = await db.query(`select public.docs_history_prune() n`);
const left = (await db.query(`select string_agg(path, ',') p from public.docs_history where collection = 'old'`)).rows[0].p;
ok('prune drops old updates (30 days) and old deletes (180 days)', r.rows[0].n === 2 && left === 'old/d');

// ---------- no wiping everything in one request ----------
await as(A, `insert into public.docs (grp, path, collection, data) select 'vrienden', 'bulk/' || i, 'bulk', '{}' from generate_series(1, 8) i`);
await fails('app cannot delete more than 5 documents at once', () => as(A, `delete from public.docs where grp = 'vrienden' and collection = 'bulk'`), e => /Te veel tegelijk/.test(e.message));
r = await db.query(`select count(*)::int n from public.docs where collection = 'bulk'`); ok('nothing was deleted by the refused request', r.rows[0].n === 8);
r = await db.query(`select count(*)::int n from public.docs_history where collection = 'bulk'`); ok('no history from the refused request', r.rows[0].n === 0);
await as(A, `delete from public.docs where grp = 'vrienden' and path = 'bulk/1'`);
await as(B, `delete from public.docs where grp = 'vrienden' and path in ('bulk/2', 'bulk/3')`);
r = await db.query(`select count(*)::int n from public.docs where collection = 'bulk'`); ok('deleting one by one still works', r.rows[0].n === 5);
await db.exec(`delete from public.docs where collection = 'bulk'`);
r = await db.query(`select count(*)::int n from public.docs where collection = 'bulk'`); ok('owner can bulk delete in the SQL Editor', r.rows[0].n === 0);

// ---------- new code and everyone out ----------
await fails('app cannot call reset_group_access', () => as(A, `select public.reset_group_access('heel nieuwe code')`), denied);
await fails('reset refuses the current code', () => db.exec(`select public.reset_group_access(' test-code ')`), e => /huidige code/.test(e.message));
await fails('reset refuses the example code', () => db.query(`select public.reset_group_access($1)`, [PLACEHOLDER]), e => /voorbeeldcode/.test(e.message));
await fails('reset refuses a short code', () => db.exec(`select public.reset_group_access('kort')`), e => /korter dan 8/.test(e.message));
r = await db.query(`select public.reset_group_access('Nieuwe Code 2027') m`);
ok('reset reports the new code and the devices removed', /NIEUWE CODE 2027/.test(r.rows[0].m) && /\b4 apparaten\b/.test(r.rows[0].m));
r = await db.query(`select count(*)::int n from public.group_access where grp = 'vrienden'`); ok('reset removes all access', r.rows[0].n === 0);
r = await as(A, `select count(*)::int n from public.docs`); ok('removed device reads nothing', r.rows[0].n === 0);
r = await as(A, `select public.join_group('TEST-CODE') g`); ok('old code no longer joins', r.rows[0].g === null);
r = await as(A, `select public.join_group('nieuwe code 2027') g`); ok('new code joins again', r.rows[0].g === 'vrienden');
r = await as(A, `select count(*)::int n from public.docs where grp = 'vrienden'`); ok('data is still there after rejoining', r.rows[0].n >= 2);
r = await db.query(`select count(*)::int n from public.groups where id = 'ander' and code = 'ANDERE GROEP 2'`); ok('reset leaves other groups alone', r.rows[0].n === 1);
res = await db.exec(RAW);
ok('re-run after reset keeps the new code', lastRows(res)[0].groepscode === 'NIEUWE CODE 2027' && lastRows(res)[0].apparaten === 1);
r = await db.query(`select count(*)::int n from public.docs where grp = 'vrienden'`); ok('re-run keeps all documents', r.rows[0].n >= 2);

// deleting a whole group still works (cascade runs without a login) and is kept in history
await db.exec(`delete from public.groups where id = 'ander'`);
r = await db.query(`select count(*)::int n from public.docs_history where grp = 'ander' and op = 'delete'`); ok('deleting a group keeps its documents in history', r.rows[0].n === 1);

// ---------- older installs ----------
{
  const old = await freshDb();
  await old.exec(withCode('vrienden 2026'));
  await old.exec(`alter table public.groups disable trigger groups_code_check;
    update public.groups set code = 'turfen' where id = 'vrienden';
    alter table public.groups enable trigger groups_code_check;
    insert into auth.users values ('${A}');`);
  res = await old.exec(RAW);
  ok('older install with a short lower-case code still upgrades', lastRows(res)[0].groepscode === 'TURFEN' && /korter dan 8/.test(lastRows(res)[0].controle));
  r = await mkAs(old)(A, `select public.join_group('Turfen') g`); ok('older short code still joins, in any case', r.rows[0].g === 'vrienden');
}
{
  const old = await freshDb();
  await old.exec(withCode('vrienden 2026'));
  await old.query(`alter table public.groups disable trigger groups_code_check`);
  await old.query(`update public.groups set code = $1 where id = 'vrienden'`, [PLACEHOLDER]);
  await old.query(`alter table public.groups enable trigger groups_code_check`);
  await fails('older install still on the example code must pick a code', () => old.exec(RAW), e => /nog de voorbeeldcode/.test(e.message));
  r = await old.query(`select code from public.groups`); ok('nothing changed by that refused run', r.rows[0].code === PLACEHOLDER);
  res = await old.exec(withCode('echte code 2026'));
  ok('then filling in a code replaces the example code', lastRows(res)[0].groepscode === 'ECHTE CODE 2026');
}

finished = true;
