-- =====================================================================
-- Migration 0006 — rescheduling preserves history
--
-- ARCHITECTURE.md rule 7, marked MUST MATCH: rescheduling must NOT
-- mutate the existing row's date/time. It creates a brand-new
-- appointment and links the original to it, so the original booking
-- survives as a record. That is what lets the activity view show
-- "Cancelled — Reschedule to <date>" instead of losing the fact that
-- the earlier slot was ever booked.
-- =====================================================================

alter table appointments
  add column if not exists reschedule_status text,
  add column if not exists rescheduled_to_id   uuid references appointments(id) on delete set null,
  -- Not in the handoff, but the reverse link costs one column and is
  -- what lets the NEW appointment show where it came from.
  add column if not exists rescheduled_from_id uuid references appointments(id) on delete set null;

alter table appointments
  drop constraint if exists appointments_reschedule_status_check;

alter table appointments
  add constraint appointments_reschedule_status_check
  check (reschedule_status is null or reschedule_status in ('moved'));

-- A row that was moved must say where it went, and vice versa.
alter table appointments
  drop constraint if exists appointments_reschedule_link_check;

alter table appointments
  add constraint appointments_reschedule_link_check
  check (
    (reschedule_status is null and rescheduled_to_id is null)
    or (reschedule_status = 'moved' and rescheduled_to_id is not null)
  );

-- An appointment is moved at most once; the chain continues from the
-- new row, so two originals can never claim the same successor.
create unique index if not exists appointments_rescheduled_to_idx
  on appointments (rescheduled_to_id)
  where rescheduled_to_id is not null;

create index if not exists appointments_rescheduled_from_idx
  on appointments (rescheduled_from_id)
  where rescheduled_from_id is not null;

comment on column appointments.reschedule_status is
  'null = never moved. ''moved'' = superseded by rescheduled_to_id.';
