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
  const value = required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  // The database connection string is a different thing entirely, and
  // putting it here is an easy mistake — the two sit next to each other
  // in the Supabase dashboard. It matters far more than a bad value:
  // this variable is NEXT_PUBLIC_, so whatever it holds is compiled into
  // the browser bundle. A connection string carries the database
  // password, which would then be served to every visitor.
  if (/^postgres(ql)?:\/\//i.test(value)) {
    const ref = value.match(/@db\.([a-z0-9]+)\.supabase\./i)?.[1];

    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL holds a POSTGRES CONNECTION STRING, not " +
        "the project API URL.\n\n" +
        "This is a credential exposure, not just a misconfiguration: " +
        "NEXT_PUBLIC_ values are compiled into the browser bundle, so the " +
        "database password in that string was served to every visitor. " +
        "ROTATE THE DATABASE PASSWORD (Supabase -> Settings -> Database -> " +
        "Reset database password).\n\n" +
        (ref
          ? `The correct value for this project is https://${ref}.supabase.co\n\n`
          : "The correct value looks like https://<project-ref>.supabase.co\n\n") +
        "Find it under Settings -> API -> Project URL. The connection " +
        "string belongs to SUPABASE_DB_URL and is only used by the " +
        "Supabase CLI and psql — the app never needs it.",
    );
  }

  if (!/^https?:\/\//i.test(value)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL, got "${value.slice(0, 24)}…".\n\n` +
        "It looks like https://<project-ref>.supabase.co — Supabase " +
        "dashboard, Settings -> API -> Project URL.",
    );
  }

  return value;
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

/**
 * Why the configured URL is unusable, or null when it is fine.
 *
 * Separate from supabaseUrl() because the middleware must not throw:
 * an exception there returns 500 for every route including the error
 * page, so it logs this and lets the request through instead.
 */
export function supabaseUrlProblem(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) return null; // absence is reported separately

  if (/^postgres(ql)?:\/\//i.test(value)) {
    const ref = value.match(/@db\.([a-z0-9]+)\.supabase\./i)?.[1];
    return (
      "NEXT_PUBLIC_SUPABASE_URL holds a POSTGRES CONNECTION STRING, not " +
      "the project API URL. NEXT_PUBLIC_ values are compiled into the " +
      "browser bundle, so the database password in it was served to every " +
      "visitor — ROTATE THE DATABASE PASSWORD now (Supabase -> Settings " +
      "-> Database -> Reset database password). " +
      (ref
        ? `Then set this variable to https://${ref}.supabase.co`
        : "Then set this variable to https://<project-ref>.supabase.co") +
      " (Settings -> API -> Project URL)."
    );
  }

  if (!/^https?:\/\//i.test(value)) {
    return (
      "NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL like " +
      "https://<project-ref>.supabase.co (Settings -> API -> Project URL)."
    );
  }

  return null;
}
