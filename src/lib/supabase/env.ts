/**
 * Supabase connection details, read once and checked.
 *
 * These were previously asserted non-null with `!`, which is a lie to
 * the compiler: on a deployment where they are not set the value is
 * undefined at runtime and @supabase/ssr throws
 *
 *   "Your project's URL and Key are required to create a Supabase client!"
 *
 * from inside the middleware — so every page, including the public ones,
 * returns 500 with an error that names neither the missing variable nor
 * where to set it. The build succeeds, which makes it look like a
 * runtime bug rather than missing configuration.
 */

function required(name: string, value: string | undefined): string {
  if (value && value.trim()) return value;

  throw new Error(
    `${name} is not set.\n\n` +
      `Nurora cannot reach Supabase without it. Set it in your deployment's ` +
      `environment variables (on Vercel: Settings -> Environment Variables, ` +
      `then redeploy), or in .env.local when running locally.\n\n` +
      `Find the value in your Supabase project under Settings -> API. ` +
      `See DEPLOY.md for the full list.`,
  );
}

/** The project URL, e.g. https://abcdefgh.supabase.co */
export function supabaseUrl(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/** The anon/publishable key. Safe in the browser; RLS does the guarding. */
export function supabaseAnonKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * True when both are present. Lets callers degrade gracefully instead of
 * throwing — the middleware uses this so a misconfigured deployment can
 * still render its own error page rather than 500 on every request.
 */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}
