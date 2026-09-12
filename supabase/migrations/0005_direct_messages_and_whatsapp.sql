-- =====================================================================
-- Migration 0005 — staff direct messages + transactional WhatsApp
--
-- Two things:
--
-- 1. Direct messages. team_messages is a single broadcast channel; a
--    counsellor who needs a quiet word with one colleague or with the
--    admin had nowhere to go. A DM is modelled as a plain sender ->
--    recipient row rather than a conversations/participants pair: every
--    thread here is strictly 1:1, so a join table would buy nothing and
--    cost an extra RLS hop on the hottest read in the app.
--
-- 2. notifications.link, so a bell row can point somewhere other than an
--    appointment (a DM points at the thread that produced it).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: is SOME OTHER profile staff? is_staff() only answers for the
-- caller, and the DM insert policy has to vet the recipient too.
-- ---------------------------------------------------------------------
create or replace function is_staff_user(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = target
      and (role in ('counsellor', 'admin', 'support') or is_admin = true)
  );
$$;

-- ---------------------------------------------------------------------
-- notifications.link — where the bell row should take you
-- ---------------------------------------------------------------------
alter table notifications
  add column if not exists link text;

comment on column notifications.link is
  'Optional in-app path. Takes precedence over appointment_id when set.';

-- ---------------------------------------------------------------------
-- direct_messages — 1:1 staff chat
-- ---------------------------------------------------------------------
create table direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint direct_messages_not_self check (sender_id <> recipient_id)
);

-- Thread reads go both ways (my messages to you AND yours to me), so
-- index each direction rather than one composite the planner can only
-- use half of.
create index direct_messages_sender_idx    on direct_messages (sender_id, created_at desc);
create index direct_messages_recipient_idx on direct_messages (recipient_id, created_at desc);
create index direct_messages_unread_idx    on direct_messages (recipient_id, sender_id)
  where read_at is null;

alter table direct_messages enable row level security;

-- Only the two people in the thread can read it — admins included. An
-- admin overseeing the practice is still a participant like anyone else;
-- a private word between two counsellors stays private.
create policy direct_messages_select on direct_messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- You may only send AS yourself, only if you are staff, and only TO
-- staff. Clients must never appear in this table.
create policy direct_messages_insert on direct_messages
  for insert to authenticated
  with check (
    is_staff()
    and sender_id = auth.uid()
    and is_staff_user(recipient_id)
  );

-- Read receipts: only the recipient marks a message read.
create policy direct_messages_update on direct_messages
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Unsend your own; admins can remove anything.
create policy direct_messages_delete on direct_messages
  for delete to authenticated
  using (sender_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- A DM rings the recipient's bell.
--
-- security definer because notifications has no INSERT policy for
-- authenticated users on purpose — reminder rows are written by the
-- service-role cron. This trigger is the one narrow, audited exception,
-- and it can only ever write a row addressed to the message recipient.
-- ---------------------------------------------------------------------
create or replace function notify_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
begin
  select coalesce(nullif(trim(full_name), ''), 'A colleague')
    into sender_name
    from profiles where id = new.sender_id;

  insert into notifications (user_id, kind, title, body, link)
  values (
    new.recipient_id,
    'direct_message',
    sender_name || ' messaged you',
    left(new.body, 180),
    '/team?with=' || new.sender_id
  );

  return new;
end;
$$;

create trigger direct_messages_notify
  after insert on direct_messages
  for each row execute function notify_direct_message();

-- Live threads, same as the broadcast channel.
alter publication supabase_realtime add table direct_messages;
