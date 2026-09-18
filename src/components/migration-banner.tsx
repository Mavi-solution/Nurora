import { isAdmin } from "@/lib/auth";
import { missingMigrations } from "@/lib/data/schema-health";
import type { Profile } from "@/lib/types";

/**
 * Tell an admin when the database is behind the code.
 *
 * Shown to admins only, and only when something is genuinely missing —
 * so on a correctly migrated deployment this renders nothing at all and
 * costs one cached query per five minutes.
 */
export async function MigrationBanner({ profile }: { profile: Profile }) {
  if (!isAdmin(profile)) return null;

  const missing = await missingMigrations();
  if (missing.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-blush-300 bg-blush-50 px-5 py-4 dark:border-blush-500/30 dark:bg-blush-500/10">
      <p className="text-[14px] font-semibold text-blush-900 dark:text-blush-200">
        This database is behind the app
      </p>
      <p className="text-[13px] text-blush-800 dark:text-blush-300 mt-1 leading-relaxed">
        {missing.length === 1 ? "One migration has" : `${missing.length} migrations have`}{" "}
        not been run here, so the features below are missing rather than
        broken. Run them in the Supabase SQL editor, in order.
      </p>
      <ul className="mt-2.5 space-y-1">
        {missing.map((m) => (
          <li key={m.migration} className="text-[13px] text-blush-800 dark:text-blush-300">
            <code className="font-mono text-[12px]">{m.migration}.sql</code>
            {" — "}
            {m.enables}
          </li>
        ))}
      </ul>
    </div>
  );
}
