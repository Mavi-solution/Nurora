-- Practice settings, shared across every device — third slice of the
-- same migration. This is the one that actually closes the loop on
-- the original complaint: an admin configuring the extension fee, the
-- payment QR, the service list or anything else on Settings has, until
-- now, only ever changed their own phone's private copy. Every other
-- counsellor kept billing against whatever was in their own browser.
--
-- Unlike counsellors, clients and appointments, there is exactly one
-- row here — a practice has one set of settings, not many — so this
-- is modelled as a genuine singleton table rather than one row per
-- something. `id` is fixed at 'practice' and every write upserts that
-- same row; nothing in the app ever needs a second one.
--
-- The settings object itself is one big, loosely-structured
-- configuration blob — pricing, service list, message templates,
-- policy text, tag definitions — with no relational structure and
-- nothing else in the schema ever needs to query into it by field.
-- Mapping its ~30 fields onto individual typed columns, the way
-- counsellors and appointments did, would be a lot of surface for a
-- table that is read and written as one object everywhere it's used.
-- It is kept as a single JSONB column instead; the translation layer
-- reads and writes it wholesale, exactly how nurora-app.jsx already
-- treats `data.settings`.
create table if not exists public.settings (
  id text primary key default 'practice',
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

-- Every signed-in staff member reads it — pricing and policy text have
-- to reach every counsellor's phone, not just admins'.
drop policy if exists settings_select_authenticated on public.settings;
create policy settings_select_authenticated on public.settings
  for select to authenticated
  using (true);

-- Only an admin can change it — Settings has always been an
-- admin-only screen in the UI; this is the same rule enforced where
-- it actually matters.
drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'settings'
  ) then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;
