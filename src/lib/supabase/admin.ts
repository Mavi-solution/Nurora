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
