-- =====================================================================
-- Migration 0002
--
-- 1. Admin becomes a FLAG rather than a role, so one person can be a
--    counsellor (with a lane on the schedule and their own sessions)
--    AND hold admin powers. The `admin` role value stays valid for
--    back-office accounts that never see clients.
-- 2. The first account to sign up is bootstrapped as a counsellor with
--    admin rights, so a fresh deployment is usable immediately.
-- =====================================================================

alter table profiles
  add column if not exists is_admin boolean not null default false;

-- Anyone already sitting on the admin role keeps the powers.
update profiles set is_admin = true where role = 'admin';

comment on column profiles.is_admin is
  'Admin powers. Independent of role so a counsellor can also be an admin.';

-- ---------------------------------------------------------------------
-- is_admin() now honours the flag as well as the legacy role.
-- ---------------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (is_admin = true or role = 'admin')
  );
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role in ('counsellor', 'admin') or is_admin = true)
  );
$$;

-- ---------------------------------------------------------------------
-- New sign-ups.
--
-- Password sign-up passes full_name and role through raw_user_meta_data;
-- the very first account is always a counsellor with admin rights so
-- there is somebody who can run the practice.
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first      boolean;
  desired_role  user_role;
begin
  select not exists (
    select 1 from public.profiles where is_admin = true or role = 'admin'
  ) into is_first;

  -- Only 'counsellor' and 'client' may be self-selected at sign-up;
  -- anything else falls back to client so the column cannot be forged.
  desired_role := case
    when new.raw_user_meta_data->>'role' = 'counsellor' then 'counsellor'::user_role
    else 'client'::user_role
  end;

  insert into public.profiles (
    id, email, phone, full_name, avatar_url, role, is_admin, onboarded
  )
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when is_first then 'counsellor'::user_role else desired_role end,
    is_first,
    false
  )
  on conflict (id) do nothing;

  -- Link any client record the practice already created for this person.
  update public.clients
     set user_id = new.id
   where user_id is null
     and (
       (new.email is not null and lower(email) = lower(new.email))
       or (new.phone is not null and phone = new.phone)
     );

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Admins may edit any profile; the policy has to read the new flag.
-- ---------------------------------------------------------------------
drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles
  for update to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Does the practice already have an admin?
--
-- The sign-up page needs this BEFORE anyone is signed in, but RLS limits
-- `profiles` to authenticated users, so a plain count from an anonymous
-- client always returns zero. SECURITY DEFINER answers the one boolean
-- question without exposing any row.
-- ---------------------------------------------------------------------
create or replace function public.practice_has_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where is_admin = true or role = 'admin'
  );
$$;

revoke all on function public.practice_has_admin() from public;
grant execute on function public.practice_has_admin() to anon, authenticated;
