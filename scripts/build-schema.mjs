/**
 * Regenerates supabase/schema.sql from the migrations.
 *
 *   node scripts/build-schema.mjs           # write
 *   node scripts/build-schema.mjs --check   # fail if stale (CI / tests)
 *
 * It exists because the file was hand-assembled once and then silently
 * fell behind: migration 0010 landed, schema.sql did not, and a project
 * set up from it had no follow_ups, commitments, reviews or
 * clinic_settings tables — features that simply failed with no
 * explanation.
 *
 * One deliberate difference from a plain concatenation: user_role is
 * created with all four values up front. Postgres will not let a new
 * enum value be USED in the transaction that adds it, and the Supabase
 * SQL Editor runs a pasted script as a single transaction, so the
 * migrations' incremental ALTER TYPE would fail there.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const OUT = "supabase/schema.sql";

const HEADER = `-- =====================================================================
-- Nurora — complete schema, for a FRESH Supabase project
--
-- GENERATED FILE — do not edit by hand.
--   npm run schema:build      regenerate after adding a migration
--   npm run schema:check      fail if it has fallen behind
--
-- Paste the whole file into the Supabase SQL Editor and run it once.
-- It is every migration in supabase/migrations/ consolidated, with one
-- deliberate difference: the user_role enum is created with all four
-- values up front, because Postgres will not let a new enum value be
-- USED in the transaction that adds it and the SQL Editor runs this as
-- a single transaction.
--
-- Safe on a new project. NOT idempotent — running it twice errors on
-- objects that already exist. To update an EXISTING database, run only
-- the migrations it has not seen yet.
--
-- Requires the Supabase auth schema (auth.users, auth.uid), which every
-- Supabase project has. It creates no demo accounts.
-- =====================================================================

`;

function build() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const parts = [];

  for (const name of files) {
    let body = readFileSync(join(DIR, name), "utf8");

    if (name.startsWith("0001")) {
      body = body.replace(
        "create type user_role as enum ('client', 'counsellor', 'admin');",
        "create type user_role as enum ('client', 'counsellor', 'admin', 'support');\n" +
          "-- 'support' is included here rather than added later — see the note\n" +
          "-- at the top of this file.",
      );
    }
    if (name.startsWith("0003")) {
      body = body.replace(
        /^alter type user_role add value if not exists 'support';\s*$/m,
        "-- (no-op here: 'support' is already part of the enum above)",
      );
    }

    parts.push(
      "-- ---------------------------------------------------------------------\n" +
        `-- from ${name}\n` +
        "-- ---------------------------------------------------------------------\n\n" +
        body.trim() +
        "\n",
    );
  }

  return { sql: HEADER + parts.join("\n\n") + "\n", count: files.length };
}

const { sql, count } = build();
const check = process.argv.includes("--check");
const current = (() => { try { return readFileSync(OUT, "utf8"); } catch { return null; } })();

if (check) {
  if (current === sql) {
    console.log(`ok    schema.sql is current (${count} migrations)`);
    process.exit(0);
  }
  console.error(
    `FAIL  schema.sql is STALE.\n` +
      `      A migration was added without regenerating it, so a project set\n` +
      `      up from that file would be missing tables.\n` +
      `      Run: npm run schema:build`,
  );
  process.exit(1);
}

writeFileSync(OUT, sql);
console.log(`wrote ${OUT} from ${count} migrations (${sql.split("\n").length} lines)`);
