-- Turflijst: database setup for Supabase (Postgres 15 or newer).
--
-- Eerste keer: Supabase > SQL Editor > New query > plak dit hele bestand.
--   Vervang helemaal onderaan (bij "jullie groep") de voorbeeldcode door jullie
--   eigen groepscode van minstens 8 tekens en klik op Run. In de resultaten
--   onderaan zie je de code die is opgeslagen.
-- Opnieuw draaien (bijvoorbeeld na een update van dit bestand) is veilig: het maakt
--   alleen aan wat mist en werkt functies bij. Een bestaande groepscode blijft zoals
--   hij is, ook als onderaan nog de voorbeeldcode staat.
-- Code wijzigen, iedereen eruit zetten of iets terugzetten: zie README.md.

-- ---------- tables ----------
create table if not exists public.groups (
  id          text primary key,
  code        text not null unique,          -- stored normalised: upper case, single spaces
  name        text not null default 'Turflijst',
  created_at  timestamptz not null default now()
);

create table if not exists public.group_access (
  user_id    uuid not null references auth.users(id) on delete cascade,
  grp        text not null references public.groups(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (user_id, grp)
);

-- One row per app document (members/<id>, entries/<id>, challenges/<id>, ...).
create table if not exists public.docs (
  grp         text not null references public.groups(id) on delete cascade,
  path        text not null,
  collection  text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (grp, path),
  constraint docs_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint docs_data_size check (pg_column_size(data) < 262144)
);
create index if not exists docs_grp_collection on public.docs (grp, collection);

-- Wrong group codes per login, for the rate limit in join_group. One row per distinct
-- wrong code, so an old link that is opened again does not count twice.
-- Only join_group (security definer) uses it; the app cannot read or write it.
create table if not exists public.join_misses (
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  at         timestamptz not null default now(),
  primary key (user_id, code_hash)
);
create index if not exists join_misses_at on public.join_misses (at);

-- Every overwritten or deleted document, so nothing is lost for good (see README:
-- "Iets kwijt?"). Filled by a trigger. Deliberately no foreign key to groups, so the
-- history survives even if the group row is deleted. Nobody can read it through the
-- API; only the owner can, in the SQL Editor. Rows are copies of documents, so the
-- 256 kB limit of docs applies; docs_history_prune keeps the table small.
create table if not exists public.docs_history (
  id          bigint generated always as identity primary key,
  grp         text not null,
  path        text not null,
  collection  text not null,
  data        jsonb not null,               -- the document as it was before the change
  op          text not null check (op in ('update', 'delete')),
  changed_at  timestamptz not null default now(),
  changed_by  uuid,                         -- login that changed it (null: SQL Editor)
  was_at      timestamptz,                  -- when that old version was written
  was_by      uuid                          -- login that wrote that old version
);
create index if not exists docs_history_grp_at on public.docs_history (grp, changed_at);

-- ---------- helpers ----------
-- Group codes ignore case, invisible characters and extra spaces (also pasted ones),
-- the same way the app normalises them (normCode in backend.js): drop zero-width
-- characters, collapse any whitespace (as JavaScript's \s) to one space, trim, upper case.
create or replace function public.norm_group_code(c text) returns text
language sql immutable parallel safe set search_path = public as $$
  select upper(regexp_replace(regexp_replace(regexp_replace(coalesce(c, ''),
           '[\u200b-\u200f\u2060\ufeff]', '', 'g'),
           '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+', ' ', 'g'),
           '^ | $', '', 'g'));
$$;

-- Example codes from setup.sql and the README; everybody can read those.
-- The setup.sql one is written in two parts on purpose, so that a search-and-replace
-- of that code at the bottom of this file cannot change this check.
create or replace function public.is_example_group_code(c text) returns boolean
language sql immutable parallel safe set search_path = public as $$
  select public.norm_group_code(c) = any (array['KIES-EEN-' || 'GROEPSCODE', 'NIEUWE-GROEPSCODE', 'GROEPSCODE']);
$$;

-- Why a code may not be used (Dutch, for the owner), or null when it is fine.
create or replace function public.group_code_problem(c text) returns text
language sql immutable parallel safe set search_path = public as $$
  select case
    when public.is_example_group_code(c)
      then 'Dit is de voorbeeldcode uit de uitleg; die kent iedereen. Kies jullie eigen groepscode.'
    when char_length(replace(public.norm_group_code(c), ' ', '')) < 8
      then 'Deze groepscode is korter dan 8 tekens en dus makkelijk te raden. Kies een langere, bijvoorbeeld twee woorden en een getal.'
  end;
$$;

-- Store every code normalised, and refuse the example code and codes under 8 characters.
-- An update that only normalises an existing code (older installs) is always allowed.
create or replace function public.groups_code_check() returns trigger
language plpgsql set search_path = public as $$
declare problem text;
begin
  new.code := public.norm_group_code(new.code);
  if tg_op = 'UPDATE' and new.code = public.norm_group_code(old.code) then return new; end if;
  problem := public.group_code_problem(new.code);
  if problem is not null then
    raise exception '%', problem using errcode = '22023',
      hint = 'Gebruik letters, cijfers, spaties of streepjes; hoofdletters maken niet uit.';
  end if;
  return new;
end $$;

drop trigger if exists groups_code_check on public.groups;
create trigger groups_code_check before insert or update of code on public.groups
  for each row execute function public.groups_code_check();

-- Older installs stored the code exactly as typed: normalise it once.
update public.groups set code = public.norm_group_code(code)
 where code is distinct from public.norm_group_code(code);

create or replace function public.is_member(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_access where user_id = auth.uid() and grp = g);
$$;

create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then
    return b;
  end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(r -> k) = 'object' and jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], public.jsonb_deep_merge(r -> k, v));
    else
      r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.docs_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- Join a group with its code. Returns the group id, or null for a wrong code.
-- Case, invisible characters and extra spaces do not matter.
-- Rate limit per login: after 10 different wrong codes within 10 minutes, or 30 within
-- 24 hours, every new attempt (also with the right code) fails with
--   SQLSTATE 'TL429', message 'too_many_attempts',
--   detail 'retry_after_seconds=<n>', hint 'Te vaak geprobeerd, wacht even.'
-- until older misses age out. The app shows this as "Te vaak geprobeerd, wacht even".
-- Not limited: the same wrong code again (an old link) just returns null, and a login
-- that is already in the group always gets in with the right code. There is no global
-- limit on purpose: the app re-sends the saved code on every start, so a global
-- lockout during an attack would lock out every friend.
create or replace function public.join_group(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  c      text := public.norm_group_code(p_code);
  h      text;
  g      text;
  recent int;
  daily  int;
  wait_s int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if c = '' then return null; end if;
  select id into g from public.groups where code = c;
  if g is not null and exists (select 1 from public.group_access where user_id = uid and grp = g) then
    return g;
  end if;
  h := md5(c);
  if g is null and exists (select 1 from public.join_misses
                            where user_id = uid and code_hash = h and at > now() - interval '24 hours') then
    return null;
  end if;
  select count(*) filter (where at > now() - interval '10 minutes'), count(*)
    into recent, daily
    from public.join_misses
   where user_id = uid and at > now() - interval '24 hours';
  if recent >= 10 or daily >= 30 then
    select ceil(greatest(
             case when recent >= 10 then (select extract(epoch from min(at) + interval '10 minutes' - now())
                                            from public.join_misses
                                           where user_id = uid and at > now() - interval '10 minutes') end,
             case when daily >= 30 then (select extract(epoch from min(at) + interval '24 hours' - now())
                                           from public.join_misses
                                          where user_id = uid and at > now() - interval '24 hours') end,
             1))::int
      into wait_s;
    raise exception 'too_many_attempts' using errcode = 'TL429',
      detail = 'retry_after_seconds=' || wait_s,
      hint = 'Te vaak geprobeerd, wacht even.';
  end if;
  if g is null then
    insert into public.join_misses (user_id, code_hash) values (uid, h)
      on conflict (user_id, code_hash) do update set at = excluded.at;
    delete from public.join_misses where at < now() - interval '24 hours';
    return null;
  end if;
  insert into public.group_access (user_id, grp) values (uid, g) on conflict do nothing;
  return g;
end $$;

-- Merge a patch into a document in one step, so two people liking at once both count.
create or replace function public.doc_merge(p_grp text, p_path text, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r_data jsonb; r_at timestamptz;
begin
  update public.docs
     set data = public.jsonb_deep_merge(data, p_patch)
   where grp = p_grp and path = p_path
  returning data, updated_at into r_data, r_at;
  if r_data is null then
    raise exception 'document does not exist' using errcode = 'P0002';
  end if;
  return jsonb_build_object('data', r_data, 'updated_at', r_at);
end $$;

-- ---------- history and protection against wiping ----------
-- Keep updates for 30 days and deletions for 180 days.
create or replace function public.docs_history_prune() returns integer
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.docs_history
     where (op = 'update' and changed_at < now() - interval '30 days')
        or changed_at < now() - interval '180 days'
    returning 1)
  select count(*)::int from gone;
$$;

create or replace function public.docs_keep_old() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return null; end if;
  insert into public.docs_history (grp, path, collection, data, op, changed_by, was_at, was_by)
  values (old.grp, old.path, old.collection, old.data, lower(tg_op), auth.uid(), old.updated_at, old.updated_by);
  if random() < 0.01 then perform public.docs_history_prune(); end if;
  return null;
end $$;

drop trigger if exists docs_keep_old on public.docs;
create trigger docs_keep_old after update or delete on public.docs
  for each row execute function public.docs_keep_old();

-- The app deletes one document per request. Refuse a request from the app that deletes
-- more than 5 at once (someone trying to wipe the group in one go). The SQL Editor and
-- deleting a whole group (auth.uid() is null there) are not affected.
create or replace function public.docs_guard_bulk() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and (select count(*) from gone) > 5 then
    raise exception 'Te veel tegelijk verwijderd' using errcode = '42501',
      hint = 'Verwijder documenten een voor een.';
  end if;
  return null;
end $$;

drop trigger if exists docs_guard_bulk on public.docs;
create trigger docs_guard_bulk after delete on public.docs
  referencing old table as gone for each statement execute function public.docs_guard_bulk();

-- ---------- owner only: new code and everyone out ----------
-- For the SQL Editor only (the app cannot call it). Gives the group a new code and
-- removes the access of every phone and laptop. Names, drinks, photos and comments stay.
-- Everyone opens the new invite link or types the new code once, and picks their name.
--   select public.reset_group_access('NIEUWE-GROEPSCODE');  -- with your real new code
create or replace function public.reset_group_access(p_new_code text, p_grp text default 'vrienden')
returns text language plpgsql security definer set search_path = public as $$
declare cur text; n int;
begin
  select code into cur from public.groups where id = p_grp;
  if cur is null then raise exception 'Groep "%" bestaat niet.', p_grp using errcode = 'P0002'; end if;
  if public.norm_group_code(p_new_code) = cur then
    raise exception 'Dit is de huidige code. Kies een nieuwe, anders komt iedereen er gewoon weer in.'
      using errcode = '22023';
  end if;
  update public.groups set code = p_new_code where id = p_grp;
  delete from public.group_access where grp = p_grp;
  get diagnostics n = row_count;
  return format('Nieuwe groepscode: %s. %s apparaten hebben geen toegang meer en moeten de nieuwe code of link gebruiken.',
                (select code from public.groups where id = p_grp), n);
end $$;

-- ---------- who may call what ----------
-- Supabase gives anon and authenticated access to everything new in public by default.
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.doc_merge(text, text, jsonb) from public, anon;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;
revoke all on function public.reset_group_access(text, text) from public, anon, authenticated;
revoke all on function public.docs_history_prune() from public, anon, authenticated;
revoke all on function public.norm_group_code(text) from public, anon, authenticated;
revoke all on function public.is_example_group_code(text) from public, anon, authenticated;
revoke all on function public.group_code_problem(text) from public, anon, authenticated;
revoke all on table public.docs_history from public, anon, authenticated;
revoke all on table public.join_misses from public, anon, authenticated;

-- ---------- access rules ----------
alter table public.groups enable row level security;
alter table public.group_access enable row level security;
alter table public.docs enable row level security;
alter table public.join_misses enable row level security;   -- no policies on purpose
alter table public.docs_history enable row level security;  -- no policies on purpose

drop policy if exists "read own access" on public.group_access;
create policy "read own access" on public.group_access for select to authenticated using (user_id = auth.uid());

drop policy if exists "members read group" on public.groups;
create policy "members read group" on public.groups for select to authenticated using (public.is_member(id));

drop policy if exists "members read docs" on public.docs;
create policy "members read docs" on public.docs for select to authenticated using (public.is_member(grp));
drop policy if exists "members insert docs" on public.docs;
create policy "members insert docs" on public.docs for insert to authenticated with check (public.is_member(grp));
drop policy if exists "members update docs" on public.docs;
create policy "members update docs" on public.docs for update to authenticated using (public.is_member(grp)) with check (public.is_member(grp));
drop policy if exists "members delete docs" on public.docs;
create policy "members delete docs" on public.docs for delete to authenticated using (public.is_member(grp));

-- ---------- live updates ----------
-- Only docs is published; docs_history and join_misses never leave the database.
-- Known and accepted: the "Nu in de app" channel (room-<group>) is a public Realtime
-- presence channel. Someone with the site's public key could see how many people have
-- the app open and when, or show a fake "online" name. They cannot read or change any
-- drinks, photos or comments. Delete events carry only the (grp, path) key, not the
-- content. Making the presence channel private would need Realtime Authorization and
-- an app change; not worth it for a group of friends.
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null;
end $$;

-- ---------- photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "turflijst members upload photos" on storage.objects;
create policy "turflijst members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member((storage.foldername(name))[1]));
-- Deleting a photo needs this read rule too; without it a delete silently removes nothing.
drop policy if exists "turflijst members read photos" on storage.objects;
create policy "turflijst members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member((storage.foldername(name))[1]));
drop policy if exists "turflijst members delete photos" on storage.objects;
create policy "turflijst members delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member((storage.foldername(name))[1]));

-- ---------- jullie groep ----------
-- Eerste keer: vervang de voorbeeldcode hieronder door jullie eigen groepscode.
-- Minstens 8 tekens: letters, cijfers, spaties of streepjes (geen aanhalingstekens).
-- Hoofdletters en spaties maken niet uit. Iedereen met deze code kan meedoen, dus kies
-- iets wat niet te raden is. Bestaat de groep al, dan verandert hier niets.
do $$
declare
  wanted  text := public.norm_group_code('KIES-EEN-GROEPSCODE');
  cur     text;
  problem text;
begin
  select code into cur from public.groups where id = 'vrienden';
  -- The group already has its own code: leave it alone.
  if cur is not null and not public.is_example_group_code(cur) then return; end if;
  problem := public.group_code_problem(wanted);
  if problem is not null then
    raise exception '%',
      (case when cur is null then 'Nog geen groep aangemaakt. '
            else 'Jullie groep gebruikt nog de voorbeeldcode, dus iedereen kan meedoen. ' end)
      || (case when public.is_example_group_code(wanted)
               then 'Vul eerst onderaan jullie eigen groepscode in; de voorbeeldcode kent iedereen.'
               else problem end)
      using errcode = '22023',
      hint = 'Vervang onderaan setup.sql (bij "jullie groep") de voorbeeldcode door jullie eigen code van minstens 8 tekens en klik opnieuw op Run.';
  end if;
  if cur is null then
    insert into public.groups (id, code, name) values ('vrienden', wanted, 'Turflijst')
      on conflict (id) do nothing;
  else
    -- An older install that never replaced the example code.
    update public.groups set code = wanted where id = 'vrienden';
  end if;
end $$;

-- Result for the owner: the code that is stored, and how many devices have access.
select g.id as groep,
       g.code as groepscode,
       (select count(*) from public.group_access a where a.grp = g.id) as apparaten,
       (select count(*) from public.group_access a
         where a.grp = g.id
           and not exists (select 1 from public.docs d
                            where d.grp = a.grp and d.collection = 'members'
                              and d.data->>'uid' = a.user_id::text)) as zonder_naam,
       coalesce(public.group_code_problem(g.code) || ' Zie README: Code wijzigen.', 'In orde') as controle
  from public.groups g
 where g.id = 'vrienden';
