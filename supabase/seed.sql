-- =====================================================================
-- Nurora demo seed — OPTIONAL.
--
-- Creates the five counsellors, an admin, a handful of clients and a
-- day of appointments so the schedule board looks alive immediately.
-- Run it in the Supabase SQL editor AFTER 0001_init.sql.
--
-- Sign in with any of these:
--
--   anisha@nurora.demo   / nurora1234   <- counsellor WITH admin rights
--   support@nurora.demo  / nurora1234   <- booking desk (support role)
--   shefrin@nurora.demo  / nurora1234
--   ramya@nurora.demo    / nurora1234
--   mahek@nurora.demo    / nurora1234
--   saranya@nurora.demo  / nurora1234
-- =====================================================================

create extension if not exists pgcrypto;

do $$
declare
  -- name, email, role, is_admin
  staff        text[][] := array[
    ['Anisha',  'anisha@nurora.demo',  'counsellor', 'true'],
    ['Shefrin', 'shefrin@nurora.demo', 'counsellor', 'false'],
    ['Ramya',   'ramya@nurora.demo',   'counsellor', 'false'],
    ['Mahek',   'mahek@nurora.demo',   'counsellor', 'false'],
    ['Saranya', 'saranya@nurora.demo', 'counsellor', 'false'],
    ['Divya (Front desk)', 'support@nurora.demo', 'support', 'false']
  ];
  i            integer;
  uid          uuid;
  person_name  text;
  person_email text;
  person_role  text;
  person_admin boolean;
begin
  for i in 1 .. array_length(staff, 1) loop
    person_name  := staff[i][1];
    person_email := staff[i][2];
    person_role  := staff[i][3];
    person_admin := staff[i][4]::boolean;

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
           is_admin  = person_admin,
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

-- ------------------------------------------------------- languages
update profiles set languages = case full_name
  when 'Anisha'  then array['English','Tamil']
  when 'Shefrin' then array['English','Tamil','Malayalam']
  when 'Ramya'   then array['English','Tamil','Telugu']
  when 'Mahek'   then array['English','Hindi','Gujarati']
  when 'Saranya' then array['English','Tamil','Kannada']
  else languages
end
where role = 'counsellor';

-- ---------------------------------------------------- specialisms
insert into counsellor_specialisms (counsellor_id, specialism_id)
select p.id, sp.id
from (values
  ('Anisha',  'anxiety'),          ('Anisha',  'depression'),
  ('Anisha',  'stress-burnout'),
  ('Shefrin', 'relationships'),    ('Shefrin', 'marriage-family'),
  ('Shefrin', 'grief-loss'),
  ('Ramya',   'child-adolescent'), ('Ramya',   'career-academic'),
  ('Ramya',   'self-esteem'),
  ('Mahek',   'trauma-ptsd'),      ('Mahek',   'addiction'),
  ('Mahek',   'anger-management'),
  ('Saranya', 'anxiety'),          ('Saranya', 'sleep'),
  ('Saranya', 'eating-body-image'),('Saranya', 'workplace')
) as v(counsellor, slug)
join profiles   p  on p.full_name = v.counsellor and p.role = 'counsellor'
join specialisms sp on sp.slug = v.slug
on conflict do nothing;

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
insert into clients (
  full_name, age, phone, email, counsellor_id,
  gender, preferred_language, presenting_concern
)
select v.full_name, v.age, v.phone, v.email,
       (select id from profiles where full_name = v.counsellor and role = 'counsellor'),
       v.gender, v.language, v.concern
from (values
  ('Ravi Kumar', 36, '+919000000001', 'ravi@example.com',  'Anisha',
   'Male',   'Tamil',   'Work stress and trouble sleeping'),
  ('Neha R.',    31, '+919000000002', 'neha@example.com',  'Anisha',
   'Female', 'English', 'Persistent low mood since a job change'),
  ('Priya S.',   29, '+919000000003', 'priya@example.com', 'Shefrin',
   'Female', 'Tamil',   'Difficulties in her marriage'),
  ('Kavya M.',   27, '+919000000004', 'kavya@example.com', 'Shefrin',
   'Female', 'English', 'Grief after losing a parent'),
  ('Arjun T.',   42, '+919000000005', 'arjun@example.com', 'Mahek',
   'Male',   'Hindi',   'Anger at home, wants to work on it')
) as v(full_name, age, phone, email, counsellor, gender, language, concern)
where not exists (select 1 from clients c where c.full_name = v.full_name);

-- -------------------------------------------------------- appointments
-- Today's board, in Asia/Kolkata local time.
--
-- Note `(now() at time zone 'Asia/Kolkata')::date` rather than
-- current_date: current_date is UTC, so late in the UTC evening it is
-- already tomorrow in India and the demo day would land behind the
-- board's idea of "today".
insert into appointments (counsellor_id, client_id, starts_at, ends_at, price_cents, currency, title)
select
  co.id,
  cl.id,
  (((now() at time zone 'Asia/Kolkata')::date + v.at_time) at time zone 'Asia/Kolkata'),
  (((now() at time zone 'Asia/Kolkata')::date + v.at_time) at time zone 'Asia/Kolkata') + interval '60 minutes',
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
    and a.starts_at = (((now() at time zone 'Asia/Kolkata')::date + v.at_time) at time zone 'Asia/Kolkata')
);

-- A few sessions spread over the coming week, including one exactly
-- three days out so the reminder cron has something to send.
insert into appointments (counsellor_id, client_id, starts_at, ends_at, price_cents, currency, title)
select
  co.id, cl.id,
  ((((now() at time zone 'Asia/Kolkata')::date + v.day_offset) + v.at_time) at time zone 'Asia/Kolkata'),
  ((((now() at time zone 'Asia/Kolkata')::date + v.day_offset) + v.at_time) at time zone 'Asia/Kolkata') + interval '60 minutes',
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
    and a.starts_at = ((((now() at time zone 'Asia/Kolkata')::date + v.day_offset) + v.at_time) at time zone 'Asia/Kolkata')
);

-- Invoices for everything on the board.
insert into invoices (appointment_id, counsellor_id, client_id, amount_cents, currency, status)
select a.id, a.counsellor_id, a.client_id, a.price_cents, a.currency, 'unpaid'
from appointments a
where not exists (select 1 from invoices i where i.appointment_id = a.id);
