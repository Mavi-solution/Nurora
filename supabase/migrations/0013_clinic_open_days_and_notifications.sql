-- =====================================================================
-- Migration 0013 — clinic opening days, and clearable notifications
--
-- Both come from the QA sheet:
--
--   "Don't display the adding new window option in closed days"
--   "Clear the appointment confirmation history in notifications bar"
--
-- The first needs somewhere to record which weekdays the clinic is
-- open at all. Until now that was implicit — a counsellor simply had
-- no hours on a Sunday — which is not the same statement: "nobody has
-- set Sunday hours yet" and "the clinic does not open on Sunday" look
-- identical to the booking desk but mean opposite things to whoever is
-- filling the rota in.
--
-- The second needs a DELETE policy. Notifications were readable and
-- markable-as-read but never removable, so a month of booking
-- confirmations piled up with no way to clear them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- clinic_settings.open_weekdays
--
-- 0 = Sunday .. 6 = Saturday, matching Postgres' extract(dow) and the
-- weekday column on availability_rules, so the three never need
-- translating between each other.
--
-- Default is Monday–Saturday: the practice's actual week, and the one
-- that makes the existing data correct rather than retroactively
-- closing days people already have hours on.
-- ---------------------------------------------------------------------
alter table clinic_settings
  add column if not exists open_weekdays smallint[] not null
    default array[1,2,3,4,5,6];

alter table clinic_settings
  drop constraint if exists clinic_settings_open_weekdays_valid;

alter table clinic_settings
  add constraint clinic_settings_open_weekdays_valid check (
    open_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    and array_length(open_weekdays, 1) is not null
  );

comment on column clinic_settings.open_weekdays is
  'Weekdays the clinic opens at all, 0=Sunday. Working hours cannot be '
  'set on a day that is not in here, and no slot is ever offered on one.';

-- ---------------------------------------------------------------------
-- notifications: let people clear their own
--
-- Scoped exactly like the existing select and update policies — your
-- own row and nobody else's. An admin has no special power here on
-- purpose: someone else's notification list is not an admin surface.
-- ---------------------------------------------------------------------
drop policy if exists notifications_delete on notifications;

create policy notifications_delete on notifications
  for delete to authenticated using (user_id = auth.uid());
