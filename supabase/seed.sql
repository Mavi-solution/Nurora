-- =====================================================================
-- Nurora demo seed — OPTIONAL.
--
-- Creates the five counsellors, an admin, a handful of clients and a
-- day of appointments so the schedule board looks alive immediately.
-- Run it in the Supabase SQL editor AFTER 0001_init.sql.
--
-- Demo password for every seeded account: nurora1234
-- (Sign in with Google/OTP instead for real accounts — these exist so
--  the board is not empty on first load.)
-- =====================================================================

create extension if not exists pgcrypto;

do $$
declare
  staff        text[][] := array[
    ['Anisha',  'anisha@nurora.demo',  'counsellor'],
    ['Shefrin', 'shefrin@nurora.demo', 'counsellor'],
    ['Ramya',   'ramya@nurora.demo',   'counsellor'],
    ['Mahek',   'mahek@nurora.demo',   'counsellor'],
    ['Saranya', 'saranya@nurora.demo', 'counsellor'],
    ['Solulu Admin', 'admin@nurora.demo', 'admin']
  ];
  i            integer;
  uid          uuid;
  person_name  text;
  person_email text;
  person_role  text;
begin
  for i in 1 .. array_length(staff, 1) loop
    person_name  := staff[i][1];
    person_email := staff[i][2];
    person_role  := staff[i][3];

    -- Skip if this demo account already exists.
    select id into uid from auth.users where email = person_email;
    if uid is null then
      uid := gen_random_uuid();

      -- The token columns MUST be '' rather than NULL: GoTrue scans them
      -- into non-nullable Go strings, and a NULL there makes every login
      -- fail with "Database error finding user".
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token,
        email_change, email_change_token_new, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        uid,
        'authenticated',
        'authenticated',
        person_email,
        crypt('nurora1234', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', person_name),
        now(), now(),
        '', '', '', '', '', '', '', ''
      );
    end if;

    -- handle_new_user() created the profile; set the demo role + defaults.
    update public.profiles
       set full_name = person_name,
           role      = person_role::user_role,
           onboarded = true,
           timezone  = 'Asia/Kolkata',
           currency  = 'INR',
           default_session_fee_cents = 200000,   -- ₹2,000
           default_duration_minutes  = 60,
           hourly_rate_cents         = 200000,
           notify_email = true
     where id = uid;
  end loop;
end $$;

-- --------------------------------------------------------------- hours
-- Mon–Sat, 09:00–19:00 for every counsellor that has no rules yet.
insert into availability_rules (counsellor_id, weekday, start_time, end_time)
select p.id, d.weekday, time '09:00', time '19:00'
from profiles p
cross join (select generate_series(1, 6) as weekday) d
where p.role = 'counsellor'
  and not exists (select 1 from availability_rules r where r.counsellor_id = p.id);

-- ------------------------------------------------------------ services
insert into service_types (counsellor_id, name, duration_minutes, price_cents, currency)
select p.id, 'Individual counselling', 60, 200000, 'INR'
from profiles p
where p.role = 'counsellor'
  and not exists (select 1 from service_types s where s.counsellor_id = p.id);

-- ------------------------------------------------------------- clients
insert into clients (full_name, age, phone, email, counsellor_id)
select v.full_name, v.age, v.phone, v.email,
       (select id from profiles where full_name = v.counsellor and role = 'counsellor')
from (values
  ('Ravi Kumar', 36, '+919000000001', 'ravi@example.com',  'Anisha'),
  ('Neha R.',    31, '+919000000002', 'neha@example.com',  'Anisha'),
  ('Priya S.',   29, '+919000000003', 'priya@example.com', 'Shefrin'),
  ('Kavya M.',   27, '+919000000004', 'kavya@example.com', 'Shefrin'),
  ('Arjun T.',   42, '+919000000005', 'arjun@example.com', 'Mahek')
) as v(full_name, age, phone, email, counsellor)
where not exists (select 1 from clients c where c.full_name = v.full_name);

-- -------------------------------------------------------- appointments
-- Today's board, in Asia/Kolkata local time.
insert into appointments (counsellor_id, client_id, starts_at, ends_at, price_cents, currency, title)
select
  co.id,
  cl.id,
  ((current_date + v.at_time) at time zone 'Asia/Kolkata'),
  ((current_date + v.at_time) at time zone 'Asia/Kolkata') + interval '60 minutes',
  200000,
  'INR',
  'Individual counselling'
from (values
  ('Anisha',  'Ravi Kumar', time '11:00'),
  ('Anisha',  'Neha R.',    time '18:00'),
  ('Shefrin', 'Priya S.',   time '10:00'),
  ('Shefrin', 'Kavya M.',   time '14:00')
) as v(counsellor, client, at_time)
join profiles co on co.full_name = v.counsellor and co.role = 'counsellor'
join clients  cl on cl.full_name = v.client
where not exists (
  select 1 from appointments a
  where a.counsellor_id = co.id
    and a.starts_at = ((current_date + v.at_time) at time zone 'Asia/Kolkata')
);

-- A few sessions spread over the coming week, including one exactly
-- three days out so the reminder cron has something to send.
insert into appointments (counsellor_id, client_id, starts_at, ends_at, price_cents, currency, title)
select
  co.id, cl.id,
  (((current_date + v.day_offset) + v.at_time) at time zone 'Asia/Kolkata'),
  (((current_date + v.day_offset) + v.at_time) at time zone 'Asia/Kolkata') + interval '60 minutes',
  200000, 'INR', 'Individual counselling'
from (values
  ('Anisha',  'Ravi Kumar', 3, time '11:00'),
  ('Shefrin', 'Priya S.',   3, time '15:00'),
  ('Mahek',   'Arjun T.',   1, time '12:00'),
  ('Ramya',   'Neha R.',    2, time '16:00')
) as v(counsellor, client, day_offset, at_time)
join profiles co on co.full_name = v.counsellor and co.role = 'counsellor'
join clients  cl on cl.full_name = v.client
where not exists (
  select 1 from appointments a
  where a.counsellor_id = co.id
    and a.starts_at = (((current_date + v.day_offset) + v.at_time) at time zone 'Asia/Kolkata')
);

-- Invoices for everything on the board.
insert into invoices (appointment_id, counsellor_id, client_id, amount_cents, currency, status)
select a.id, a.counsellor_id, a.client_id, a.price_cents, a.currency, 'unpaid'
from appointments a
where not exists (select 1 from invoices i where i.appointment_id = a.id);
