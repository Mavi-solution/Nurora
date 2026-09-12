-- =====================================================================
-- Migration 0009 — the five appointment milestones
--
-- FUNCTIONAL-GUIDE.md §2: five milestones track an appointment, in
-- order, and an appointment only counts as "Completed" once ALL five
-- are done — not when the session ends. Reports and the activity view
-- read this same progress, so it is stored here rather than inferred
-- differently on each screen.
--
--   1 Personalize message   send the confirmation, opened via WhatsApp
--   2 Call the client       a courtesy call, marked done by hand
--   3 Start and end session  DERIVED from the session timer, never a
--                            manual tick — the timer is the truth
--   4 NuBills               paste the billing text once it is paid
--   5 Fill the Persona      the client's intake/assessment form
--
-- Milestone 3 has no column on purpose. It is computed from the
-- appointment's own status, so the tracker can never disagree with what
-- the timer actually did.
-- =====================================================================

alter table appointments
  add column if not exists message_sent_at timestamptz,
  add column if not exists call_made_at    timestamptz,
  add column if not exists nubill_at       timestamptz,
  add column if not exists persona_at      timestamptz;

comment on column appointments.message_sent_at is
  'Milestone 1. Set when the confirmation was actually opened/sent.';
comment on column appointments.call_made_at is
  'Milestone 2. Courtesy call, marked by hand.';
comment on column appointments.nubill_at is
  'Milestone 4. Set when billing text was logged — see nubills.';
comment on column appointments.persona_at is
  'Milestone 5. Set when the intake form was filled.';

-- Finding what still needs chasing is the common query.
create index if not exists appointments_milestone_open_idx
  on appointments (starts_at)
  where message_sent_at is null or call_made_at is null
     or nubill_at is null or persona_at is null;

-- ---------------------------------------------------------------------
-- nubills — the free-text billing log behind milestone 4
--
-- A counsellor pastes whatever billing confirmation they have (from a
-- payment app, WhatsApp, anywhere) and the app keeps the raw text
-- alongside whatever it could pull out of it. The raw text is the
-- record; the extracted fields are a convenience and may be wrong, so
-- they never overwrite the invoice.
-- ---------------------------------------------------------------------
create table nubills (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  raw_text       text not null check (length(trim(raw_text)) > 0),
  -- Best-effort parse of the pasted text. Advisory only.
  parsed_name    text,
  parsed_amount_cents integer check (parsed_amount_cents is null or parsed_amount_cents >= 0),
  parsed_reference text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index nubills_appointment_idx on nubills (appointment_id, created_at desc);

alter table nubills enable row level security;

-- A counsellor's own billing log, plus admins. Support staff run the
-- diary but do not handle this.
create policy nubills_select on nubills
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from appointments a
      where a.id = nubills.appointment_id and a.counsellor_id = auth.uid()
    )
  );
create policy nubills_insert on nubills
  for insert to authenticated
  with check (
    is_admin()
    or exists (
      select 1 from appointments a
      where a.id = nubills.appointment_id and a.counsellor_id = auth.uid()
    )
  );
create policy nubills_delete on nubills
  for delete to authenticated using (is_admin());
