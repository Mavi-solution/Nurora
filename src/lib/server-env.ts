/**
 * Read a server environment variable at RUNTIME.
 *
 * A literal `process.env.FOO` can be substituted by the bundler when the
 * bundle is built, so a value the build could not see becomes undefined
 * for the life of the deployment. Vercel does exactly that with
 * Secret-type variables: they are withheld from the build step and only
 * present at runtime.
 *
 * Worse, reading at MODULE scope freezes whatever was there when the
 * module first loaded. That is how the app came to insist WhatsApp was
 * not configured while /api/health — which reads inside its handler —
 * could see all four Twilio variables perfectly well.
 *
 * The computed key is the point: it cannot be statically replaced, so
 * this always reflects the live environment.
 */
export function serverEnv(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** True when every named variable has a non-empty value right now. */
export function hasEnv(...names: string[]): boolean {
  return names.every((n) => serverEnv(n) !== undefined);
}
