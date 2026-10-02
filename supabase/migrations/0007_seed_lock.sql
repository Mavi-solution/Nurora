-- Closes a real race in every `seed*IfEmpty` function added by the
-- migrations before this one: each checks "is the table empty?" and,
-- if so, inserts this device's local data as the shared starting
-- point. That check and that insert are two separate round trips, not
-- one atomic step — when two devices hit the empty check within the
-- same short window (two counsellors each signing in for the first
-- time minutes apart, or one admin opening the app in two tabs), both
-- see "empty" and both insert, and because each device's local demo
-- data is built by `seed()` in the app with a fresh random id every
-- time (`uid("c")`, not a fixed constant), the two inserts don't even
-- collide on a shared primary key — they land as entirely separate
-- rows. Confirmed in production: "Deepa", "Ashika", "Nithyashree" and
-- "Saranya" each exist twice under different ids, from two devices
-- that both won this race during initial rollout.
--
-- The fix doesn't touch the seed functions' data logic at all — it
-- gives them a single shared gate to race against instead of an
-- empty-table check. Claiming a row here is a single atomic INSERT;
-- Postgres guarantees only one concurrent transaction can ever win a
-- given primary key, so however many devices ask at once, only one
-- proceeds to seed and every other one sees its own insert rejected
-- and skips, same as the original comment in counsellors-sync.js
-- intended but couldn't actually achieve with random per-device ids.
create table if not exists public.seed_locks (
  key text primary key,
  locked_at timestamptz not null default now(),
  locked_by uuid
);

alter table public.seed_locks enable row level security;

-- Any signed-in staff member can attempt to claim a lock — that's the
-- whole mechanism, so it can't be admin-only. Nobody ever needs to read
-- these rows for their content, only to have attempted the insert, but
-- select is harmless to allow and simplifies debugging.
drop policy if exists seed_locks_staff_all on public.seed_locks;
create policy seed_locks_staff_all on public.seed_locks
  for all to authenticated
  using (true)
  with check (true);
