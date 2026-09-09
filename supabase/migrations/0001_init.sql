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
create type user_role as enum ('client', 'counsellor', 'admin');
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
