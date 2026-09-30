-- Counsellors, shared across every device.
--
-- Everything the app knows today lives only in whichever browser is
-- signed in — two people on two phones are silently looking at two
-- different, diverging rosters. This is the first of several tables
-- that move the app's data onto a real shared backend; counsellors
-- goes first because it is also the fix for a live bug: a counsellor
-- an admin pre-creates today has no way to ever be matched to the
-- account they sign up with, so they end up with a second, empty,
-- orphaned record instead of the one the admin configured.
--
-- `id` stays TEXT, matching the app's own uid("c") strings (e.g.
-- "c_muk86dxlrhie9"), rather than switching to a Postgres uuid. The
-- running app compares these ids in hundreds of places across every
-- other table (appointments.counsellorId, leaves.counsellorId, …), so
-- keeping the same id shape here — and in every table that follows —
-- means none of that comparison code has to change, only where the
-- value comes from.
create table if not exists public.counsellors (
  id text primary key,

  -- Set once this record is matched to a signed-in account (by email,
  -- on first sign-in) or created directly from one. Null means "admin
  -- configured this person but they haven't signed in yet" — the exact
  -- state an invited counsellor sits in before they accept.
  profile_id uuid references auth.users(id) on delete set null,
  email text,

  name text not null,
  role text not null default 'Counsellor',
  work_start text not null default '09:00',
  work_end text not null default '20:00',
  slots jsonb not null default '[]'::jsonb,
  week_off_dates jsonb not null default '{}'::jsonb,
  day_exceptions jsonb not null default '{}'::jsonb,
  slot_overrides jsonb not null default '{}'::jsonb,

  pin text,
  active boolean not null default true,
  is_nulancer boolean not null default false,
  is_owner boolean not null default false,

  -- tpin: temporary, issued at creation or reset, expires with probation.
  -- mpin: permanent, only exists once the signup agreement is signed.
  -- Neither is still how sign-in works (that's the account's password /
  -- Face ID now) — these remain for the paper-trail screens that show
  -- them and for the signup-agreement flow, unchanged from before.
  account_status text not null default 'tpin',
  tpin text,
  mpin text,
  probation_from text,
  probation_to text,

  personal_phone text not null default '',
  blood_group text not null default '',
  aadhar_image text,
  business_phone text not null default '',
  dob text not null default '',
  date_of_joining text not null default '',
  photo text,

  agreement_signed_at bigint,
  signature_data_url text,
  front_page_text_override text,
  agreement_agree_text_override text,

  benefits_enabled boolean not null default false,
  benefits jsonb not null default '[]'::jsonb,
  permissions jsonb not null default '{}'::jsonb,
  work_hours_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists counsellors_email_idx on public.counsellors (lower(email)) where email is not null;
create index if not exists counsellors_profile_id_idx on public.counsellors (profile_id) where profile_id is not null;

alter table public.counsellors enable row level security;

-- Every signed-in staff member sees the whole roster — the schedule
-- board has always shown every counsellor's lane to everyone, not just
-- an admin.
drop policy if exists counsellors_select_authenticated on public.counsellors;
create policy counsellors_select_authenticated on public.counsellors
  for select to authenticated
  using (true);

-- Admins configure the roster: create, edit anyone, delete.
drop policy if exists counsellors_admin_all on public.counsellors;
create policy counsellors_admin_all on public.counsellors
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- A counsellor may update their own row (My Details: name, DOB, phone,
-- Aadhar, photo, signature) once it is linked to their account — but
-- never insert or delete themselves, and never edit someone else's row.
--
-- The `profile_id is null and lower(email) = lower(auth.email())` half
-- exists for exactly one moment: the first time someone signs in whose
-- email matches a counsellor an admin already created. Nothing has
-- linked the two yet — that link is itself a write to this row — so
-- without this clause the very update that would set profile_id has
-- nothing to satisfy "using" with. It only ever widens access to a row
-- whose own email already matches the signed-in account.
drop policy if exists counsellors_self_update on public.counsellors;
create policy counsellors_self_update on public.counsellors
  for update to authenticated
  using (profile_id = auth.uid() or (profile_id is null and lower(email) = lower(auth.email())))
  with check (profile_id = auth.uid());

-- So another signed-in device sees a change within seconds instead of
-- on its next full reload. Guarded — re-adding a table already in the
-- publication is a hard error, not a no-op, unlike every other
-- statement in this file.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'counsellors'
  ) then
    alter publication supabase_realtime add table public.counsellors;
  end if;
end $$;
