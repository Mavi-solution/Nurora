-- Closes a real gap in migration 0001: a brand-new counsellor signing
-- up for the first time — no admin pre-created them — was never able
-- to write their own record to the shared table at all. RLS only ever
-- granted INSERT to admins (`counsellors_admin_all`); the app's own
-- code (resolveIdentity) awaited exactly this write before ever
-- handing back a signed-in user, and it was failing every single time,
-- silently — nothing checked the result, so a self-registered
-- counsellor could use the app on their own device indefinitely while
-- being invisible to every other one, never actually present in
-- Postgres at all. Confirmed by hand: a foreign key from a fresh
-- appointment to that counsellor's own id was rejected with "not
-- present in table \"counsellors\"".
--
-- The fix is narrow on purpose: a signed-in account may insert a
-- counsellor row only when that row's own profile_id is their own —
-- so this only ever lets someone create a record for themselves, never
-- for anyone else, and never more than the one row resolveIdentity
-- actually creates.
drop policy if exists counsellors_self_insert on public.counsellors;
create policy counsellors_self_insert on public.counsellors
  for insert to authenticated
  with check (profile_id = auth.uid());
