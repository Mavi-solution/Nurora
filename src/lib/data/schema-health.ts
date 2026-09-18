import { unstable_cache } from "next/cache";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Which migrations the deployed database is missing.
 *
 * This exists because three separate QA reports turned out to be one
 * thing: migrations 0011-0013 had not been run on the deployment. The
 * failure mode is what makes it worth detecting rather than
 * documenting. Nothing errors. A missing column reads as `undefined`
 * and the code falls back to a sensible default; a missing DELETE
 * policy makes PostgREST delete zero rows and report success. So the
 * feature is simply absent, the app looks fine, and the only signal is
 * a tester saying "this doesn't work" about something that does work
 * everywhere the migration has been applied.
 *
 * Probing is deliberately cheap: one HEAD-style select per feature,
 * cached, and only ever rendered to an admin.
 */

export type MissingMigration = {
  migration: string;
  /** What stops working while it is missing. */
  enables: string;
};

/** Refreshed every five minutes — this changes only when SQL is run. */
const MAX_AGE = 300;

const CACHE_ENABLED = process.env.NODE_ENV === "production";

async function probe(): Promise<MissingMigration[]> {
  const client = createAdminClientOrNull() ?? (await createClient());
  const missing: MissingMigration[] = [];

  /*
   * Selecting a named column fails with 42703 when the column is not
   * there, which is the whole point — `select("*")` would succeed and
   * silently return a row without it.
   */
  const [openDays, templates, preferred] = await Promise.all([
    client.from("clinic_settings").select("open_weekdays").limit(1),
    client.from("message_templates").select("id").limit(1),
    client.from("profiles").select("preferred_language").limit(1),
  ]);

  if (openDays.error) {
    missing.push({
      migration: "0013_clinic_open_days_and_notifications",
      enables:
        "clearing notifications, and setting which weekdays the clinic opens",
    });
  }

  if (templates.error) {
    missing.push({
      migration: "0012_message_templates",
      enables: "editable WhatsApp templates and their schedules",
    });
  }

  if (preferred.error) {
    missing.push({
      migration: "0014_counsellor_preferred_language",
      enables: "recording which language a counsellor would rather work in",
    });
  }

  // Oldest first, which is the order they have to be run in.
  return missing.sort((a, b) => a.migration.localeCompare(b.migration));
}

const cached = unstable_cache(probe, ["schema-health"], {
  tags: ["schema-health"],
  revalidate: MAX_AGE,
});

export async function missingMigrations(): Promise<MissingMigration[]> {
  try {
    return CACHE_ENABLED && createAdminClientOrNull() ? await cached() : await probe();
  } catch {
    // A diagnostic must never be the reason a page fails to render.
    return [];
  }
}
