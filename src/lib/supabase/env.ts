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

  // The commonest mistake is setting the variable without the
  // NEXT_PUBLIC_ prefix. Say so outright instead of reporting it as
  // simply missing — the value IS there, just under a name Next cannot
  // expose to the browser.
  const unprefixed = name.replace(/^NEXT_PUBLIC_/, "");
  const hasUnprefixed = Boolean(process.env[unprefixed]?.trim());

  throw new Error(
    hasUnprefixed
      ? `${name} is not set — but ${unprefixed} is.\n\n` +
        `Rename it to ${name}. The NEXT_PUBLIC_ prefix is not cosmetic: it ` +
        `is what tells Next.js to include the value in the browser bundle, ` +
        `and the app's realtime features (team chat, the notification ` +
        `bell) run in the browser. Without the prefix they cannot see it ` +
        `however it is named on the server.\n\n` +
        `Note SUPABASE_SERVICE_ROLE_KEY is correct WITHOUT a prefix — it ` +
        `is server-only and must never reach the browser.\n\n` +
        `Rename it in Vercel (Settings -> Environment Variables) and ` +
        `redeploy. NEXT_PUBLIC_ values are baked in at build time, so a ` +
        `rebuild is required.`
      : `${name} is not set.\n\n` +
        `Nurora cannot reach Supabase without it. Set it in your ` +
        `deployment's environment variables (on Vercel: Settings -> ` +
        `Environment Variables, then redeploy), or in .env.local when ` +
        `running locally.\n\n` +
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

/**
 * Set under the wrong name — the value exists but without the
 * NEXT_PUBLIC_ prefix Next cannot expose it to the browser.
 */
export function misprefixedVars(): string[] {
  // Static keys, not process.env[`NEXT_PUBLIC_${n}`]: NEXT_PUBLIC_ values
  // are substituted into the bundle at build time, and the bundler can
  // only do that for a literal key. A computed one is never replaced.
  const pairs: [string, string | undefined, string | undefined][] = [
    ["SUPABASE_URL", process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ];

  return pairs
    .filter(([, plain, prefixed]) => plain?.trim() && !prefixed?.trim())
    .map(([name]) => `${name} is set but NEXT_PUBLIC_${name} is not`);
}

/**
 * The service-role key, read at RUNTIME rather than inlined.
 *
 * A literal process.env.X is substituted by the bundler when the bundle
 * is compiled, so a value the build cannot see becomes `undefined`
 * forever — which is what happens to a variable stored as a Secret on
 * Vercel, since secrets are withheld from the build step. A computed
 * key is never substituted, so this reads the live environment and the
 * key can stay a Secret where it belongs.
 *
 * This works only because the key is server-only. The NEXT_PUBLIC_
 * values genuinely must be available at build time: inlining is the
 * only way their value ever reaches the browser, so they cannot be
 * Secrets.
 */
export function serviceRoleKey(): string | undefined {
  const name = "SUPABASE_SERVICE_ROLE_KEY";
  return process.env[name]?.trim() || undefined;
}
