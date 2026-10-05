-- DUSTPAN — database setup for customer accounts.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.

-- 1. Customer details (one row per account) --------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  email       text,
  zone        text,
  address     text,
  consent_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A signed-in user can read and edit ONLY their own row.
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Staff, admins and PSP operators can read all customer rows.
drop policy if exists "profiles: ops read all" on public.profiles;
create policy "profiles: ops read all" on public.profiles
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('staff', 'admin', 'psp_operator'));

-- Users may change only these columns (not id, email or consent record).
revoke update on public.profiles from authenticated;
grant update (full_name, phone, zone, address, updated_at) on public.profiles to authenticated;

-- 2. New sign-ups: give them the "customer" role -----------------------------
-- app_metadata can't be edited by users, so the role can't be self-assigned.
-- Staff/admin roles are only ever set by you (see step 4).
create or replace function public.set_default_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (coalesce(new.raw_app_meta_data, '{}'::jsonb) ? 'role') then
    new.raw_app_meta_data :=
      coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'customer');
  end if;
  return new;
end $$;

drop trigger if exists before_auth_user_created on auth.users;
create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.set_default_role();

-- 3. New sign-ups: save their details automatically --------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, email, zone, address, consent_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    new.email,
    new.raw_user_meta_data ->> 'zone',
    new.raw_user_meta_data ->> 'address',
    nullif(new.raw_user_meta_data ->> 'consent_at', '')::timestamptz
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Make yourself the first admin ------------------------------------------
-- 1) Create your account on the site (Create account), or add a user in
--    Supabase -> Authentication -> Users.
-- 2) Uncomment, put your email in, and run:
--
-- update auth.users
--    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
--  where email = 'you@example.com';
--
-- Other roles: 'staff' or 'psp_operator'. Then sign out and back in.
