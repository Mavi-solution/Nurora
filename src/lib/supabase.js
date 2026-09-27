import { createClient } from "@supabase/supabase-js";

/*
 * The browser's Supabase client.
 *
 * There are no server components or route handlers in this app any more,
 * so there is nothing that needs to read the session out of a cookie —
 * the client keeps it in localStorage and refreshes it itself. That also
 * means both values below are public by design: the anon key is meant to
 * ship to the browser, and row-level security is what actually guards the
 * data.
 *
 * NEXT_PUBLIC_ values are substituted at BUILD time, never read at
 * runtime. A deployment that sets them after the fact keeps serving the
 * bundle compiled without them, which is why configured() checks the
 * compiled-in values rather than trusting that the variables exist.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function supabaseConfigured() {
  return typeof URL === "string" && URL.length > 0
    && typeof ANON === "string" && ANON.length > 0;
}

// Why it is unusable, in words a person can act on — or null when it is
// fine. Callers show this instead of letting createClient() throw and
// take the whole page down with it.
export function supabaseProblem() {
  if (!URL && !ANON) {
    return "This deployment has no Supabase credentials compiled in. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy with the build cache disabled.";
  }
  if (!URL) return "NEXT_PUBLIC_SUPABASE_URL is missing from this build. Set it and redeploy with the build cache disabled.";
  if (!ANON) return "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from this build. Set it and redeploy with the build cache disabled.";
  try {
    new globalThis.URL(URL);
  } catch {
    return `NEXT_PUBLIC_SUPABASE_URL is not a valid URL ("${URL.slice(0, 40)}"). It should look like https://yourproject.supabase.co.`;
  }
  return null;
}

let cached = null;

// One client for the tab. Creating a second one starts a second token
// refresh timer against the same stored session, and the two race.
export function getSupabase() {
  if (!supabaseConfigured()) return null;
  if (cached) return cached;
  cached = createClient(URL, ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "nurora:auth:v1",
    },
  });
  return cached;
}
