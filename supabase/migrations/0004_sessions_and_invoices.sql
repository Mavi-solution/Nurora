-- Sessions and invoices, shared across every device — same pattern as
-- clients and appointments, and for the same reason: today, whether a
-- session ran, how long it ran, and what it billed all live only in
-- whichever browser ended it.
--
-- Created together, in that order, by one action (`endSession`): ending
-- a session writes a new invoice, then stamps that invoice's id onto
-- the session record. sessions.invoice_id is a foreign key to a row
-- that is, at the moment of creation, brand new — so invoices has to
-- exist first, and the sync code below pushes them in that order in
-- one timer for exactly the reason clients-before-appointments did:
-- reversing it means the session's own foreign key gets rejected by a
-- row that hasn't landed yet, and nothing surfaces that failure.
-- Same landmine as 0002: a hosted project that ran the old app already
-- has an `invoices` table, uuid-keyed and shaped for that schema.
-- Renamed out of the way, never dropped, same reasoning as before.
do $$
begin
  if to_regclass('public.invoices') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'payment_status')
  then
    execute 'alter table public.invoices rename to invoices_pre_rebuild';
  end if;
end $$;

create table if not exists public.invoices (
  id text primary key,
  number text,
  date text not null,
  appointment_id text references public.appointments(id) on delete set null,
  client_id text references public.clients(id) on delete set null,
  counsellor_id text references public.counsellors(id) on delete set null,
  session_date text,
  started_at bigint,
  ended_at bigint,
  duration_sec integer not null default 0,
  base numeric not null default 0,
  additional numeric not null default 0,
  gst numeric not null default 0,
  total numeric not null default 0,
  extra_minutes numeric not null default 0,
  advance numeric not null default 0,
  payment_status text not null default 'Pending',
  created_at bigint not null,
  synced_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id text primary key,
  appointment_id text references public.appointments(id) on delete set null,
  counsellor_id text references public.counsellors(id) on delete set null,
  started_at bigint not null,
  ended_at bigint,
  duration_sec integer not null default 0,
  invoice_id text references public.invoices(id) on delete set null,
  synced_at timestamptz not null default now()
);

create index if not exists invoices_appointment_id_idx on public.invoices (appointment_id);
create index if not exists invoices_client_id_idx on public.invoices (client_id);
create index if not exists sessions_appointment_id_idx on public.sessions (appointment_id);

alter table public.invoices enable row level security;
alter table public.sessions enable row level security;

-- Same trust level as clients/appointments: any signed-in staff member,
-- not admins only — starting and ending a session, and settling an
-- invoice, has never been admin-gated in this app.
drop policy if exists invoices_staff_all on public.invoices;
create policy invoices_staff_all on public.invoices
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists sessions_staff_all on public.sessions;
create policy sessions_staff_all on public.sessions
  for all to authenticated
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table public.invoices;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end $$;
