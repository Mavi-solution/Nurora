-- =====================================================================
-- Migration 0015 — the Persona intake form
--
-- Persona was a READ-ONLY list of clients showing whatever the booking
-- desk happened to have typed into presenting_concern. There was no
-- intake form behind it, so the milestone called "Fill the Persona"
-- captured two fields and the screen named after it had nothing else
-- to show.
--
-- The form is an intake/assessment: background, concern, and how they
-- found the clinic — asked every time — plus a set of facts that only
-- need asking once. Splitting them that way is the whole point: on a
-- first visit the counsellor asks for address, area, education and
-- occupation; on a follow-up those are already on file and the form
-- skips straight past them.
--
-- All of it lives on `clients` rather than in its own table, because a
-- Persona is a description of a PERSON, not of a session. One client
-- has one Persona however many times they come in — a second table
-- would immediately raise the question of which row is current.
-- =====================================================================

alter table clients
  -- Asked at every intake.
  add column if not exists background        text,
  add column if not exists referral_source   text,

  -- Asked once, then carried forward.
  add column if not exists address           text,
  add column if not exists area              text,
  add column if not exists education         text,
  add column if not exists occupation        text,

  -- When the once-only half was last completed, and by whom. Null
  -- means nobody has taken it yet, which is what makes a visit "first"
  -- for the form's purposes — see business/persona.ts. Deliberately
  -- NOT derived from a count of appointments: a client can be booked
  -- three times before anyone sits down and takes their details.
  add column if not exists intake_completed_at timestamptz,
  add column if not exists intake_completed_by uuid references profiles(id) on delete set null;

comment on column clients.background is
  'Personal and clinical background, in the counsellor''s words. Asked at every intake.';
comment on column clients.referral_source is
  'How they found the clinic — referral, search, a previous client. Asked at every intake.';
comment on column clients.intake_completed_at is
  'Set once the once-only details (address, area, education, occupation) '
  'have been taken. Null means the next visit is still a first visit as '
  'far as the intake form is concerned.';

-- Persona is searched by name and phone and filtered by when the client
-- was added; the ordering index earns its keep on a practice with a few
-- thousand clients.
create index if not exists clients_intake_idx
  on clients (intake_completed_at nulls first, created_at desc);
