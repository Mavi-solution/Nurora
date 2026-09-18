-- =====================================================================
-- Migration 0012 — editable message templates, and schedules for them
--
-- Until now the client-facing copy lived in a TypeScript file and there
-- was exactly one schedule: a reminder hard-coded to three days before
-- (LEAD_DAYS in the cron route). Changing either meant a developer and
-- a deploy.
--
-- Two tables:
--
--   message_templates   the wording, per channel, with placeholders
--   message_schedules   when to send one, relative to an appointment
--
-- WHAT THIS DELIBERATELY DOES NOT DO: recurring broadcasts to everyone
-- ("message all clients every Monday"). WhatsApp treats that as
-- marketing — it needs a marketing-category template, prior opt-in, and
-- it is the fastest way to get a sender blocked. Every schedule here
-- hangs off a real appointment, which is what Meta calls a utility
-- message and what a clinic actually needs.
-- =====================================================================

create type message_trigger as enum (
  'before_appointment',
  'after_appointment',
  'on_booking',
  'on_reschedule',
  'on_cancel'
);

create type message_audience as enum ('client', 'counsellor', 'both');

-- ---------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------
create table message_templates (
  id          uuid primary key default gen_random_uuid(),
  -- Stable slug so code can find a specific one (the booking
  -- confirmation) without depending on its display name.
  key         text not null unique check (key ~ '^[a-z0-9_]+$'),
  name        text not null check (length(trim(name)) > 0),
  description text,

  channel     notify_channel not null default 'whatsapp',

  -- The wording. Placeholders are {{client_name}}, {{counsellor_name}},
  -- {{date}}, {{time}}, {{date_time}}, {{service}}, {{practice}},
  -- {{location}} — see business/render-message.ts, which is the one
  -- place that knows how to fill them.
  body        text not null check (length(trim(body)) > 0),

  -- An approved WhatsApp template registered with Meta. Production
  -- needs one for anything business-initiated; without it Twilio sends
  -- free-form, which the sandbox accepts and production may not.
  content_sid text,
  -- Which placeholders map to {{1}}, {{2}} … in that approved template.
  -- Order matters and must match how it was registered.
  variables   text[] not null default '{}',

  is_active   boolean not null default true,
  -- A built-in template may be edited but not deleted: code refers to
  -- some of them by key, and losing one would break sending silently.
  is_system   boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger message_templates_updated_at before update on message_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- message_schedules
-- ---------------------------------------------------------------------
create table message_schedules (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references message_templates(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),

  trigger     message_trigger not null,
  -- How long before or after the appointment. Ignored by the on_* kinds,
  -- which fire the moment the thing happens.
  offset_minutes integer not null default 0 check (offset_minutes >= 0),

  audience    message_audience not null default 'client',
  is_active   boolean not null default true,

  last_run_at timestamptz,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Two schedules on the same template at the same moment would send
  -- the client the same words twice.
  unique (template_id, trigger, offset_minutes, audience)
);

create index message_schedules_active_idx on message_schedules (trigger)
  where is_active;

create trigger message_schedules_updated_at before update on message_schedules
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS — staff read (the app renders from these), admins write
-- ---------------------------------------------------------------------
alter table message_templates enable row level security;
alter table message_schedules enable row level security;

create policy message_templates_select on message_templates
  for select to authenticated using (is_staff());
create policy message_templates_write on message_templates
  for all to authenticated using (is_admin()) with check (is_admin());

create policy message_schedules_select on message_schedules
  for select to authenticated using (is_staff());
create policy message_schedules_write on message_schedules
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Seed: exactly what the app sends today, so nothing changes behaviour
-- until someone edits it.
-- ---------------------------------------------------------------------
insert into message_templates (key, name, description, channel, body, variables, is_system)
values
  (
    'booking_confirmation',
    'Booking confirmation',
    'Sent as soon as a session is booked.',
    'whatsapp',
    '*Appointment Confirmation*

Hi {{client_name}}, 

          Your appointment has been confirmed for *{{date_time}}.*
          Kindly arrive at the clinic at least *10 minutes* before your scheduled time.

*Important Note:* We kindly request you to avoid rescheduling or canceling your appointment, as this time is reserved exclusively for you. Each slot is precious and could be used to support someone in urgent need.

                          Thank you for your understanding. We’re here to help, and we look forward to seeing you!',
    array['client_name','date_time'],
    true
  ),
  (
    'session_reminder',
    'Session reminder',
    'A nudge before the session. Scheduled below.',
    'whatsapp',
    '*Appointment Reminder*

Hi {{client_name}},

Your session with {{counsellor_name}} is coming up on *{{date_time}}*.

{{location}}

If you need to change it, reply to this message and we will help.

— {{practice}}',
    array['client_name','date_time'],
    true
  ),
  (
    'post_session_followup',
    'After the session',
    'A thank-you and a nudge to book again.',
    'whatsapp',
    '*Thank you*

Hi {{client_name}},

Thank you for coming in on {{date}}. We hope it was helpful.

If you would like to book your next session with {{counsellor_name}}, just reply here.

— {{practice}}',
    array['client_name','date'],
    false
  );

-- The reminder that used to be LEAD_DAYS = 3, now data.
insert into message_schedules (template_id, name, trigger, offset_minutes, audience)
select id, 'Three days before', 'before_appointment', 3 * 24 * 60, 'both'
from message_templates where key = 'session_reminder';

-- Left switched off: sending it is a decision for the practice, not a
-- default that starts messaging clients the moment this ships.
insert into message_schedules (template_id, name, trigger, offset_minutes, audience, is_active)
select id, 'Morning after the session', 'after_appointment', 16 * 60, 'client', false
from message_templates where key = 'post_session_followup';
