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
