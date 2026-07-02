-- ============================================================================
--  PRMSU Freedom Wall - Supabase setup
--  ---------------------------------------------------------------------------
--  HOW TO RUN
--    1. Create a free project at https://supabase.com
--    2. Open your project → SQL Editor → New query
--    3. Paste this ENTIRE file and press "Run"
--    4. Copy your Project URL + anon public key into config.js
--    5. Enable an auth provider for admins:
--         Authentication → Providers → Email  (turn ON, "Confirm email" OFF
--         is easiest for a single admin; leave ON if you prefer)
--
--  SECURITY MODEL (important)
--    • The public site uses ONLY the anon key, which is safe to publish.
--    • Row Level Security (RLS) is ON for every table.
--    • Anonymous visitors can NEVER write to tables directly. All writes go
--      through SECURITY DEFINER functions (create_post / report_post /
--      submit_admin_application) that validate input and control exactly which
--      columns are set. This stops anyone from forging status, report counts, etc.
--    • Moderation (read hidden posts, hide/delete, read reports) requires an
--      authenticated admin, an account whose email is in the `admins` table.
--    • The FIRST signed-in account can claim admin with claim_admin(); after
--      that, only existing admins can add more via add_admin().
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
--  TABLES
-- ----------------------------------------------------------------------------

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  body         text        not null check (char_length(btrim(body)) between 1 and 500),
  nickname     text        check (nickname is null or char_length(nickname) <= 24),
  color        text        not null default 'sky',
  status       text        not null default 'visible'
                           check (status in ('visible', 'pending', 'hidden')),
  report_count integer     not null default 0,
  created_at   timestamptz not null default now()
);

-- reactions were removed from the wall; drop the old column if it exists
alter table public.posts drop column if exists reactions;

-- redesign: each post has a category + a simple like counter
alter table public.posts add column if not exists category text not null default 'confession';
alter table public.posts add column if not exists like_count integer not null default 0;

create index if not exists posts_status_created_idx
  on public.posts (status, created_at desc);

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(id) on delete cascade,
  reason         text,
  reporter_token text,   -- an anonymous, browser-generated id so one browser can report a post once
  created_at     timestamptz not null default now()
);

-- migration-safe: add the column + dedup index even if the table already existed
alter table public.reports add column if not exists reporter_token text;
create index if not exists reports_post_idx on public.reports (post_id);
create unique index if not exists reports_post_token_uidx on public.reports (post_id, reporter_token);

create table if not exists public.admins (
  email    text primary key,
  added_at timestamptz not null default now()
);
-- roles: 'owner' (you, all powers), 'admin' (full admin / staff), 'mod' (moderator)
alter table public.admins add column if not exists role text not null default 'mod'
  check (role in ('owner','admin','mod'));
-- the earliest admin becomes the owner (one-time bootstrap)
update public.admins set role = 'owner'
 where email = (select email from public.admins order by added_at asc limit 1)
   and not exists (select 1 from public.admins where role = 'owner');

-- site-wide settings (single row). paused = read-only wall.
create table if not exists public.settings (
  id         integer primary key default 1 check (id = 1),
  paused     boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
--  HELPER: is the current signed-in user an admin?
--  SECURITY DEFINER so it can read `admins` from inside RLS policies without
--  causing infinite recursion on the admins table's own policy.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;

-- ----------------------------------------------------------------------------
--  WRITE PATH FOR ANONYMOUS VISITORS (SECURITY DEFINER, validated)
-- ----------------------------------------------------------------------------

-- Create a post. Anonymous callers may only set body / nickname / color / category.
-- Everything else (status, counts) is forced by the server.
drop function if exists public.create_post(text, text, text);
create or replace function public.create_post(
  p_body     text,
  p_nickname text default null,
  p_color    text default 'sky',
  p_category text default 'confession'
)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  rec         public.posts;
  clean_body  text := btrim(coalesce(p_body, ''));
  clean_nick  text := nullif(btrim(coalesce(p_nickname, '')), '');
  clean_color text := coalesce(nullif(btrim(coalesce(p_color, '')), ''), 'sky');
  clean_cat   text := lower(coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'confession'));
begin
  if (select paused from public.settings where id = 1) then raise exception 'The wall is paused right now. Please try again in a bit.'; end if;
  if char_length(clean_body) = 0 then raise exception 'Post cannot be empty.'; end if;
  if char_length(clean_body) > 500 then raise exception 'Post is too long (max 500 characters).'; end if;
  if clean_nick is not null and char_length(clean_nick) > 24 then clean_nick := left(clean_nick, 24); end if;
  if clean_color not in ('sky','gold','mint','rose','lilac','peach') then clean_color := 'sky'; end if;
  if clean_cat not in ('confession','crush','rant','question','funny','lostfound','tip') then clean_cat := 'confession'; end if;

  insert into public.posts (body, nickname, color, status, category)
  values (clean_body, clean_nick, clean_color, 'visible', clean_cat)  -- change 'visible' to 'pending' for pre-moderation
  returning * into rec;
  return rec;
end;
$$;

-- reactions were removed from the wall; drop the old reaction function if present
drop function if exists public.react_to_post(uuid, text, integer);

-- Like / unlike a post (delta clamped to +/-1; count never drops below 0).
create or replace function public.like_post(p_post_id uuid, p_delta integer default 1)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.posts;
  d   integer := case when p_delta < 0 then -1 else 1 end;
  cur integer;
begin
  select like_count into cur from public.posts where id = p_post_id and status = 'visible' for update;
  if not found then raise exception 'Post not found.'; end if;
  update public.posts set like_count = greatest(0, cur + d) where id = p_post_id returning * into rec;
  return rec;
end;
$$;

-- Report a post. Reports are QUEUE-ONLY: reporting never changes a post's
-- visibility on its own, so no single anonymous user can hide someone else's
-- post by spamming reports. Each browser (reporter_token) can report a given
-- post once; admins triage the queue by report_count in the dashboard.
-- (Old two-arg signature is dropped so the new 3-arg version isn't an overload.)
drop function if exists public.report_post(uuid, text);
create or replace function public.report_post(
  p_post_id uuid,
  p_reason  text default null,
  p_token   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- one row per (post, browser); a repeat report from the same browser is a no-op
  insert into public.reports (post_id, reason, reporter_token)
  values (
    p_post_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_token, '')), '')
  )
  on conflict (post_id, reporter_token) do nothing;

  get diagnostics n = row_count;   -- 1 = a new report was recorded, 0 = duplicate

  if n > 0 then
    update public.posts
       set report_count = report_count + 1
     where id = p_post_id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
--  ADMIN MANAGEMENT
-- ----------------------------------------------------------------------------

-- Claim admin. Works only for the FIRST admin (bootstrap). Returns your email.
create or replace function public.claim_admin()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  -- serialise concurrent claims so two people can't both pass the "no admins yet"
  -- check and both become the first admin (transaction-scoped, auto-released)
  perform pg_advisory_xact_lock(hashtext('prmsu_wall_claim_admin'));

  if my_email = '' then
    raise exception 'You must be signed in to become an admin.';
  end if;

  -- Already an admin? Nothing to do.
  if exists (select 1 from public.admins where email = my_email) then
    return my_email;
  end if;

  -- Only allowed while there are NO admins yet.
  if exists (select 1 from public.admins) then
    raise exception 'Admin has already been claimed. Ask an existing admin to add you.';
  end if;

  insert into public.admins (email, role) values (my_email, 'owner');
  return my_email;
end;
$$;

-- Gate the admin sign-up form. Creating an account is NOT open to everyone:
-- only people the owner has already approved (i.e. whose email is in
-- public.admins - approved moderators, added admins, and the seeded owner) may
-- create an account. Everyone else must apply to moderate first. Returns true
-- when the given email is allowed to sign up.
create or replace function public.email_can_signup(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where email = lower(btrim(coalesce(p_email, '')))
  );
$$;

-- Role helpers ------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admins where email = lower(coalesce((select auth.jwt() ->> 'email'), ''));
$$;
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'owner', false);
$$;
create or replace function public.is_full_admin()  -- owner or full admin
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','admin'), false);
$$;

-- Full admin adds a moderator; only the OWNER may grant full admin.
drop function if exists public.add_admin(text);
create or replace function public.add_admin(p_email text, p_role text default 'mod')
returns void language plpgsql security definer set search_path = public as $$
declare r text := lower(coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'mod'));
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can add people.'; end if;
  if r not in ('mod','admin') then r := 'mod'; end if;
  if r = 'admin' and not public.is_owner() then r := 'mod'; end if;  -- only the owner grants full admin
  insert into public.admins (email, role) values (lower(btrim(coalesce(p_email, ''))), r)
  on conflict (email) do nothing;
end;$$;

-- Owner changes someone's role (mod <-> admin). The owner role is protected.
create or replace function public.set_admin_role(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change roles.'; end if;
  if p_role not in ('admin','mod') then raise exception 'Invalid role.'; end if;
  update public.admins set role = p_role where lower(email) = lower(btrim(p_email)) and role <> 'owner';
end;$$;

-- Owner removes an admin/mod. The owner cannot be removed.
create or replace function public.remove_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can remove people.'; end if;
  delete from public.admins where lower(email) = lower(btrim(p_email)) and role <> 'owner';
end;$$;

-- Full admin pauses / resumes the wall (read-only when paused).
create or replace function public.set_paused(p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can pause the wall.'; end if;
  update public.settings set paused = coalesce(p_paused, false), updated_at = now() where id = 1;
end;$$;

-- Admin sets a post's status (visible / pending / hidden).
create or replace function public.admin_set_status(p_post_id uuid, p_status text)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.posts;
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;
  if p_status not in ('visible','pending','hidden') then
    raise exception 'Invalid status.';
  end if;
  update public.posts set status = p_status
   where id = p_post_id
   returning * into rec;
  if rec.id is null then
    raise exception 'Post not found.';
  end if;
  return rec;
end;
$$;

-- Admin permanently deletes a post (and its reports, via cascade).
create or replace function public.admin_delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;
  delete from public.posts where id = p_post_id;
end;
$$;

-- ----------------------------------------------------------------------------
--  ADMIN APPLICATIONS  (people apply to help moderate; an admin approves)
-- ----------------------------------------------------------------------------
--  Verification images (a photo of an ID and a selfie) are uploaded to a
--  PRIVATE storage bucket that only admins can read, and are DELETED the moment
--  an admin approves or rejects the application. We keep no identity documents.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_applications (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text not null,   -- the email the applicant will sign in with if approved
  note        text,
  id_path     text,            -- object path in the private 'admin-apps' bucket
  face_path   text,
  status      text not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists admin_apps_status_idx
  on public.admin_applications (status, created_at desc);

-- Anonymous applicant submits an application (images already uploaded to storage).
create or replace function public.submit_admin_application(
  p_full_name text,
  p_email     text,
  p_note      text,
  p_id_path   text,
  p_face_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id      uuid;
  clean_name  text := btrim(coalesce(p_full_name, ''));
  clean_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(clean_name) < 2 then
    raise exception 'Please enter your full name.';
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter a valid email address.';
  end if;

  insert into public.admin_applications (full_name, email, note, id_path, face_path)
  values (
    left(clean_name, 120),
    clean_email,
    nullif(btrim(coalesce(p_note, '')), ''),
    nullif(p_id_path, ''),
    nullif(p_face_path, '')
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- Admin approves: grant admin to the applicant's email, then wipe the images.
create or replace function public.approve_admin_application(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.admin_applications;
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;

  select * into app from public.admin_applications where id = p_id;
  if not found then
    raise exception 'Application not found.';
  end if;

  insert into public.admins (email) values (lower(btrim(app.email)))
  on conflict (email) do nothing;

  -- NOTE: the actual ID + selfie files are deleted by the client via the
  -- Storage API right before this runs (direct SQL delete on storage.objects
  -- is blocked by Supabase). Here we just forget the paths.
  update public.admin_applications
     set status = 'approved', reviewed_at = now(), id_path = null, face_path = null
   where id = p_id;
end;
$$;

-- Admin rejects: wipe the images, keep only a record that it was rejected.
create or replace function public.reject_admin_application(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.admin_applications;
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;

  -- the ID + selfie files are deleted by the client via the Storage API just
  -- before this runs; here we only mark it rejected and forget the paths.
  update public.admin_applications
     set status = 'rejected', reviewed_at = now(), id_path = null, face_path = null
   where id = p_id;
  if not found then
    raise exception 'Application not found.';
  end if;
end;
$$;

-- Admin deletes an application record entirely (e.g. to clear the reviewed
-- list so other admins can't see who applied). Any leftover images are removed
-- by the client via the Storage API before this runs.
create or replace function public.admin_delete_application(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;
  delete from public.admin_applications where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
--  PRIVATE STORAGE BUCKET for the verification images
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('admin-apps', 'admin-apps', false)
on conflict (id) do nothing;

-- Anyone may upload into this bucket (an anonymous applicant), but only admins
-- may read or delete. Nobody can list/read someone else's uploaded ID.
drop policy if exists admin_apps_upload on storage.objects;
create policy admin_apps_upload on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'admin-apps');

drop policy if exists admin_apps_read on storage.objects;
create policy admin_apps_read on storage.objects
  for select using (bucket_id = 'admin-apps' and public.is_admin());

drop policy if exists admin_apps_delete on storage.objects;
create policy admin_apps_delete on storage.objects
  for delete using (bucket_id = 'admin-apps' and public.is_admin());

-- ----------------------------------------------------------------------------
--  COMMENTS  (replies under a post)
-- ----------------------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 300),
  nickname   text check (nickname is null or char_length(nickname) <= 24),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

-- a live comment counter on each post, kept in sync by a trigger
alter table public.posts add column if not exists comment_count integer not null default 0;

create or replace function public._bump_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_comment_count on public.comments;
create trigger trg_comment_count
  after insert or delete on public.comments
  for each row execute function public._bump_comment_count();

-- Anonymous visitor adds a comment (validated; only on visible posts).
create or replace function public.create_comment(p_post_id uuid, p_body text, p_nickname text default null)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
  rec        public.comments;
  clean_body text := btrim(coalesce(p_body, ''));
  clean_nick text := nullif(btrim(coalesce(p_nickname, '')), '');
begin
  if (select paused from public.settings where id = 1) then raise exception 'The wall is paused right now.'; end if;
  if char_length(clean_body) = 0 then raise exception 'Comment cannot be empty.'; end if;
  if char_length(clean_body) > 300 then raise exception 'Comment is too long (max 300 characters).'; end if;
  if clean_nick is not null and char_length(clean_nick) > 24 then clean_nick := left(clean_nick, 24); end if;
  if not exists (select 1 from public.posts where id = p_post_id and status = 'visible') then
    raise exception 'Post not found.';
  end if;
  insert into public.comments (post_id, body, nickname)
  values (p_post_id, clean_body, clean_nick)
  returning * into rec;
  return rec;
end;
$$;

-- Admin removes a comment.
create or replace function public.admin_delete_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not authorised.'; end if;
  delete from public.comments where id = p_id;
end;
$$;

alter table public.comments enable row level security;
drop policy if exists comments_public_read on public.comments;
create policy comments_public_read on public.comments for select using (true);

grant execute on function public.create_comment(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_delete_comment(uuid)        to authenticated;

-- ----------------------------------------------------------------------------
--  ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.posts   enable row level security;
alter table public.reports enable row level security;
alter table public.admins  enable row level security;

-- POSTS -------------------------------------------------------------
-- Public may read only visible posts.
drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts
  for select using (status = 'visible');

-- Admins may read every post (visible / pending / hidden).
drop policy if exists posts_admin_read on public.posts;
create policy posts_admin_read on public.posts
  for select using (public.is_admin());

-- No INSERT/UPDATE/DELETE policies for the public → direct writes are blocked.
-- All writes flow through the SECURITY DEFINER functions above.

-- REPORTS -----------------------------------------------------------
-- Only admins may read the raw report list.
drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports
  for select using (public.is_admin());

-- ADMINS ------------------------------------------------------------
-- Admins may read the admin roster.
drop policy if exists admins_admin_read on public.admins;
create policy admins_admin_read on public.admins
  for select using (public.is_admin());

-- ADMIN APPLICATIONS ------------------------------------------------
-- Only admins may read applications. Applicants submit via the RPC only.
alter table public.admin_applications enable row level security;
drop policy if exists admin_apps_admin_read on public.admin_applications;
create policy admin_apps_admin_read on public.admin_applications
  for select using (public.is_admin());

-- SETTINGS ----------------------------------------------------------
-- Anyone may read the paused flag (so the wall can show read-only mode).
alter table public.settings enable row level security;
drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings for select using (true);

-- ----------------------------------------------------------------------------
--  GRANTS  (who may call each function)
-- ----------------------------------------------------------------------------
grant execute on function public.create_post(text, text, text, text) to anon, authenticated;
grant execute on function public.like_post(uuid, integer)            to anon, authenticated;
grant execute on function public.report_post(uuid, text, text)       to anon, authenticated;
grant execute on function public.is_admin()                         to anon, authenticated;
grant execute on function public.claim_admin()                      to authenticated;
grant execute on function public.email_can_signup(text)             to anon, authenticated;
grant execute on function public.add_admin(text, text)              to authenticated;
grant execute on function public.my_role()                          to anon, authenticated;
grant execute on function public.is_owner()                         to anon, authenticated;
grant execute on function public.is_full_admin()                    to anon, authenticated;
grant execute on function public.set_admin_role(text, text)         to authenticated;
grant execute on function public.remove_admin(text)                 to authenticated;
grant execute on function public.set_paused(boolean)                to authenticated;
grant execute on function public.admin_set_status(uuid, text)       to authenticated;
grant execute on function public.admin_delete_post(uuid)            to authenticated;
grant execute on function public.submit_admin_application(text, text, text, text, text) to anon, authenticated;
grant execute on function public.approve_admin_application(uuid)    to authenticated;
grant execute on function public.reject_admin_application(uuid)     to authenticated;
grant execute on function public.admin_delete_application(uuid)     to authenticated;

-- ----------------------------------------------------------------------------
--  REALTIME  (live updates on the public wall)
-- ----------------------------------------------------------------------------
-- Adds the posts table to the realtime publication. Safe to run repeatedly.
do $$
begin
  begin
    alter publication supabase_realtime add table public.posts;
  exception
    when duplicate_object then null;   -- already added
    when undefined_object then null;   -- publication missing (older projects)
  end;
end $$;

-- Make PostgREST pick up any newly added functions right away.
notify pgrst, 'reload schema';

-- ============================================================================
--  Done. Now open config.js and paste your Project URL + anon key.
--  Then open admin.html on your deployed site, sign up, and press
--  "Become an admin" to claim the first admin account.
-- ============================================================================
