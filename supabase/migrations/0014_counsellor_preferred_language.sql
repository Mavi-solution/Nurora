-- =====================================================================
-- Migration 0014 — a counsellor's preferred working language
--
-- "Add prefer language while councilor creating account".
--
-- profiles.languages already records every language a counsellor CAN
-- hold a session in, and the booking desk matches on it. That is not
-- the same question as which one they would rather work in, and the
-- difference matters at the desk: a counsellor who lists English,
-- Tamil and Hindi but prefers Tamil should be offered first to a Tamil
-- caller, and described to an English caller as someone who can work
-- in English rather than someone who chooses to.
--
-- Mirrors clients.preferred_language, which has existed since 0001, so
-- both sides of a match are described the same way.
-- =====================================================================

alter table profiles
  add column if not exists preferred_language text;

comment on column profiles.preferred_language is
  'The language this counsellor would rather work in. Must be one of '
  'languages[]; enforced in the app rather than by a constraint, since '
  'languages[] is edited in the same form and a check would fight it.';

-- Seed it from what each counsellor already lists first, so nobody
-- starts out with a blank preference they never chose to leave blank.
update profiles
   set preferred_language = languages[1]
 where preferred_language is null
   and languages is not null
   and array_length(languages, 1) > 0;
