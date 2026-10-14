-- The sign-in screen now shows an admin-editable quote (settings.value
-- ->> 'loginQuoteGrey' / 'loginQuoteBlack') instead of fixed text, and it
-- has to read that before anyone has signed in — there is no session for
-- the old authenticated-only SELECT policy to apply to. Nothing else
-- about settings changes: it's still one row, still admin-write-only;
-- this only widens who can read it, from "any signed-in staff member"
-- to "anyone, signed in or not" — which the rest of its contents
-- (pricing, service list, policy text) were already written to be
-- shown to, not kept secret from, a prospective client anyway.
drop policy if exists settings_select_authenticated on public.settings;
drop policy if exists settings_select_public on public.settings;
create policy settings_select_public on public.settings
  for select to anon, authenticated
  using (true);
