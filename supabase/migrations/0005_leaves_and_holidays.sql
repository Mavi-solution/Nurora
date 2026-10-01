-- Leaves and holidays, shared across every device — same pattern as
-- every table before it. Today an admin marking a holiday, or a
-- counsellor applying for leave, only ever changes what their own
-- phone thinks the calendar looks like.
--
-- Both have a real delete path — removeLeave and removeHoliday both
-- filter the record out entirely, unlike clients/appointments, which
-- only ever get edited or status-flagged. The sync code has to push
-- deletes here, not just upserts.

do $$
begin
  if to_regclass('public.leaves') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leaves' and column_name = 'counsellor_id')
  then
    execute 'alter table public.leaves rename to leaves_pre_rebuild';
  end if;
  if to_regclass('public.holidays') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'holidays' and column_name = 'label')
  then
    execute 'alter table public.holidays rename to holidays_pre_rebuild';
  end if;
end $$;

create table if not exists public.leaves (
  id text primary key,
  counsellor_id text references public.counsellors(id) on delete cascade,
  type text not null default 'Leave',
  from_date text not null,
  to_date text not null,
  half boolean not null default false,
  half_from text,
  half_till text,
  units numeric not null default 0,
  paid_units numeric not null default 0,
  lop_units numeric not null default 0,
  month_key text,
  synced_at timestamptz not null default now()
);

create table if not exists public.holidays (
  id text primary key,
  date text not null,
  type text not null default 'Holiday',
  label text,
  synced_at timestamptz not null default now()
);

create index if not exists leaves_counsellor_month_idx on public.leaves (counsellor_id, month_key);
-- Named _v2, not `holidays_date_idx`: the old, renamed-out-of-the-way
-- holidays table already had an index by that exact name, and
-- `create index if not exists` treats "a name already taken" the same
-- as "already built" — it would have silently skipped ever indexing
-- this new table at all.
create index if not exists holidays_date_v2_idx on public.holidays (date);

alter table public.leaves enable row level security;
alter table public.holidays enable row level security;

-- Same trust level as clients/appointments/invoices/sessions: any
-- signed-in staff member. Applying for leave has never been
-- admin-only — a counsellor applies for their own.
drop policy if exists leaves_staff_all on public.leaves;
create policy leaves_staff_all on public.leaves
  for all to authenticated
  using (true)
  with check (true);

-- Marking a holiday has always been admin-only in the UI — same rule
-- enforced where it actually matters, same as counsellors/settings.
drop policy if exists holidays_select_authenticated on public.holidays;
create policy holidays_select_authenticated on public.holidays
  for select to authenticated
  using (true);

drop policy if exists holidays_admin_write on public.holidays;
create policy holidays_admin_write on public.holidays
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leaves'
  ) then
    alter publication supabase_realtime add table public.leaves;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'holidays'
  ) then
    alter publication supabase_realtime add table public.holidays;
  end if;
end $$;
