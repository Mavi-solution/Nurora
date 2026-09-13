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
