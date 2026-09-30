-- Clients and appointments, shared across every device — the second
-- slice of the same migration the counsellors table started. Once this
-- lands, the schedule board itself is finally the same board on every
-- phone, not a private guess.
--
-- Same id convention as counsellors: TEXT, matching the app's own
-- uid("cl") / uid("a") strings, so nothing that already compares these
-- ids throughout the app has to change.
--
-- Unlike counsellors, both tables here are writable by any signed-in
-- staff member, not admins only. That matches what the app already
-- does — booking, editing and cancelling a session has never been
-- admin-only, any counsellor or the desk can do it — this only adds
-- "and you must be signed in" on top of a client-trust model that
-- today has no enforcement at all. Narrowing further (e.g. only the
-- assigned counsellor or an admin may cancel a specific appointment,
-- which the UI already steers toward via `canRun`) is a deliberately
-- separate, later tightening rather than bundled into this migration.

-- A hosted project that ever ran the old, deleted server app already
-- has tables called `clients` and `appointments` — a completely
-- different shape (uuid ids, `full_name`, `preferred_specialism_id`,
-- Supabase-generated timestamps, none of what this needs). `create
-- table if not exists` would see a table by that name and silently do
-- nothing, then every insert below would fail against the wrong
-- columns. Renaming out of the way — never dropping — is what makes
-- this migration safe to run against a database that might still hold
-- real client data from before: nothing is deleted, it just moves
-- somewhere with an obvious name until someone who can see its
-- contents decides what to do with it.
do $$
begin
  if to_regclass('public.clients') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'whatsapp')
  then
    execute 'alter table public.clients rename to clients_pre_rebuild';
  end if;
  if to_regclass('public.appointments') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name = 'date')
  then
    execute 'alter table public.appointments rename to appointments_pre_rebuild';
  end if;
end $$;

create table if not exists public.clients (
  id text primary key,
  name text not null,
  age text not null default '',
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  category text not null default '',
  mode text not null default '',
  gender text not null default '',
  whatsapp text not null default '',
  parent_name text not null default '',
  guardian_name text not null default '',
  persona jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id text primary key,
  date text not null,
  counsellor_id text references public.counsellors(id) on delete set null,
  client_id text references public.clients(id) on delete set null,
  time text not null,
  type text,
  advance numeric not null default 0,
  chips jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  status text not null default 'Scheduled',
  note text not null default '',
  category text not null default '',
  mode text not null default '',

  attachment_type text,
  attachment_note text not null default '',
  attachment_file_name text,
  attachment_audio_data text,
  attachment_duration_sec integer not null default 0,
  attachment_expires_at bigint,
  payment_screenshot_name text,

  milestone integer not null default 0,
  is_followup boolean not null default false,
  message_sent boolean not null default false,
  message_sent_at bigint,
  call_made boolean not null default false,
  bill_logged boolean not null default false,
  persona_filled boolean not null default false,
  reviewed_by_counsellor boolean not null default false,

  cancel_type text,
  refund_status text,
  cancel_reason text,
  reschedule_status text,
  reschedule_reason text,
  rescheduled_from_id text,
  rescheduled_to_id text,

  -- The app's own timestamp, set once at booking and never touched
  -- again — kept distinct from `synced_at` below, which is this row's
  -- own bookkeeping and has nothing to do with when the app thinks the
  -- appointment was created.
  created_at bigint not null,
  synced_at timestamptz not null default now()
);

create index if not exists appointments_date_idx on public.appointments (date);
create index if not exists appointments_counsellor_date_idx on public.appointments (counsellor_id, date);
create index if not exists appointments_client_id_idx on public.appointments (client_id);

alter table public.clients enable row level security;
alter table public.appointments enable row level security;

drop policy if exists clients_staff_all on public.clients;
create policy clients_staff_all on public.clients
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists appointments_staff_all on public.appointments;
create policy appointments_staff_all on public.appointments
  for all to authenticated
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients'
  ) then
    alter publication supabase_realtime add table public.clients;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- The old app's sign-up trigger reaches into `public.clients` to link a
-- pre-existing client record to whoever just signed up with a matching
-- email or phone — that table is gone now, renamed above, and the new
-- one has no `user_id` column for it to set. Left as it was, this
-- trigger would fail on every single sign-up from this point on,
-- because it still runs on every insert into auth.users regardless of
-- which app is live. This app has no concept of a client logging in at
-- all — only counsellors have accounts — so that step is simply
-- removed rather than repointed at anything.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  is_first      boolean;
  desired_role  user_role;
begin
  select not exists (
    select 1 from public.profiles where is_admin = true or role = 'admin'
  ) into is_first;

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

  return new;
end;
$fn$;
