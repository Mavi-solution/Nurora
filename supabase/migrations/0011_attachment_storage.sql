-- =====================================================================
-- Migration 0011 — a private bucket for booking attachments
--
-- The booking dialog could record WHICH kind of attachment there was
-- (recording, voice note, note) and when it expires, but had nowhere to
-- put the file. This adds the bucket and its policies.
--
-- Private on purpose: these are recordings and notes attached to a
-- counselling session. Nothing here is served by public URL — the app
-- issues short-lived signed URLs instead, so a leaked path is useless
-- on its own.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  -- 25 MB. A voice note or a short recording fits; a long video does
  -- not, and should not be going through a booking form.
  26214400,
  array[
    'audio/mpeg','audio/mp4','audio/m4a','audio/x-m4a','audio/wav',
    'audio/webm','audio/ogg','video/mp4','video/webm',
    'image/png','image/jpeg','image/webp','application/pdf','text/plain'
  ]
)
on conflict (id) do nothing;

-- Staff only, in both directions. Clients never reach this bucket, and
-- objects are addressed under a per-appointment prefix so a path cannot
-- be guessed from another booking's id alone.
create policy attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and is_staff());

create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and is_staff());

create policy attachments_update on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and is_staff())
  with check (bucket_id = 'attachments' and is_staff());

-- Only an admin removes one by hand; the retention sweep runs as the
-- service role and is not bound by this.
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and is_admin());
