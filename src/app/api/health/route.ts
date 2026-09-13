import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { misprefixedVars } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * Deployment diagnostic.
 *
 * A misconfigured deployment fails in several different ways that all
 * surface as a 500 — env missing, env set but not rebuilt, credentials
 * wrong, or the schema never pushed. This says which, without needing
 * access to the build logs.
 *
 * Deliberately leaks nothing: keys are reported only as present/absent
 * with their length, and the Supabase URL only as its hostname.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const checks: Record<string, unknown> = {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: url ? `set (${safeHost(url)})` : "MISSING",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anon ? `set (${anon.length} chars)` : "MISSING",
      SUPABASE_SERVICE_ROLE_KEY: service ? `set (${service.length} chars)` : "MISSING",
      CRON_SECRET: process.env.CRON_SECRET ? "set" : "missing (reminders unprotected)",
      TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM ? "set" : "unset (WhatsApp skipped)",
      RESEND_API_KEY: process.env.RESEND_API_KEY ? "set" : "unset (email skipped)",
      advanceTiersConfigured: Boolean(
        process.env.BILLING_ADVANCE_AT_OR_BELOW || process.env.BILLING_ADVANCE_ABOVE,
      ),
    },
    // Build-time vs runtime, per variable.
    //
    // A static process.env.X is substituted by the bundler when the
    // bundle is built; a computed lookup is not, and reads the live
    // environment. When "build" is absent while "runtime" has a value,
    // the variable existed when the server started but NOT when the
    // bundle was compiled — which is exactly what Vercel's Sensitive
    // flag does, since those are withheld from the build step. A
    // NEXT_PUBLIC_ variable cannot work that way: inlining at build is
    // the only way its value ever reaches the browser.
    buildVsRuntime: Object.fromEntries(
      (
        [
          ["NEXT_PUBLIC_SUPABASE_URL", url],
          ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anon],
          ["SUPABASE_SERVICE_ROLE_KEY", service],
        ] as const
      ).map(([name, atBuild]) => {
        // Computed key: never substituted, so this is the live value.
        const atRuntime = process.env[String(name)];
        return [
          name,
          {
            build: atBuild ? `${atBuild.length} chars` : "absent",
            runtime: atRuntime?.trim()
              ? `${atRuntime.trim().length} chars`
              : atRuntime === ""
                ? "present but EMPTY"
                : "absent",
          },
        ];
      }),
    ),
    // Every relevant variable NAME the running process can see. Names
    // only — never values — so a typo, a wrong prefix, or a variable
    // that the platform is not injecting at all becomes obvious without
    // anyone reading a secret.
    //
    // A NEXT_PUBLIC_ name that appears HERE but reads MISSING above was
    // present at runtime yet absent when the bundle was built — which is
    // what happens when it is marked Sensitive on Vercel, since those
    // are withheld from the build step.
    visibleNames: Object.keys(process.env)
      .filter((k) =>
        /^(NEXT_PUBLIC_|SUPABASE_|TWILIO_|RESEND_|CRON_|BILLING_|NOTIFY_)/.test(k),
      )
      .sort(),
    // NEXT_PUBLIC_* are inlined when the bundle is built, so a value
    // added AFTER the last build will not be present until you redeploy.
    buildStamp: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
      env: process.env.VERCEL_ENV ?? "local",
      builtFor: process.env.VERCEL_URL ?? "local",
    },
  };

  if (!url || !anon) {
    const misprefixed = misprefixedVars();

    return NextResponse.json(
      {
        ok: false,
        problem:
          misprefixed.length > 0
            ? `${misprefixed.join("; ")} — in this build.`
            : "Supabase environment variables are missing from this build.",
        fix: misprefixed.length > 0
          ? "Either the prefix is missing, or this build predates the " +
            "variable. NEXT_PUBLIC_ values are compiled in at build time " +
            "and never read at runtime, so adding them without a fresh " +
            "build changes nothing — redeploy with the build cache " +
            "DISABLED. Check buildStamp.commit below to see which commit " +
            "is actually running. SUPABASE_SERVICE_ROLE_KEY is correct " +
            "WITHOUT a prefix — it must never reach the browser."
          :
          "Set them in Vercel (Settings -> Environment Variables) for the " +
          "environment you are deploying, then REDEPLOY — NEXT_PUBLIC_* " +
          "values are baked into the bundle at build time, so adding them " +
          "without a rebuild changes nothing.",
        misprefixed,
        ...checks,
      },
      { status: 503 },
    );
  }

  // Reachability and schema, using the anon key so this reflects what
  // the app itself can actually see.
  try {
    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tables = ["profiles", "appointments", "services", "interests"];
    const schema: Record<string, string> = {};
    let missingTables = 0;
    let unreachable = 0;
    let denied = 0;

    for (const table of tables) {
      // NOT head:true — a HEAD request has no body, so supabase-js
      // returns no error even on a 404 and a missing table reports as
      // healthy. Ask for a row so the failure actually surfaces.
      const { error } = await supabase.from(table).select("id").limit(1);

      if (!error) {
        schema[table] = "ok";
        continue;
      }

      schema[table] = error.message || String(error);

      // Classify, so the report says WHICH problem this is rather than
      // just listing errors. Any failure here means not ok — reporting
      // ok:true alongside four broken tables would be worse than no
      // check at all.
      // PGRST205 = PostgREST cannot find the table; 42P01 = Postgres
      // undefined_table. Either means the schema was never pushed.
      if (
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        /does not exist|could not find the table/i.test(error.message)
      ) {
        missingTables += 1;
      } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|timeout/i.test(error.message)) {
        unreachable += 1;
      } else if (error.code === "42501" || /JWT|api key|unauthor/i.test(error.message)) {
        denied += 1;
      }
    }

    const broken = Object.values(schema).filter((v) => v !== "ok").length;

    if (broken > 0) {
      const [problem, fix] =
        unreachable > 0
          ? [
              "Supabase is not reachable at that URL.",
              "Check NEXT_PUBLIC_SUPABASE_URL matches your project exactly (Settings -> API). A typo here fails silently at build and only shows up at runtime.",
            ]
          : denied > 0
            ? [
                "Supabase rejected the credentials.",
                "Check NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to the same project as the URL.",
              ]
            : missingTables > 0
              ? [
                  `${missingTables} of ${tables.length} core tables are missing — the schema was never pushed to this project.`,
                  "supabase link --project-ref <ref> && supabase db push",
                ]
              : [
                  `${broken} of ${tables.length} core tables could not be read.`,
                  "See the per-table errors below.",
                ];

      return NextResponse.json(
        { ok: false, problem, fix, schema, ...checks },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, schema, ...checks });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        problem: "Could not reach Supabase with the configured credentials.",
        detail: err instanceof Error ? err.message : String(err),
        fix: "Check the URL and anon key match your Supabase project (Settings -> API).",
        ...checks,
      },
      { status: 503 },
    );
  }
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "unparseable — is it a full https:// URL?";
  }
}
