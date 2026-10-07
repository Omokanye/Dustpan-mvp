-- DUSTPAN — wallet, activity and redemption setup (Dustcoin).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Run AFTER supabase/schema.sql. Safe to re-run.
--
-- Design rules:
--   * Everyone starts at 0 DUST / 0 kg. Nothing is ever pre-filled.
--   * A balance is NEVER stored or editable. It is calculated from the
--     `transactions` rows, and customers can only READ their own rows.
--   * Customers cannot insert/update/delete transactions. DUST is credited
--     by Dustpan staff only, after waste is weighed and verified.
--   * The only thing a customer can create is a PENDING redemption request,
--     through request_redemption() below. Nothing is paid out by this file.

-- 1. Customer ID (DUST-XXXXXX) ----------------------------------------------
-- A short, human-friendly ID customers read out at the drop-off point.
-- It is not a secret and is never used for sign-in.
alter table public.profiles add column if not exists customer_id text;

create or replace function public.make_customer_id()
returns text language plpgsql as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- no 0/O/1/I
  cid text;
  i int;
begin
  loop
    cid := 'DUST-';
    for i in 1..6 loop
      cid := cid || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where customer_id = cid);
  end loop;
  return cid;
end $$;

create or replace function public.set_customer_id()
returns trigger language plpgsql as $$
begin
  if new.customer_id is null then
    new.customer_id := public.make_customer_id();
  end if;
  return new;
end $$;

drop trigger if exists profiles_set_customer_id on public.profiles;
create trigger profiles_set_customer_id
  before insert on public.profiles
  for each row execute function public.set_customer_id();

-- Give existing customers an ID too.
update public.profiles set customer_id = public.make_customer_id() where customer_id is null;
create unique index if not exists profiles_customer_id_key on public.profiles (customer_id);
-- (Customers still cannot change customer_id: schema.sql only grants UPDATE on
--  full_name, phone, zone, address and updated_at.)

-- 2. Transactions (the only source of truth for balances) ----------------------
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('deposit', 'redeem', 'trade', 'adjustment')),
  amount_dust  numeric(18,2) not null,               -- + earned, - spent
  waste_kg     numeric(12,3) check (waste_kg is null or waste_kg >= 0),
  status       text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  description  text check (description is null or char_length(description) <= 200),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  check (kind <> 'deposit' or amount_dust >= 0)
);
create index if not exists transactions_user_created_idx on public.transactions (user_id, created_at desc);

alter table public.transactions enable row level security;

drop policy if exists "transactions: read own" on public.transactions;
create policy "transactions: read own" on public.transactions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "transactions: ops read all" on public.transactions;
create policy "transactions: ops read all" on public.transactions
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('staff', 'admin', 'psp_operator'));

-- No browser-side writes, ever.
revoke all on public.transactions from anon;
revoke insert, update, delete on public.transactions from authenticated;

-- 3. Wallet summary (calculated, read-only) -----------------------------------
-- security_invoker: the view obeys the same row-level security as the table,
-- so a customer only ever sees their own totals.
create or replace view public.wallet_summary with (security_invoker = true) as
select
  t.user_id,
  coalesce(sum(t.amount_dust) filter (where t.status = 'completed'), 0)::numeric(18,2)                        as balance_dust,
  coalesce(-sum(t.amount_dust) filter (where t.status = 'pending' and t.amount_dust < 0), 0)::numeric(18,2)   as pending_debit_dust,
  (coalesce(sum(t.amount_dust) filter (where t.status = 'completed'), 0)
   + coalesce(sum(t.amount_dust) filter (where t.status = 'pending' and t.amount_dust < 0), 0))::numeric(18,2) as available_dust,
  coalesce(sum(t.amount_dust) filter (where t.status = 'completed' and t.amount_dust > 0), 0)::numeric(18,2)  as total_earned,
  coalesce(sum(t.waste_kg) filter (where t.status = 'completed' and t.kind = 'deposit'), 0)::numeric(12,3)    as waste_kg,
  (count(*) filter (where t.status = 'completed' and t.kind = 'deposit'))::int                                as deposit_count,
  (count(*) filter (where t.status = 'pending'))::int                                                         as pending_count
from public.transactions t
group by t.user_id;

revoke all on public.wallet_summary from anon;
grant select on public.wallet_summary to authenticated;
-- A customer with no transactions has no row: the app shows 0 DUST / 0 kg.

-- 4. Settings (admin-set DUST -> Naira rate, shown as an ESTIMATE) -------------
create table if not exists public.app_settings (
  key         text primary key,
  value_num   numeric,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;

drop policy if exists "app_settings: read" on public.app_settings;
create policy "app_settings: read" on public.app_settings
  for select to authenticated using (true);

drop policy if exists "app_settings: admin write" on public.app_settings;
create policy "app_settings: admin write" on public.app_settings
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
revoke all on public.app_settings from anon;

-- No rate is pre-set on purpose: until you set one, the app shows "—" for the
-- Naira estimate instead of a made-up number. To set your own rate (Naira per
-- 1 DUST), uncomment, edit the number and run:
--
-- insert into public.app_settings (key, value_num) values ('dust_ngn_rate', 0)
--   on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

-- 5. Redemption requests (always start PENDING) --------------------------------
create table if not exists public.redemption_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  type             text not null check (type in ('airtime', 'data', 'cash', 'gift', 'barter')),
  amount_dust      numeric(18,2) not null check (amount_dust > 0),
  estimated_naira  numeric(18,2),
  destination      text check (destination is null or char_length(destination) <= 200),
  note             text check (note is null or char_length(note) <= 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  transaction_id   uuid references public.transactions(id),
  created_at       timestamptz not null default now()
);
create index if not exists redemption_requests_user_idx on public.redemption_requests (user_id, created_at desc);

alter table public.redemption_requests enable row level security;

drop policy if exists "redemptions: read own" on public.redemption_requests;
create policy "redemptions: read own" on public.redemption_requests
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "redemptions: ops read all" on public.redemption_requests;
create policy "redemptions: ops read all" on public.redemption_requests
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('staff', 'admin', 'psp_operator'));

revoke all on public.redemption_requests from anon;
revoke insert, update, delete on public.redemption_requests from authenticated;

-- 6. request_redemption(): the ONLY way a customer asks to spend DUST ---------
-- Creates a PENDING request and a PENDING debit that reserves the DUST so it
-- can't be spent twice. It never marks anything paid, and it checks the
-- customer's own available balance on the server.
create or replace function public.request_redemption(
  p_type         text,
  p_amount_dust  numeric,
  p_destination  text default null,
  p_note         text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  avail  numeric;
  rate   numeric;
  tid    uuid;
  rid    uuid := gen_random_uuid();
begin
  if uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;
  if p_type is null or p_type not in ('airtime', 'data', 'cash', 'gift', 'barter') then
    raise exception 'Choose what you want to redeem.';
  end if;
  if p_amount_dust is null or p_amount_dust <= 0 then
    raise exception 'Enter an amount above 0.';
  end if;
  if p_type in ('airtime', 'data', 'cash') and coalesce(btrim(p_destination), '') = '' then
    raise exception 'Add the phone number or bank details to send it to.';
  end if;

  -- One request at a time per customer, so two quick taps can't overspend.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select coalesce(sum(amount_dust) filter (where status = 'completed'), 0)
       + coalesce(sum(amount_dust) filter (where status = 'pending' and amount_dust < 0), 0)
    into avail
    from public.transactions
   where user_id = uid;

  if p_amount_dust > avail then
    raise exception 'Not enough available DUST.';
  end if;

  select value_num into rate from public.app_settings where key = 'dust_ngn_rate';

  insert into public.transactions (user_id, kind, amount_dust, status, description, created_by)
  values (uid, 'redeem', -p_amount_dust, 'pending', 'Redeem ' || p_type || ' (pending review)', uid)
  returning id into tid;

  insert into public.redemption_requests
    (id, user_id, type, amount_dust, estimated_naira, destination, note, transaction_id)
  values
    (rid, uid, p_type, p_amount_dust,
     case when rate is not null and rate > 0 then round(p_amount_dust * rate, 2) end,
     nullif(btrim(p_destination), ''), nullif(btrim(p_note), ''), tid);

  return rid;
end $$;

revoke all on function public.request_redemption(text, numeric, text, text) from public, anon;
grant execute on function public.request_redemption(text, numeric, text, text) to authenticated;

-- 7. Crediting a customer (staff, after weighing + verifying) -------------------
-- Until a staff screen exists, credit from this SQL editor. Look the customer
-- up by the DUST-XXXXXX ID they show you. Example (uncomment and edit):
--
-- insert into public.transactions (user_id, kind, amount_dust, waste_kg, status, description)
-- select id, 'deposit', 50, 2.5, 'completed', 'Verified drop-off: 2.5 kg PET'
--   from public.profiles where customer_id = 'DUST-XXXXXX';
--
-- To reject a pending redemption (frees the reserved DUST):
-- update public.transactions set status = 'rejected' where id = '<transaction_id>';
-- update public.redemption_requests set status = 'rejected' where transaction_id = '<transaction_id>';
