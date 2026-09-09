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
