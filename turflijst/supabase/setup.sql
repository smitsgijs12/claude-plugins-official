-- Turflijst: database setup for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Before running, replace KIES-EEN-GROEPSCODE at the bottom with your own code.
-- Running it again is safe: it only creates what is missing.

-- ---------- tables ----------
create table if not exists public.groups (
  id          text primary key,
  code        text not null unique,
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

-- ---------- helpers ----------
create or replace function public.is_member(g text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_access where user_id = auth.uid() and grp = g);
$$;

create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
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
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- Join a group with its code. Returns the group id, or null for a wrong code.
create or replace function public.join_group(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select id into g from public.groups where code = trim(p_code);
  if g is null then return null; end if;
  insert into public.group_access (user_id, grp) values (auth.uid(), g) on conflict do nothing;
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

revoke all on function public.join_group(text) from public, anon;
revoke all on function public.doc_merge(text, text, jsonb) from public, anon;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;

-- ---------- access rules ----------
alter table public.groups enable row level security;
alter table public.group_access enable row level security;
alter table public.docs enable row level security;

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
drop policy if exists "turflijst members delete photos" on storage.objects;
create policy "turflijst members delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member((storage.foldername(name))[1]));

-- ---------- your group ----------
-- Replace KIES-EEN-GROEPSCODE with your own code. Everyone with this code can join.
insert into public.groups (id, code, name)
values ('vrienden', 'KIES-EEN-GROEPSCODE', 'Turflijst')
on conflict (id) do update set code = excluded.code;
