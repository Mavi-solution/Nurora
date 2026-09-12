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
