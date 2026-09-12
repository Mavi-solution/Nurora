import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS — only ever use this from trusted server
 * code (the reminder cron), never from anything a user can reach directly.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Same client, but null instead of throwing when the service-role key is
 * absent. Transactional notifications degrade to "not sent" on a
 * deployment without Twilio/Supabase service credentials — they must
 * never take a booking down with them.
 */
export function createAdminClientOrNull() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createAdminClient();
}
