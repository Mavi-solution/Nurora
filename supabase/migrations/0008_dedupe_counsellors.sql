-- One-time cleanup for the race 0007 closes going forward: this
-- project already has duplicate counsellor rows from two devices each
-- winning the old "table is empty, seed it" check around the same
-- moment. Only ever touches rows with profile_id is null — a
-- demo-seeded row nobody has signed into yet. A counsellor who has
-- actually signed in is never a candidate for merging or deletion here,
-- no matter what their name is.
do $$
declare
  dup record;
  keeper_id text;
begin
  for dup in
    select name
    from public.counsellors
    where profile_id is null
    group by name
    having count(*) > 1
  loop
    -- The oldest row for this name is kept; every foreign key pointing
    -- at a newer duplicate is repointed at it first, so no appointment,
    -- session, invoice or leave record silently loses its counsellor —
    -- it only ever loses a redundant duplicate that had nothing
    -- pointing at it in the first place, or gains a merged history.
    select id into keeper_id
    from public.counsellors
    where name = dup.name and profile_id is null
    order by created_at asc
    limit 1;

    update public.appointments set counsellor_id = keeper_id
      where counsellor_id in (
        select id from public.counsellors where name = dup.name and profile_id is null and id <> keeper_id
      );
    update public.sessions set counsellor_id = keeper_id
      where counsellor_id in (
        select id from public.counsellors where name = dup.name and profile_id is null and id <> keeper_id
      );
    update public.invoices set counsellor_id = keeper_id
      where counsellor_id in (
        select id from public.counsellors where name = dup.name and profile_id is null and id <> keeper_id
      );
    update public.leaves set counsellor_id = keeper_id
      where counsellor_id in (
        select id from public.counsellors where name = dup.name and profile_id is null and id <> keeper_id
      );

    delete from public.counsellors
      where name = dup.name and profile_id is null and id <> keeper_id;
  end loop;
end $$;

-- This project is already established — every table below either
-- already holds real data (lock it, so the new lock-checking seed
-- functions never try to seed an established roster or client list
-- again) or is legitimately still empty (leave it unlocked, so a real
-- first seed can still happen for it later, exactly once, the normal
-- way). Re-running this migration is harmless either way.
insert into public.seed_locks (key)
select 'counsellors' where exists (select 1 from public.counsellors)
union all
select 'clients_appointments' where exists (select 1 from public.clients) or exists (select 1 from public.appointments)
union all
select 'settings' where exists (select 1 from public.settings)
union all
select 'sessions_invoices' where exists (select 1 from public.sessions) or exists (select 1 from public.invoices)
union all
select 'leaves_holidays' where exists (select 1 from public.leaves) or exists (select 1 from public.holidays)
on conflict (key) do nothing;
