-- =====================================================================
-- Nurora — complete schema, for a FRESH Supabase project
--
-- GENERATED FILE — do not edit by hand.
--   npm run schema:build      regenerate after adding a migration
--   npm run schema:check      fail if it has fallen behind
--
-- Paste the whole file into the Supabase SQL Editor and run it once.
-- It is every migration in supabase/migrations/ consolidated, with one
-- deliberate difference: the user_role enum is created with all four
-- values up front, because Postgres will not let a new enum value be
-- USED in the transaction that adds it and the SQL Editor runs this as
-- a single transaction.
--
-- Safe on a new project. NOT idempotent — running it twice errors on
-- objects that already exist. To update an EXISTING database, run only
-- the migrations it has not seen yet.
--
-- Requires the Supabase auth schema (auth.users, auth.uid), which every
-- Supabase project has. It creates no demo accounts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- from 0001_init.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Nurora — counselling scheduling, time tracking & payments
-- Migration 0001: core schema, RLS, triggers
--
-- Shape: a staff-operated practice console. Counsellors and admins run
-- the schedule; clients are records that MAY optionally be linked to a
-- login so they can see and book their own sessions.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type user_role as enum ('client', 'counsellor', 'admin', 'support');
-- 'support' is included here rather than added later — see the note
-- at the top of this file.
create type appointment_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show');
create type invoice_status as enum ('draft', 'unpaid', 'paid', 'refunded', 'waived');
create type time_entry_source as enum ('timer', 'manual');
create type notify_channel as enum ('email', 'sms', 'whatsapp', 'in_app');
create type delivery_status as enum ('sent', 'failed', 'skipped');

-- ---------------------------------------------------------------------
-- profiles — one row per auth user (staff and, optionally, clients)
-- ---------------------------------------------------------------------
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           user_role   not null default 'client',
  full_name      text        not null default '',
  email          text,
  phone          text,
  avatar_url     text,
  timezone       text        not null default 'Asia/Kolkata',
  headline       text,
  bio            text,
  -- Fallback rate when a session is billed by tracked time.
  hourly_rate_cents integer  not null default 0,
  default_session_fee_cents integer not null default 0,
  default_duration_minutes  integer not null default 60,
  currency       text        not null default 'INR',
  is_active      boolean     not null default true,
  onboarded      boolean     not null default false,
  notify_email   boolean     not null default true,
  notify_sms     boolean     not null default false,
  notify_whatsapp boolean    not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index profiles_role_idx on profiles (role) where is_active;

-- Role helpers. SECURITY DEFINER so policies can read profiles without
-- recursing through profiles' own RLS.
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('counsellor', 'admin')
  );
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- clients — people who attend sessions. A client is a RECORD first;
-- user_id is set only if they also sign in.
-- ---------------------------------------------------------------------
create table clients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references profiles(id) on delete set null,
  full_name      text not null,
  age            integer check (age is null or age between 0 and 120),
  email          text,
  phone          text,
  -- The counsellor this client usually sees.
  counsellor_id  uuid references profiles(id) on delete set null,
  notes          text,
  is_active      boolean not null default true,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index clients_counsellor_idx on clients (counsellor_id) where is_active;
create index clients_name_idx on clients (lower(full_name));

-- ---------------------------------------------------------------------
-- service_types — what a counsellor offers (duration + fee)
-- ---------------------------------------------------------------------
create table service_types (
  id               uuid primary key default gen_random_uuid(),
  counsellor_id    uuid not null references profiles(id) on delete cascade,
  name             text not null,
  description      text,
  duration_minutes integer not null check (duration_minutes between 10 and 480),
  price_cents      integer not null default 0 check (price_cents >= 0),
  currency         text not null default 'INR',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index service_types_counsellor_idx on service_types (counsellor_id) where is_active;

-- ---------------------------------------------------------------------
-- availability — recurring weekly hours in the counsellor's local time.
-- weekday: 0 = Sunday … 6 = Saturday
-- ---------------------------------------------------------------------
create table availability_rules (
  id            uuid primary key default gen_random_uuid(),
  counsellor_id uuid not null references profiles(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  start_time    time not null,
  end_time      time not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint availability_rules_order check (end_time > start_time)
);

create index availability_rules_counsellor_idx on availability_rules (counsellor_id, weekday);

-- One-off blocks (is_available = false) or extra hours (true).
create table availability_exceptions (
  id            uuid primary key default gen_random_uuid(),
  counsellor_id uuid not null references profiles(id) on delete cascade,
  on_date       date not null,
  is_available  boolean not null default false,
  start_time    time,
  end_time      time,
  reason        text,
  created_at    timestamptz not null default now(),
  constraint availability_exceptions_window check (
    (start_time is null and end_time is null) or (end_time > start_time)
  )
);

create index availability_exceptions_lookup_idx
  on availability_exceptions (counsellor_id, on_date);

-- ---------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------
create table appointments (
  id              uuid primary key default gen_random_uuid(),
  counsellor_id   uuid not null references profiles(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  service_id      uuid references service_types(id) on delete set null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          appointment_status not null default 'scheduled',
  title           text not null default 'Counselling session',
  location        text,
  meeting_url     text,
  client_notes    text,
  counsellor_notes text,
  -- The "base session fee" shown in the start-session dialog.
  price_cents     integer not null default 0 check (price_cents >= 0),
  currency        text not null default 'INR',
  booked_by       uuid references profiles(id) on delete set null,
  cancelled_by    uuid references profiles(id) on delete set null,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint appointments_time_order check (ends_at > starts_at)
);

-- A counsellor can never hold two live bookings that overlap.
alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    counsellor_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('scheduled', 'in_progress'));

create index appointments_counsellor_idx on appointments (counsellor_id, starts_at);
create index appointments_client_idx     on appointments (client_id, starts_at desc);
create index appointments_day_idx        on appointments (starts_at);

-- ---------------------------------------------------------------------
-- time_entries — billed session time (the Start/End timer)
-- ---------------------------------------------------------------------
create table time_entries (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references appointments(id) on delete cascade,
  counsellor_id   uuid not null references profiles(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  duration_minutes integer,
  source          time_entry_source not null default 'timer',
  note            text,
  created_at      timestamptz not null default now(),
  constraint time_entries_order check (ended_at is null or ended_at >= started_at)
);

create index time_entries_appointment_idx on time_entries (appointment_id);
create index time_entries_counsellor_idx  on time_entries (counsellor_id, started_at desc);

-- At most one running timer per appointment …
create unique index time_entries_one_open_per_appt_idx
  on time_entries (appointment_id) where ended_at is null;
-- … and at most one running timer per counsellor.
create unique index time_entries_one_open_per_counsellor_idx
  on time_entries (counsellor_id) where ended_at is null;

-- Stamp duration when a timer is closed.
create or replace function close_time_entry()
returns trigger language plpgsql as $$
begin
  if new.ended_at is not null then
    new.duration_minutes := greatest(
      1,
      ceil(extract(epoch from (new.ended_at - new.started_at)) / 60.0)::integer
    );
  end if;
  return new;
end;
$$;

create trigger time_entries_close
  before insert or update on time_entries
  for each row execute function close_time_entry();

-- ---------------------------------------------------------------------
-- staff_shifts — "Tap to check in" attendance, separate from session time
-- ---------------------------------------------------------------------
create table staff_shifts (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references profiles(id) on delete cascade,
  checked_in_at  timestamptz not null default now(),
  checked_out_at timestamptz,
  duration_minutes integer,
  note           text,
  created_at     timestamptz not null default now(),
  constraint staff_shifts_order check (checked_out_at is null or checked_out_at >= checked_in_at)
);

create index staff_shifts_staff_idx on staff_shifts (staff_id, checked_in_at desc);
create unique index staff_shifts_one_open_idx
  on staff_shifts (staff_id) where checked_out_at is null;

create or replace function close_staff_shift()
returns trigger language plpgsql as $$
begin
  if new.checked_out_at is not null then
    new.duration_minutes := greatest(
      1,
      ceil(extract(epoch from (new.checked_out_at - new.checked_in_at)) / 60.0)::integer
    );
  end if;
  return new;
end;
$$;

create trigger staff_shifts_close
  before insert or update on staff_shifts
  for each row execute function close_staff_shift();

-- ---------------------------------------------------------------------
-- invoices — one per appointment, settled manually (no gateway yet)
-- ---------------------------------------------------------------------
create sequence if not exists invoice_number_seq start 1000;

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  counsellor_id  uuid not null references profiles(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  number         text not null unique default ('NUR-' || nextval('invoice_number_seq')),
  amount_cents   integer not null default 0 check (amount_cents >= 0),
  currency       text not null default 'INR',
  status         invoice_status not null default 'unpaid',
  billed_minutes integer,
  issued_at      timestamptz not null default now(),
  due_at         timestamptz,
  paid_at        timestamptz,
  method         text,
  reference      text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index invoices_counsellor_idx on invoices (counsellor_id, status);
create index invoices_client_idx     on invoices (client_id, status);

-- ---------------------------------------------------------------------
-- team_messages — the "Message the team…" composer
-- ---------------------------------------------------------------------
create table team_messages (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references profiles(id) on delete cascade,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index team_messages_created_idx on team_messages (created_at desc);

-- ---------------------------------------------------------------------
-- notifications — in-app notification centre (the bell)
-- ---------------------------------------------------------------------
create table notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  kind           text not null,
  title          text not null,
  body           text not null,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- Idempotency ledger for outbound reminders — the unique constraint is
-- what stops the daily cron double-sending.
create table notification_deliveries (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  -- Stable identity for the recipient across both kinds of party:
  -- 'staff:<profile id>' or 'client:<client id>'. A plain (non-partial)
  -- unique constraint on this is what makes the reminder job idempotent
  -- AND upsertable, so a failed send can be retried tomorrow.
  recipient_key  text not null,
  recipient_id        uuid references profiles(id) on delete cascade,
  recipient_client_id uuid references clients(id) on delete cascade,
  recipient_label text,
  kind           text not null,
  channel        notify_channel not null,
  status         delivery_status not null,
  destination    text,
  error          text,
  attempts       integer not null default 1,
  sent_at        timestamptz not null default now(),
  unique (appointment_id, recipient_key, kind, channel)
);

create index notification_deliveries_appt_idx on notification_deliveries (appointment_id);

-- ---------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at     before update on profiles     for each row execute function set_updated_at();
create trigger clients_updated_at      before update on clients      for each row execute function set_updated_at();
create trigger appointments_updated_at before update on appointments for each row execute function set_updated_at();
create trigger invoices_updated_at     before update on invoices     for each row execute function set_updated_at();

-- New auth user -> profile. The very first account becomes the admin so
-- a fresh deployment is usable without hand-editing the database.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into is_first;

  insert into public.profiles (id, email, phone, full_name, avatar_url, role, onboarded)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when is_first then 'admin'::user_role else 'client'::user_role end,
    false
  )
  on conflict (id) do nothing;

  -- Link an existing client record with the same email or phone.
  update public.clients
     set user_id = new.id
   where user_id is null
     and (
       (new.email is not null and lower(email) = lower(new.email))
       or (new.phone is not null and phone = new.phone)
     );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table profiles                enable row level security;
alter table clients                 enable row level security;
alter table service_types           enable row level security;
alter table availability_rules      enable row level security;
alter table availability_exceptions enable row level security;
alter table appointments            enable row level security;
alter table time_entries            enable row level security;
alter table staff_shifts            enable row level security;
alter table invoices                enable row level security;
alter table team_messages           enable row level security;
alter table notifications           enable row level security;
alter table notification_deliveries enable row level security;

-- profiles: any signed-in user can read (the counsellor directory needs
-- it); you write only your own row; admins may write any.
create policy profiles_select on profiles
  for select to authenticated using (true);
create policy profiles_insert on profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_update_self on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on profiles
  for update to authenticated using (is_admin()) with check (is_admin());

-- clients: staff manage them; a linked client user reads their own record.
create policy clients_select on clients
  for select to authenticated
  using (is_staff() or user_id = auth.uid());
create policy clients_insert on clients
  for insert to authenticated with check (is_staff());
create policy clients_update on clients
  for update to authenticated
  using (is_staff() or user_id = auth.uid())
  with check (is_staff() or user_id = auth.uid());
create policy clients_delete on clients
  for delete to authenticated using (is_admin());

-- service_types & availability: readable by all signed-in users (clients
-- need them to see open slots); writable by the owner or an admin.
create policy service_types_select on service_types
  for select to authenticated using (true);
create policy service_types_write on service_types
  for all to authenticated
  using (counsellor_id = auth.uid() or is_admin())
  with check (counsellor_id = auth.uid() or is_admin());

create policy availability_rules_select on availability_rules
  for select to authenticated using (true);
create policy availability_rules_write on availability_rules
  for all to authenticated
  using (counsellor_id = auth.uid() or is_admin())
  with check (counsellor_id = auth.uid() or is_admin());

create policy availability_exceptions_select on availability_exceptions
  for select to authenticated using (true);
create policy availability_exceptions_write on availability_exceptions
  for all to authenticated
  using (counsellor_id = auth.uid() or is_admin())
  with check (counsellor_id = auth.uid() or is_admin());

-- appointments: staff see the whole schedule (it is a shared console);
-- a linked client sees only their own.
create policy appointments_select on appointments
  for select to authenticated
  using (
    is_staff()
    or exists (
      select 1 from clients c
      where c.id = appointments.client_id and c.user_id = auth.uid()
    )
  );
create policy appointments_insert on appointments
  for insert to authenticated
  with check (
    is_staff()
    or exists (
      select 1 from clients c
      where c.id = appointments.client_id and c.user_id = auth.uid()
    )
  );
create policy appointments_update on appointments
  for update to authenticated
  using (
    is_staff()
    or exists (
      select 1 from clients c
      where c.id = appointments.client_id and c.user_id = auth.uid()
    )
  )
  with check (
    is_staff()
    or exists (
      select 1 from clients c
      where c.id = appointments.client_id and c.user_id = auth.uid()
    )
  );
create policy appointments_delete on appointments
  for delete to authenticated using (is_admin());

-- time_entries: owned by the counsellor; admins oversee; the linked
-- client may read their own session's entries.
create policy time_entries_select on time_entries
  for select to authenticated
  using (
    counsellor_id = auth.uid()
    or is_admin()
    or exists (
      select 1 from appointments a
      join clients c on c.id = a.client_id
      where a.id = time_entries.appointment_id and c.user_id = auth.uid()
    )
  );
create policy time_entries_write on time_entries
  for all to authenticated
  using (counsellor_id = auth.uid() or is_admin())
  with check (counsellor_id = auth.uid() or is_admin());

-- staff_shifts: your own attendance; admins see everyone's.
create policy staff_shifts_select on staff_shifts
  for select to authenticated using (staff_id = auth.uid() or is_admin());
create policy staff_shifts_write on staff_shifts
  for all to authenticated
  using (staff_id = auth.uid() or is_admin())
  with check (staff_id = auth.uid() or is_admin());

-- invoices: staff manage; the linked client reads their own.
create policy invoices_select on invoices
  for select to authenticated
  using (
    is_staff()
    or exists (
      select 1 from clients c
      where c.id = invoices.client_id and c.user_id = auth.uid()
    )
  );
create policy invoices_write on invoices
  for all to authenticated
  using (counsellor_id = auth.uid() or is_admin())
  with check (counsellor_id = auth.uid() or is_admin());

-- team_messages: staff only — clients must never see the team channel.
create policy team_messages_select on team_messages
  for select to authenticated using (is_staff());
create policy team_messages_insert on team_messages
  for insert to authenticated with check (is_staff() and author_id = auth.uid());
create policy team_messages_delete on team_messages
  for delete to authenticated using (author_id = auth.uid() or is_admin());

-- notifications: strictly your own.
create policy notifications_select on notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_update on notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notification_deliveries: read-only audit; only the service-role cron writes.
create policy notification_deliveries_select on notification_deliveries
  for select to authenticated using (is_staff());

-- Realtime for the team channel and the bell.
alter publication supabase_realtime add table team_messages;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table appointments;
alter publication supabase_realtime add table time_entries;


-- ---------------------------------------------------------------------
-- from 0002_password_auth_and_admin_flag.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0002
--
-- 1. Admin becomes a FLAG rather than a role, so one person can be a
--    counsellor (with a lane on the schedule and their own sessions)
--    AND hold admin powers. The `admin` role value stays valid for
--    back-office accounts that never see clients.
-- 2. The first account to sign up is bootstrapped as a counsellor with
--    admin rights, so a fresh deployment is usable immediately.
-- =====================================================================

alter table profiles
  add column if not exists is_admin boolean not null default false;

-- Anyone already sitting on the admin role keeps the powers.
update profiles set is_admin = true where role = 'admin';

comment on column profiles.is_admin is
  'Admin powers. Independent of role so a counsellor can also be an admin.';

-- ---------------------------------------------------------------------
-- is_admin() now honours the flag as well as the legacy role.
-- ---------------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (is_admin = true or role = 'admin')
  );
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role in ('counsellor', 'admin') or is_admin = true)
  );
$$;

-- ---------------------------------------------------------------------
-- New sign-ups.
--
-- Password sign-up passes full_name and role through raw_user_meta_data;
-- the very first account is always a counsellor with admin rights so
-- there is somebody who can run the practice.
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first      boolean;
  desired_role  user_role;
begin
  select not exists (
    select 1 from public.profiles where is_admin = true or role = 'admin'
  ) into is_first;

  -- Only 'counsellor' and 'client' may be self-selected at sign-up;
  -- anything else falls back to client so the column cannot be forged.
  desired_role := case
    when new.raw_user_meta_data->>'role' = 'counsellor' then 'counsellor'::user_role
    else 'client'::user_role
  end;

  insert into public.profiles (
    id, email, phone, full_name, avatar_url, role, is_admin, onboarded
  )
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when is_first then 'counsellor'::user_role else desired_role end,
    is_first,
    false
  )
  on conflict (id) do nothing;

  -- Link any client record the practice already created for this person.
  update public.clients
     set user_id = new.id
   where user_id is null
     and (
       (new.email is not null and lower(email) = lower(new.email))
       or (new.phone is not null and phone = new.phone)
     );

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Admins may edit any profile; the policy has to read the new flag.
-- ---------------------------------------------------------------------
drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles
  for update to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Does the practice already have an admin?
--
-- The sign-up page needs this BEFORE anyone is signed in, but RLS limits
-- `profiles` to authenticated users, so a plain count from an anonymous
-- client always returns zero. SECURITY DEFINER answers the one boolean
-- question without exposing any row.
-- ---------------------------------------------------------------------
create or replace function public.practice_has_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where is_admin = true or role = 'admin'
  );
$$;

revoke all on function public.practice_has_admin() from public;
grant execute on function public.practice_has_admin() to anon, authenticated;


-- ---------------------------------------------------------------------
-- from 0003_support_role.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0003 — add the support role.
--
-- Kept in its own file on purpose: Postgres will not let a new enum
-- value be USED in the same transaction that adds it, and the Supabase
-- CLI runs each migration file in one transaction. 0004 uses it.
-- =====================================================================

-- (no-op here: 'support' is already part of the enum above)


-- ---------------------------------------------------------------------
-- from 0004_booking_desk.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0004 — the booking desk
--
-- Clients no longer book for themselves. They phone a support desk,
-- which captures their details and books on their behalf against a
-- counsellor's real availability.
--
--  * specialisms + languages, so the desk can match a caller's concern
--    to the right counsellor
--  * booking provenance on every appointment (who booked it, and how)
--  * clinical notes move OUT of `appointments` into their own table, so
--    reception staff can run the diary without reading case notes
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------

-- Reception / call desk: runs the diary, never reads clinical notes.
create or replace function is_support()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'support'
  );
$$;

-- Anyone who works here.
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role in ('counsellor', 'admin', 'support') or is_admin = true)
  );
$$;

-- Clinicians: the only people who may read or write session notes.
create or replace function is_clinical()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role in ('counsellor', 'admin') or is_admin = true)
  );
$$;

-- May run the practice: add counsellors, manage the diary and clients.
create or replace function can_manage_practice()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role in ('admin', 'support') or is_admin = true)
  );
$$;

-- ---------------------------------------------------------------------
-- Specialisms — what a counsellor actually helps with
-- ---------------------------------------------------------------------
create table specialisms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  description text,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table counsellor_specialisms (
  counsellor_id uuid not null references profiles(id) on delete cascade,
  specialism_id uuid not null references specialisms(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (counsellor_id, specialism_id)
);

create index counsellor_specialisms_specialism_idx
  on counsellor_specialisms (specialism_id);

insert into specialisms (name, slug, sort_order) values
  ('Anxiety',                    'anxiety',              10),
  ('Depression',                 'depression',           20),
  ('Stress & burnout',           'stress-burnout',       30),
  ('Relationships & couples',    'relationships',        40),
  ('Marriage & family',          'marriage-family',      50),
  ('Child & adolescent',         'child-adolescent',     60),
  ('Trauma & PTSD',              'trauma-ptsd',          70),
  ('Grief & loss',               'grief-loss',           80),
  ('Addiction & recovery',       'addiction',            90),
  ('Career & academic',          'career-academic',     100),
  ('Self-esteem & confidence',   'self-esteem',         110),
  ('Anger management',           'anger-management',    120),
  ('Sleep difficulties',         'sleep',               130),
  ('Eating & body image',        'eating-body-image',   140),
  ('LGBTQ+ support',             'lgbtq-support',       150),
  ('Workplace counselling',      'workplace',           160)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- Languages a counsellor can work in — matters as much as specialism
-- when a desk is matching a caller.
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists languages text[] not null default '{}';

comment on column profiles.languages is
  'Languages this counsellor can hold a session in.';

create index if not exists profiles_languages_idx on profiles using gin (languages);

-- ---------------------------------------------------------------------
-- Client details the desk captures on the call
-- ---------------------------------------------------------------------
alter table clients
  add column if not exists gender text,
  add column if not exists preferred_language text,
  add column if not exists presenting_concern text,
  add column if not exists preferred_specialism_id uuid references specialisms(id) on delete set null;

comment on column clients.presenting_concern is
  'What the caller said they need help with, in their own words.';

-- Repeat callers are found by phone, so make that lookup fast.
create index if not exists clients_phone_idx on clients (phone) where phone is not null;

-- ---------------------------------------------------------------------
-- Booking provenance
-- ---------------------------------------------------------------------
create type booking_channel as enum ('phone', 'walk_in', 'online', 'referral');

alter table appointments
  add column if not exists channel booking_channel not null default 'phone',
  add column if not exists booking_notes text;

comment on column appointments.channel is
  'How the booking reached us. The desk books by phone by default.';

-- ---------------------------------------------------------------------
-- Session notes move out of `appointments`.
--
-- RLS is row-level, and support staff must be able to read appointment
-- rows to run the diary — so a clinical-notes COLUMN on that table can
-- never be hidden from them. Its own table can be.
-- ---------------------------------------------------------------------
create table session_notes (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  counsellor_id  uuid not null references profiles(id) on delete cascade,
  body           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index session_notes_counsellor_idx on session_notes (counsellor_id);

create trigger session_notes_updated_at
  before update on session_notes
  for each row execute function set_updated_at();

-- Carry across anything already written, then drop the column.
insert into session_notes (appointment_id, counsellor_id, body)
select id, counsellor_id, counsellor_notes
from appointments
where counsellor_notes is not null and length(trim(counsellor_notes)) > 0
on conflict (appointment_id) do nothing;

alter table appointments drop column if exists counsellor_notes;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table specialisms            enable row level security;
alter table counsellor_specialisms enable row level security;
alter table session_notes          enable row level security;

-- Specialisms are a public vocabulary; only admins edit the list.
create policy specialisms_select on specialisms
  for select to authenticated using (true);
create policy specialisms_write on specialisms
  for all to authenticated using (is_admin()) with check (is_admin());

create policy counsellor_specialisms_select on counsellor_specialisms
  for select to authenticated using (true);
create policy counsellor_specialisms_write on counsellor_specialisms
  for all to authenticated
  using (counsellor_id = auth.uid() or can_manage_practice())
  with check (counsellor_id = auth.uid() or can_manage_practice());

-- Session notes: the treating counsellor and admins. Never support,
-- never the client.
create policy session_notes_select on session_notes
  for select to authenticated
  using (counsellor_id = auth.uid() or is_admin());
create policy session_notes_write on session_notes
  for all to authenticated
  using (counsellor_id = auth.uid() or is_admin())
  with check (counsellor_id = auth.uid() or is_admin());

-- ------------------------------------------------- appointments
-- Clients may no longer create bookings; the desk does it for them.
drop policy if exists appointments_insert on appointments;
create policy appointments_insert on appointments
  for insert to authenticated with check (is_staff());

-- Clients keep read access to their own sessions, and may no longer
-- edit them — rescheduling and cancelling go through the desk.
drop policy if exists appointments_update on appointments;
create policy appointments_update on appointments
  for update to authenticated using (is_staff()) with check (is_staff());

-- ------------------------------------------------------ clients
-- Support owns client records alongside counsellors.
drop policy if exists clients_insert on clients;
create policy clients_insert on clients
  for insert to authenticated with check (is_staff());

drop policy if exists clients_update on clients;
create policy clients_update on clients
  for update to authenticated
  using (is_staff() or user_id = auth.uid())
  with check (is_staff() or user_id = auth.uid());

-- ------------------------------------------------- availability
-- The desk feeds in counsellors' working hours.
drop policy if exists availability_rules_write on availability_rules;
create policy availability_rules_write on availability_rules
  for all to authenticated
  using (counsellor_id = auth.uid() or can_manage_practice())
  with check (counsellor_id = auth.uid() or can_manage_practice());

drop policy if exists availability_exceptions_write on availability_exceptions;
create policy availability_exceptions_write on availability_exceptions
  for all to authenticated
  using (counsellor_id = auth.uid() or can_manage_practice())
  with check (counsellor_id = auth.uid() or can_manage_practice());

drop policy if exists service_types_write on service_types;
create policy service_types_write on service_types
  for all to authenticated
  using (counsellor_id = auth.uid() or can_manage_practice())
  with check (counsellor_id = auth.uid() or can_manage_practice());

-- ----------------------------------------------------- invoices
-- The desk takes payment over the phone, so it may settle invoices.
drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices
  for all to authenticated
  using (counsellor_id = auth.uid() or can_manage_practice())
  with check (counsellor_id = auth.uid() or can_manage_practice());

-- ----------------------------------------------------- profiles
-- Support may maintain counsellor records (contact details, rates,
-- specialisms) but may not grant admin rights — that stays with admins,
-- enforced in the server action.
drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles
  for update to authenticated
  using (can_manage_practice()) with check (can_manage_practice());


-- ---------------------------------------------------------------------
-- from 0005_direct_messages_and_whatsapp.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0005 — staff direct messages + transactional WhatsApp
--
-- Two things:
--
-- 1. Direct messages. team_messages is a single broadcast channel; a
--    counsellor who needs a quiet word with one colleague or with the
--    admin had nowhere to go. A DM is modelled as a plain sender ->
--    recipient row rather than a conversations/participants pair: every
--    thread here is strictly 1:1, so a join table would buy nothing and
--    cost an extra RLS hop on the hottest read in the app.
--
-- 2. notifications.link, so a bell row can point somewhere other than an
--    appointment (a DM points at the thread that produced it).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: is SOME OTHER profile staff? is_staff() only answers for the
-- caller, and the DM insert policy has to vet the recipient too.
-- ---------------------------------------------------------------------
create or replace function is_staff_user(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = target
      and (role in ('counsellor', 'admin', 'support') or is_admin = true)
  );
$$;

-- ---------------------------------------------------------------------
-- notifications.link — where the bell row should take you
-- ---------------------------------------------------------------------
alter table notifications
  add column if not exists link text;

comment on column notifications.link is
  'Optional in-app path. Takes precedence over appointment_id when set.';

-- ---------------------------------------------------------------------
-- direct_messages — 1:1 staff chat
-- ---------------------------------------------------------------------
create table direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint direct_messages_not_self check (sender_id <> recipient_id)
);

-- Thread reads go both ways (my messages to you AND yours to me), so
-- index each direction rather than one composite the planner can only
-- use half of.
create index direct_messages_sender_idx    on direct_messages (sender_id, created_at desc);
create index direct_messages_recipient_idx on direct_messages (recipient_id, created_at desc);
create index direct_messages_unread_idx    on direct_messages (recipient_id, sender_id)
  where read_at is null;

alter table direct_messages enable row level security;

-- Only the two people in the thread can read it — admins included. An
-- admin overseeing the practice is still a participant like anyone else;
-- a private word between two counsellors stays private.
create policy direct_messages_select on direct_messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- You may only send AS yourself, only if you are staff, and only TO
-- staff. Clients must never appear in this table.
create policy direct_messages_insert on direct_messages
  for insert to authenticated
  with check (
    is_staff()
    and sender_id = auth.uid()
    and is_staff_user(recipient_id)
  );

-- Read receipts: only the recipient marks a message read.
create policy direct_messages_update on direct_messages
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Unsend your own; admins can remove anything.
create policy direct_messages_delete on direct_messages
  for delete to authenticated
  using (sender_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- A DM rings the recipient's bell.
--
-- security definer because notifications has no INSERT policy for
-- authenticated users on purpose — reminder rows are written by the
-- service-role cron. This trigger is the one narrow, audited exception,
-- and it can only ever write a row addressed to the message recipient.
-- ---------------------------------------------------------------------
create or replace function notify_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
begin
  select coalesce(nullif(trim(full_name), ''), 'A colleague')
    into sender_name
    from profiles where id = new.sender_id;

  insert into notifications (user_id, kind, title, body, link)
  values (
    new.recipient_id,
    'direct_message',
    sender_name || ' messaged you',
    left(new.body, 180),
    '/team?with=' || new.sender_id
  );

  return new;
end;
$$;

create trigger direct_messages_notify
  after insert on direct_messages
  for each row execute function notify_direct_message();

-- Live threads, same as the broadcast channel.
alter publication supabase_realtime add table direct_messages;


-- ---------------------------------------------------------------------
-- from 0006_reschedule_history.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0006 — rescheduling preserves history
--
-- ARCHITECTURE.md rule 7, marked MUST MATCH: rescheduling must NOT
-- mutate the existing row's date/time. It creates a brand-new
-- appointment and links the original to it, so the original booking
-- survives as a record. That is what lets the activity view show
-- "Cancelled — Reschedule to <date>" instead of losing the fact that
-- the earlier slot was ever booked.
-- =====================================================================

alter table appointments
  add column if not exists reschedule_status text,
  add column if not exists rescheduled_to_id   uuid references appointments(id) on delete set null,
  -- Not in the handoff, but the reverse link costs one column and is
  -- what lets the NEW appointment show where it came from.
  add column if not exists rescheduled_from_id uuid references appointments(id) on delete set null;

alter table appointments
  drop constraint if exists appointments_reschedule_status_check;

alter table appointments
  add constraint appointments_reschedule_status_check
  check (reschedule_status is null or reschedule_status in ('moved'));

-- A row that was moved must say where it went, and vice versa.
alter table appointments
  drop constraint if exists appointments_reschedule_link_check;

alter table appointments
  add constraint appointments_reschedule_link_check
  check (
    (reschedule_status is null and rescheduled_to_id is null)
    or (reschedule_status = 'moved' and rescheduled_to_id is not null)
  );

-- An appointment is moved at most once; the chain continues from the
-- new row, so two originals can never claim the same successor.
create unique index if not exists appointments_rescheduled_to_idx
  on appointments (rescheduled_to_id)
  where rescheduled_to_id is not null;

create index if not exists appointments_rescheduled_from_idx
  on appointments (rescheduled_from_id)
  where rescheduled_from_id is not null;

comment on column appointments.reschedule_status is
  'null = never moved. ''moved'' = superseded by rescheduled_to_id.';


-- ---------------------------------------------------------------------
-- from 0007_leave_and_holidays.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0007 — week-offs, leave and org-wide holidays
--
-- FUNCTIONAL-GUIDE.md §6 keeps these three deliberately distinct, and
-- the distinction is the whole point:
--
--   week_off  a counsellor's own planned day off, COUNTED against a
--             monthly quota that is computed, never stored
--             (see src/lib/business/weekoff.ts)
--   leave     any other day off logged for a counsellor, including one
--             auto-marked because they never checked in
--   holiday   an org-wide closure set by an admin; applies to everyone
--
-- Adapted to this stack: Express middleware checks in the handoff become
-- row-level security here.
-- =====================================================================

create type leave_kind as enum ('planned', 'sick', 'unpaid', 'auto');

-- ---------------------------------------------------------------------
-- holidays — org-wide, admin-set
-- ---------------------------------------------------------------------
create table holidays (
  id         uuid primary key default gen_random_uuid(),
  on_date    date not null unique,
  name       text not null check (length(trim(name)) > 0),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index holidays_date_idx on holidays (on_date);

-- ---------------------------------------------------------------------
-- week_offs — one row per counsellor per day taken
-- ---------------------------------------------------------------------
create table week_offs (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references profiles(id) on delete cascade,
  on_date    date not null,
  note       text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (staff_id, on_date)
);

create index week_offs_staff_idx on week_offs (staff_id, on_date);
create index week_offs_date_idx  on week_offs (on_date);

-- ---------------------------------------------------------------------
-- leaves — days off that are NOT week-offs
-- ---------------------------------------------------------------------
create table leaves (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references profiles(id) on delete cascade,
  on_date     date not null,
  kind        leave_kind not null default 'planned',
  reason      text,
  -- Null until an admin approves. 'auto' rows are never approved.
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (staff_id, on_date)
);

create index leaves_staff_idx on leaves (staff_id, on_date);
create index leaves_date_idx  on leaves (on_date);
create index leaves_pending_idx on leaves (staff_id) where approved_at is null;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table holidays  enable row level security;
alter table week_offs enable row level security;
alter table leaves    enable row level security;

-- Holidays close the clinic for everyone, so everyone signed in can read
-- them; only an admin sets them.
create policy holidays_select on holidays
  for select to authenticated using (true);
create policy holidays_write on holidays
  for all to authenticated using (is_admin()) with check (is_admin());

-- Week-offs are visible across the team: the diary has to show who is
-- off, and the handoff makes full schedule visibility deliberate.
create policy week_offs_select on week_offs
  for select to authenticated using (is_staff());
create policy week_offs_write on week_offs
  for all to authenticated
  using (staff_id = auth.uid() or is_admin())
  with check (staff_id = auth.uid() or is_admin());

-- Leave is closer to an HR record: your own, plus admins.
create policy leaves_select on leaves
  for select to authenticated using (staff_id = auth.uid() or is_admin());
create policy leaves_insert on leaves
  for insert to authenticated
  with check (staff_id = auth.uid() or is_admin());
create policy leaves_update on leaves
  for update to authenticated
  using (staff_id = auth.uid() or is_admin())
  with check (staff_id = auth.uid() or is_admin());
create policy leaves_delete on leaves
  for delete to authenticated
  using (staff_id = auth.uid() or is_admin());


-- ---------------------------------------------------------------------
-- from 0008_services_tags_and_interests.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0008 — service catalogue, appointment tags, and interests
--
-- Three things the booking dialog needs:
--
-- 1. SERVICES. A clinic-wide catalogue with ONE price each, exactly as
--    ARCHITECTURE.md rule 2 insists ("a service has one price"; the
--    advance is derived from it, never stored per service). The old
--    per-counsellor `service_types` table is left in place but is no
--    longer what a booking points at — every counsellor sells the same
--    list at the same price.
--
-- 2. TAGS. The configurable "appointment tag labels" from Settings,
--    shown to the counsellor under the client's name.
--
-- 3. INTERESTS. A lead who has NOT paid. The critical property is that
--    an interest must not hold the slot, which is why it lives in its
--    own table rather than as a flag on appointments: the overlap
--    exclusion constraint only guards appointments, so an interest
--    physically cannot lock a time.
-- =====================================================================

create type session_mode    as enum ('online', 'offline', 'offline_walk_in');
create type attachment_kind as enum ('none', 'recording', 'voice_note', 'note');
create type interest_status as enum ('scheduled', 'converted', 'dropped');
create type client_type     as enum ('new', 'follow_up');

-- ---------------------------------------------------------------------
-- services — the clinic's price list
-- ---------------------------------------------------------------------
create table services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique check (length(trim(name)) > 0),
  category         text,
  price_cents      integer not null check (price_cents >= 0),
  currency         text not null default 'INR',
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 480),
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index services_active_idx on services (is_active, sort_order, name);
create trigger services_updated_at before update on services
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- appointment_tags — short labels shown beside the client
-- ---------------------------------------------------------------------
create table appointment_tags (
  id           uuid primary key default gen_random_uuid(),
  label        text not null unique check (length(trim(label)) > 0),
  abbreviation text not null check (length(trim(abbreviation)) between 1 and 8),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- appointments — the dialog's extra fields
--
-- service_id is repointed at the new catalogue. tag_ids is an array
-- rather than a join table: the tag set is tiny and admin-managed, and
-- tags are soft-deleted (is_active = false) rather than removed, so a
-- dangling id cannot arise in normal use. Labels are always resolved
-- through appointment_tags, so an unknown id simply does not render.
-- ---------------------------------------------------------------------
alter table appointments
  drop constraint if exists appointments_service_id_fkey;

alter table appointments
  add constraint appointments_service_id_fkey
  foreign key (service_id) references services(id) on delete set null;

alter table appointments
  add column if not exists mode           session_mode not null default 'offline',
  add column if not exists client_type    client_type  not null default 'new',
  add column if not exists tag_ids        uuid[] not null default '{}',
  add column if not exists attachment     attachment_kind not null default 'none',
  add column if not exists attachment_note text,
  add column if not exists attachment_path text,
  -- Attachments are transient by policy: "automatically deleted after
  -- 30 days". This timestamp is what a cleanup job sweeps on.
  add column if not exists attachment_expires_at timestamptz,
  add column if not exists advance_cents  integer not null default 0 check (advance_cents >= 0),
  add column if not exists advance_paid_at timestamptz,
  add column if not exists advance_proof_path text;

create index if not exists appointments_tag_ids_idx on appointments using gin (tag_ids);
create index if not exists appointments_attachment_sweep_idx
  on appointments (attachment_expires_at)
  where attachment_expires_at is not null;

-- ---------------------------------------------------------------------
-- interests — a lead who has not paid, and holds no slot
-- ---------------------------------------------------------------------
create table interests (
  id            uuid primary key default gen_random_uuid(),

  -- Set when the caller is an existing client (a Follow-up); null for a
  -- brand-new enquiry whose details are captured inline below.
  client_id     uuid references clients(id) on delete set null,
  client_type   client_type not null default 'new',

  full_name     text not null check (length(trim(full_name)) > 0),
  gender        text,
  age           integer check (age is null or age between 0 and 120),
  whatsapp      text,

  service_id    uuid references services(id) on delete set null,
  counsellor_id uuid references profiles(id) on delete set null,

  -- A date only. An interest deliberately carries no start time: it is
  -- not holding a slot, so there is nothing to reserve.
  on_date       date,
  mode          session_mode not null default 'offline',

  tag_ids       uuid[] not null default '{}',
  attachment    attachment_kind not null default 'none',
  attachment_note text,
  attachment_path text,
  attachment_expires_at timestamptz,

  status        interest_status not null default 'scheduled',
  notes         text,

  -- Set once the lead pays and becomes a real booking.
  converted_appointment_id uuid unique references appointments(id) on delete set null,
  converted_at  timestamptz,

  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A converted interest must say what it became, and vice versa.
  constraint interests_converted_link_check check (
    (status = 'converted') = (converted_appointment_id is not null)
  )
);

create index interests_status_idx   on interests (status, on_date desc);
create index interests_date_idx     on interests (on_date desc);
create index interests_client_idx   on interests (client_id) where client_id is not null;
create index interests_tag_ids_idx  on interests using gin (tag_ids);
create index interests_whatsapp_idx on interests (whatsapp) where whatsapp is not null;

create trigger interests_updated_at before update on interests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table services         enable row level security;
alter table appointment_tags enable row level security;
alter table interests        enable row level security;

-- The price list is readable by anyone signed in (a client portal needs
-- it too); only an admin may change prices.
create policy services_select on services
  for select to authenticated using (true);
create policy services_write on services
  for all to authenticated using (is_admin()) with check (is_admin());

create policy appointment_tags_select on appointment_tags
  for select to authenticated using (true);
create policy appointment_tags_write on appointment_tags
  for all to authenticated using (is_admin()) with check (is_admin());

-- Interests hold raw contact details before any commitment, so the
-- handoff makes this list staff-only. Clients never see it.
create policy interests_select on interests
  for select to authenticated using (is_staff());
create policy interests_insert on interests
  for insert to authenticated with check (is_staff());
create policy interests_update on interests
  for update to authenticated using (is_staff()) with check (is_staff());
create policy interests_delete on interests
  for delete to authenticated using (is_admin());

-- ---------------------------------------------------------------------
-- Seed: the clinic's actual price list and tags
-- ---------------------------------------------------------------------
insert into appointment_tags (label, abbreviation, sort_order) values
  ('Counselling',   'CO',  10),
  ('Psychotherapy', 'PT',  20),
  ('Child',         'Ch',  30),
  ('Gestalt',       'Ges', 40);

insert into services (name, category, price_cents, sort_order) values
  ('General Therapy – Mental Health Care',                'General',            50000,  10),
  ('Special Session',                                     'General',            50000,  20),
  ('Individual Psychotherapy – Mental Health Care',       'General',           200000,  30),
  ('Advanced Individual Session',                         'General',           250000,  40),
  ('Mental Health Counselling & Psychotherapy Session',   'General',           300000,  50),

  ('Child Therapy',                                       'Child & adolescent', 200000, 110),
  ('Child Therapy & Parental Counselling',                'Child & adolescent', 200000, 120),
  ('Adolescent Counselling & Therapy',                    'Child & adolescent', 200000, 130),

  ('Couple Therapy',                                      'Couple',            300000, 210),
  ('Advance Couple Session',                              'Couple',            350000, 220),

  ('Family Counselling & Therapy (2 members)',            'Family',            300000, 310),
  ('Family Counselling & Therapy (3 members)',            'Family',            350000, 320),
  ('Family Counselling & Therapy (4 members)',            'Family',            400000, 330),
  ('Family Counselling & Therapy (5 members)',            'Family',            500000, 340),

  ('Geriatric Therapy – Clinic Session',                  'Geriatric',         300000, 410),
  ('Geriatric Therapy – Home Visit (Within 5 km)',        'Geriatric',         300000, 420),
  ('Geriatric Therapy – Home Visit (Above 5 km)',         'Geriatric',         400000, 430),

  ('NRI Individual Therapy',                              'NRI',               300000, 510),
  ('NRI Couple Therapy',                                  'NRI',               450000, 520),

  ('Psychological / Therapy Report',                       'Reports',            50000, 610);


-- ---------------------------------------------------------------------
-- from 0009_milestones_and_nubills.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0009 — the five appointment milestones
--
-- FUNCTIONAL-GUIDE.md §2: five milestones track an appointment, in
-- order, and an appointment only counts as "Completed" once ALL five
-- are done — not when the session ends. Reports and the activity view
-- read this same progress, so it is stored here rather than inferred
-- differently on each screen.
--
--   1 Personalize message   send the confirmation, opened via WhatsApp
--   2 Call the client       a courtesy call, marked done by hand
--   3 Start and end session  DERIVED from the session timer, never a
--                            manual tick — the timer is the truth
--   4 NuBills               paste the billing text once it is paid
--   5 Fill the Persona      the client's intake/assessment form
--
-- Milestone 3 has no column on purpose. It is computed from the
-- appointment's own status, so the tracker can never disagree with what
-- the timer actually did.
-- =====================================================================

alter table appointments
  add column if not exists message_sent_at timestamptz,
  add column if not exists call_made_at    timestamptz,
  add column if not exists nubill_at       timestamptz,
  add column if not exists persona_at      timestamptz;

comment on column appointments.message_sent_at is
  'Milestone 1. Set when the confirmation was actually opened/sent.';
comment on column appointments.call_made_at is
  'Milestone 2. Courtesy call, marked by hand.';
comment on column appointments.nubill_at is
  'Milestone 4. Set when billing text was logged — see nubills.';
comment on column appointments.persona_at is
  'Milestone 5. Set when the intake form was filled.';

-- Finding what still needs chasing is the common query.
create index if not exists appointments_milestone_open_idx
  on appointments (starts_at)
  where message_sent_at is null or call_made_at is null
     or nubill_at is null or persona_at is null;

-- ---------------------------------------------------------------------
-- nubills — the free-text billing log behind milestone 4
--
-- A counsellor pastes whatever billing confirmation they have (from a
-- payment app, WhatsApp, anywhere) and the app keeps the raw text
-- alongside whatever it could pull out of it. The raw text is the
-- record; the extracted fields are a convenience and may be wrong, so
-- they never overwrite the invoice.
-- ---------------------------------------------------------------------
create table nubills (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  raw_text       text not null check (length(trim(raw_text)) > 0),
  -- Best-effort parse of the pasted text. Advisory only.
  parsed_name    text,
  parsed_amount_cents integer check (parsed_amount_cents is null or parsed_amount_cents >= 0),
  parsed_reference text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index nubills_appointment_idx on nubills (appointment_id, created_at desc);

alter table nubills enable row level security;

-- A counsellor's own billing log, plus admins. Support staff run the
-- diary but do not handle this.
create policy nubills_select on nubills
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from appointments a
      where a.id = nubills.appointment_id and a.counsellor_id = auth.uid()
    )
  );
create policy nubills_insert on nubills
  for insert to authenticated
  with check (
    is_admin()
    or exists (
      select 1 from appointments a
      where a.id = nubills.appointment_id and a.counsellor_id = auth.uid()
    )
  );
create policy nubills_delete on nubills
  for delete to authenticated using (is_admin());


-- ---------------------------------------------------------------------
-- from 0010_clinic_settings_and_ops.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0010 — the remaining FUNCTIONAL-GUIDE.md §3 surfaces
--
--   clinic_settings          the singleton: pricing rules, geofence,
--                            message templates, sign-in copy
--   counsellor_permissions   the per-feature toggles
--   reviews                  Google Reviews log + monthly milestones
--   follow_ups               "send this to this client" reminders
--   commitments              a general task/promise tracker
--   benefits                 Resource Special Benefits for NuLancers
--   profiles.*               NuLancer flag, per-session rates, and the
--                            TPIN probation window
-- =====================================================================

-- ---------------------------------------------------------------------
-- clinic_settings — exactly one row, enforced
--
-- The billing numbers finally live here rather than in environment
-- variables. ARCHITECTURE.md rule 2 fixes the SHAPE of the advance
-- formula; these are the amounts it works on.
-- ---------------------------------------------------------------------
create table clinic_settings (
  id                       boolean primary key default true,
  -- The check plus the boolean primary key is what makes this a
  -- singleton: only `true` is a legal id, so a second row cannot exist.
  constraint clinic_settings_singleton check (id),

  practice_name            text not null default 'Nurora',

  -- Advance payment tiers (rule 2). Amounts in paise.
  advance_tier_threshold_cents integer not null default 0 check (advance_tier_threshold_cents >= 0),
  advance_at_or_below_cents    integer not null default 0 check (advance_at_or_below_cents >= 0),
  advance_above_cents          integer not null default 0 check (advance_above_cents >= 0),
  -- Booking modes that skip the tiers and demand the full price.
  full_payment_modes       text[] not null default array['online','offline_walk_in'],

  -- Session extension billing.
  included_minutes         integer not null default 60 check (included_minutes between 5 and 480),
  grace_minutes            integer not null default 0 check (grace_minutes >= 0),
  extension_block_minutes  integer not null default 15 check (extension_block_minutes between 1 and 240),
  extension_block_cents    integer not null default 0 check (extension_block_cents >= 0),
  -- 'gate'  = once grace is exceeded, bill from the end of included time
  -- 'deduct'= the grace minutes are free too
  grace_mode               text not null default 'gate' check (grace_mode in ('gate','deduct')),

  -- Attendance geofence. Two radii ON PURPOSE (rule 5): arriving is
  -- checked tightly, leaving leniently because someone may step out to
  -- a home visit before heading home. Do not unify them.
  clinic_latitude          double precision,
  clinic_longitude         double precision,
  check_in_radius_m        integer not null default 150 check (check_in_radius_m between 10 and 5000),
  check_out_radius_m       integer not null default 1000 check (check_out_radius_m between 10 and 50000),
  geofence_enforced        boolean not null default false,

  -- Client-facing copy. {{name}} and {{date}} are substituted.
  confirmation_template    text,
  -- Sign-in screen decoration.
  signin_quote             text,
  designer_credit_url      text,

  -- NuLancer per-session pay.
  nulancer_individual_cents integer not null default 0 check (nulancer_individual_cents >= 0),
  nulancer_couple_cents     integer not null default 0 check (nulancer_couple_cents >= 0),

  -- Google Reviews target per counsellor per month.
  review_monthly_target    integer not null default 0 check (review_monthly_target >= 0),

  updated_by               uuid references profiles(id) on delete set null,
  updated_at               timestamptz not null default now()
);

create trigger clinic_settings_updated_at before update on clinic_settings
  for each row execute function set_updated_at();

insert into clinic_settings (id) values (true);

-- ---------------------------------------------------------------------
-- counsellor_permissions — the per-feature switches
--
-- Absent row means "everything on". Only an explicit false hides a
-- feature, so adding a counsellor never silently locks them out.
-- ---------------------------------------------------------------------
create table counsellor_permissions (
  counsellor_id uuid primary key references profiles(id) on delete cascade,
  attendance    boolean not null default true,
  nubills       boolean not null default true,
  persona       boolean not null default true,
  bric          boolean not null default true,
  reviews       boolean not null default true,
  follow_ups    boolean not null default true,
  my_summary    boolean not null default true,
  week_offs     boolean not null default true,
  updated_at    timestamptz not null default now()
);

create trigger counsellor_permissions_updated_at before update on counsellor_permissions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- reviews — Google Reviews log
-- ---------------------------------------------------------------------
create table reviews (
  id            uuid primary key default gen_random_uuid(),
  counsellor_id uuid references profiles(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  client_name   text not null check (length(trim(client_name)) > 0),
  rating        integer check (rating is null or rating between 1 and 5),
  body          text,
  review_url    text,
  reviewed_on   date not null default current_date,
  logged_by     uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index reviews_counsellor_month_idx on reviews (counsellor_id, reviewed_on desc);
create index reviews_date_idx on reviews (reviewed_on desc);

-- ---------------------------------------------------------------------
-- follow_ups — "send this thing to this client"
--
-- completed_via records HOW it was finished. The guide is firm that
-- ticking one off opens WhatsApp rather than merely marking it done, so
-- the column exists to make a silent fake-complete visible.
-- ---------------------------------------------------------------------
create table follow_ups (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  counsellor_id uuid references profiles(id) on delete set null,
  what          text not null check (length(trim(what)) > 0),
  due_on        date not null default current_date,
  completed_at  timestamptz,
  completed_via text check (completed_via is null or completed_via in ('whatsapp','manual')),
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint follow_ups_completion_check check (
    (completed_at is null) = (completed_via is null)
  )
);

create index follow_ups_open_idx on follow_ups (due_on) where completed_at is null;
create index follow_ups_counsellor_idx on follow_ups (counsellor_id, due_on);

create trigger follow_ups_updated_at before update on follow_ups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- commitments — a general task / promise tracker
-- ---------------------------------------------------------------------
create table commitments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  detail     text,
  due_on     date,
  done_at    timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commitments_owner_idx on commitments (owner_id, due_on);
create index commitments_open_idx on commitments (owner_id) where done_at is null;

create trigger commitments_updated_at before update on commitments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- benefits — Resource Special Benefits, assigned to NuLancers
-- ---------------------------------------------------------------------
create table benefits (
  id            uuid primary key default gen_random_uuid(),
  counsellor_id uuid not null references profiles(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  detail        text,
  value_cents   integer check (value_cents is null or value_cents >= 0),
  granted_on    date not null default current_date,
  expires_on    date,
  granted_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index benefits_counsellor_idx on benefits (counsellor_id, granted_on desc);

-- ---------------------------------------------------------------------
-- profiles — NuLancer status and the TPIN probation window
--
-- Adapted to this stack: sign-in stays email + password, so the TPIN is
-- a TEMPORARY password with an expiry plus a signed agreement, rather
-- than a separate PIN. Same paper trail, no second auth system.
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists is_nulancer boolean not null default false,
  add column if not exists nulancer_individual_cents integer,
  add column if not exists nulancer_couple_cents integer,
  -- Set when a temporary password is issued; sign-in is refused after it.
  add column if not exists tpin_expires_at timestamptz,
  -- Set when they accept the terms and choose their own password.
  add column if not exists signup_completed_at timestamptz,
  add column if not exists must_change_password boolean not null default false;

comment on column profiles.tpin_expires_at is
  'Probation window for an issued temporary password. Null once signup is complete.';

create index if not exists profiles_nulancer_idx on profiles (is_nulancer) where is_nulancer;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table clinic_settings         enable row level security;
alter table counsellor_permissions  enable row level security;
alter table reviews                 enable row level security;
alter table follow_ups              enable row level security;
alter table commitments             enable row level security;
alter table benefits                enable row level security;

-- Settings are read by everyone signed in (prices and templates drive
-- the booking dialog); only an admin writes them.
create policy clinic_settings_select on clinic_settings
  for select to authenticated using (true);
create policy clinic_settings_write on clinic_settings
  for all to authenticated using (is_admin()) with check (is_admin());

-- You can see your own switches; only an admin sets anyone's.
create policy counsellor_permissions_select on counsellor_permissions
  for select to authenticated
  using (counsellor_id = auth.uid() or is_admin());
create policy counsellor_permissions_write on counsellor_permissions
  for all to authenticated using (is_admin()) with check (is_admin());

-- Reviews and follow-ups are practice-wide staff data.
create policy reviews_select on reviews
  for select to authenticated using (is_staff());
create policy reviews_write on reviews
  for all to authenticated using (is_staff()) with check (is_staff());

create policy follow_ups_select on follow_ups
  for select to authenticated using (is_staff());
create policy follow_ups_write on follow_ups
  for all to authenticated using (is_staff()) with check (is_staff());

-- Commitments are personal: yours, plus an admin's oversight.
create policy commitments_select on commitments
  for select to authenticated using (owner_id = auth.uid() or is_admin());
create policy commitments_write on commitments
  for all to authenticated
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- Benefits: your own, and admins manage them.
create policy benefits_select on benefits
  for select to authenticated using (counsellor_id = auth.uid() or is_admin());
create policy benefits_write on benefits
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------------------------------------------------------------------
-- from 0011_attachment_storage.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0011 — a private bucket for booking attachments
--
-- The booking dialog could record WHICH kind of attachment there was
-- (recording, voice note, note) and when it expires, but had nowhere to
-- put the file. This adds the bucket and its policies.
--
-- Private on purpose: these are recordings and notes attached to a
-- counselling session. Nothing here is served by public URL — the app
-- issues short-lived signed URLs instead, so a leaked path is useless
-- on its own.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  -- 25 MB. A voice note or a short recording fits; a long video does
  -- not, and should not be going through a booking form.
  26214400,
  array[
    'audio/mpeg','audio/mp4','audio/m4a','audio/x-m4a','audio/wav',
    'audio/webm','audio/ogg','video/mp4','video/webm',
    'image/png','image/jpeg','image/webp','application/pdf','text/plain'
  ]
)
on conflict (id) do nothing;

-- Staff only, in both directions. Clients never reach this bucket, and
-- objects are addressed under a per-appointment prefix so a path cannot
-- be guessed from another booking's id alone.
create policy attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and is_staff());

create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and is_staff());

create policy attachments_update on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and is_staff())
  with check (bucket_id = 'attachments' and is_staff());

-- Only an admin removes one by hand; the retention sweep runs as the
-- service role and is not bound by this.
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and is_admin());


-- ---------------------------------------------------------------------
-- from 0012_message_templates.sql
-- ---------------------------------------------------------------------

-- =====================================================================
-- Migration 0012 — editable message templates, and schedules for them
--
-- Until now the client-facing copy lived in a TypeScript file and there
-- was exactly one schedule: a reminder hard-coded to three days before
-- (LEAD_DAYS in the cron route). Changing either meant a developer and
-- a deploy.
--
-- Two tables:
--
--   message_templates   the wording, per channel, with placeholders
--   message_schedules   when to send one, relative to an appointment
--
-- WHAT THIS DELIBERATELY DOES NOT DO: recurring broadcasts to everyone
-- ("message all clients every Monday"). WhatsApp treats that as
-- marketing — it needs a marketing-category template, prior opt-in, and
-- it is the fastest way to get a sender blocked. Every schedule here
-- hangs off a real appointment, which is what Meta calls a utility
-- message and what a clinic actually needs.
-- =====================================================================

create type message_trigger as enum (
  'before_appointment',
  'after_appointment',
  'on_booking',
  'on_reschedule',
  'on_cancel'
);

create type message_audience as enum ('client', 'counsellor', 'both');

-- ---------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------
create table message_templates (
  id          uuid primary key default gen_random_uuid(),
  -- Stable slug so code can find a specific one (the booking
  -- confirmation) without depending on its display name.
  key         text not null unique check (key ~ '^[a-z0-9_]+$'),
  name        text not null check (length(trim(name)) > 0),
  description text,

  channel     notify_channel not null default 'whatsapp',

  -- The wording. Placeholders are {{client_name}}, {{counsellor_name}},
  -- {{date}}, {{time}}, {{date_time}}, {{service}}, {{practice}},
  -- {{location}} — see business/render-message.ts, which is the one
  -- place that knows how to fill them.
  body        text not null check (length(trim(body)) > 0),

  -- An approved WhatsApp template registered with Meta. Production
  -- needs one for anything business-initiated; without it Twilio sends
  -- free-form, which the sandbox accepts and production may not.
  content_sid text,
  -- Which placeholders map to {{1}}, {{2}} … in that approved template.
  -- Order matters and must match how it was registered.
  variables   text[] not null default '{}',

  is_active   boolean not null default true,
  -- A built-in template may be edited but not deleted: code refers to
  -- some of them by key, and losing one would break sending silently.
  is_system   boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger message_templates_updated_at before update on message_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- message_schedules
-- ---------------------------------------------------------------------
create table message_schedules (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references message_templates(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),

  trigger     message_trigger not null,
  -- How long before or after the appointment. Ignored by the on_* kinds,
  -- which fire the moment the thing happens.
  offset_minutes integer not null default 0 check (offset_minutes >= 0),

  audience    message_audience not null default 'client',
  is_active   boolean not null default true,

  last_run_at timestamptz,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Two schedules on the same template at the same moment would send
  -- the client the same words twice.
  unique (template_id, trigger, offset_minutes, audience)
);

create index message_schedules_active_idx on message_schedules (trigger)
  where is_active;

create trigger message_schedules_updated_at before update on message_schedules
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS — staff read (the app renders from these), admins write
-- ---------------------------------------------------------------------
alter table message_templates enable row level security;
alter table message_schedules enable row level security;

create policy message_templates_select on message_templates
  for select to authenticated using (is_staff());
create policy message_templates_write on message_templates
  for all to authenticated using (is_admin()) with check (is_admin());

create policy message_schedules_select on message_schedules
  for select to authenticated using (is_staff());
create policy message_schedules_write on message_schedules
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Seed: exactly what the app sends today, so nothing changes behaviour
-- until someone edits it.
-- ---------------------------------------------------------------------
insert into message_templates (key, name, description, channel, body, variables, is_system)
values
  (
    'booking_confirmation',
    'Booking confirmation',
    'Sent as soon as a session is booked.',
    'whatsapp',
    '*Appointment Confirmation*

Hi {{client_name}}, 

          Your appointment has been confirmed for *{{date_time}}.*
          Kindly arrive at the clinic at least *10 minutes* before your scheduled time.

*Important Note:* We kindly request you to avoid rescheduling or canceling your appointment, as this time is reserved exclusively for you. Each slot is precious and could be used to support someone in urgent need.

                          Thank you for your understanding. We’re here to help, and we look forward to seeing you!',
    array['client_name','date_time'],
    true
  ),
  (
    'session_reminder',
    'Session reminder',
    'A nudge before the session. Scheduled below.',
    'whatsapp',
    '*Appointment Reminder*

Hi {{client_name}},

Your session with {{counsellor_name}} is coming up on *{{date_time}}*.

{{location}}

If you need to change it, reply to this message and we will help.

— {{practice}}',
    array['client_name','date_time'],
    true
  ),
  (
    'post_session_followup',
    'After the session',
    'A thank-you and a nudge to book again.',
    'whatsapp',
    '*Thank you*

Hi {{client_name}},

Thank you for coming in on {{date}}. We hope it was helpful.

If you would like to book your next session with {{counsellor_name}}, just reply here.

— {{practice}}',
    array['client_name','date'],
    false
  );

-- The reminder that used to be LEAD_DAYS = 3, now data.
insert into message_schedules (template_id, name, trigger, offset_minutes, audience)
select id, 'Three days before', 'before_appointment', 3 * 24 * 60, 'both'
from message_templates where key = 'session_reminder';

-- Left switched off: sending it is a decision for the practice, not a
-- default that starts messaging clients the moment this ships.
insert into message_schedules (template_id, name, trigger, offset_minutes, audience, is_active)
select id, 'Morning after the session', 'after_appointment', 16 * 60, 'client', false
from message_templates where key = 'post_session_followup';

