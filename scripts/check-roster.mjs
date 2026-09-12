/**
 * The roster must list every counsellor — including one who has been
 * given the admin ROLE. Admin is meant to be a flag, and a practising
 * counsellor who is promoted must not drop out of the practice.
 *
 * Run against a seeded database; this script does its own promotion.
 *   node scripts/check-roster.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const APP = "http://localhost:3000";
const PSQL = ["-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres", "-qtA"];
const sql = (q) =>
  execFileSync("psql", [...PSQL, "-c", q], {
    env: { ...process.env, PGPASSWORD: "postgres" },
    encoding: "utf8",
  }).trim();

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const check = (n, ok, d = "") => {
  if (ok) console.log(`  ok    ${n}`);
  else { failures += 1; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ""}`); }
};

async function signIn(page, email) {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  sql("update profiles set role='counsellor' where full_name='Shefrin'");
  const total = Number(sql("select count(*) from profiles where role in ('counsellor','admin')"));

  await signIn(page, "anisha@nurora.demo");

  step("Every counsellor appears on the roster");
  await page.goto(`${APP}/counsellors`, { waitUntil: "networkidle" });
  for (const name of ["Anisha", "Shefrin", "Ramya", "Mahek", "Saranya"]) {
    check(`${name} is listed`, await page.getByText(name, { exact: true }).first().isVisible().catch(() => false));
  }
  check("reception is NOT on the counsellor roster",
    (await page.getByText("Divya (Front desk)", { exact: true }).count()) === 0);
  check(`header reports all ${total} on the roster`,
    await page.getByText(`${total} on the roster`, { exact: false }).first().isVisible().catch(() => false));

  step("Promoting a counsellor to the admin ROLE must not hide them");
  sql("update profiles set role='admin' where full_name='Shefrin'");

  await page.goto(`${APP}/counsellors`, { waitUntil: "networkidle" });
  check("Shefrin still on the roster after promotion",
    await page.getByText("Shefrin", { exact: true }).first().isVisible().catch(() => false));

  // The counsellor filter is built straight from the server's counsellor
  // query, so it is the honest signal that she survived the filter.
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  const filterOptions = await page
    .locator("select[aria-label='Filter by counsellor'], select")
    .first()
    .locator("option")
    .allTextContents();
  check("Shefrin still offered on the schedule", filterOptions.includes("Shefrin"),
    filterOptions.slice(0, 8).join(", "));

  const activeClinicians = Number(
    sql("select count(*) from profiles where role in ('counsellor','admin') and is_active"),
  );
  check(`schedule draws a lane for all ${activeClinicians} active clinicians`,
    (await page.getByText(/\d+ booked/).count()) === activeClinicians,
    `${await page.getByText(/\d+ booked/).count()} lanes`);

  await page.goto(`${APP}/availability`, { waitUntil: "networkidle" });
  check("Shefrin still selectable under Availability",
    (await page.getByText("Shefrin", { exact: false }).count()) > 0);

  // Bookability, at the API the booking desk actually calls: it 404s for
  // anyone outside CLINICIAN_ROLES.
  const shefrinId = sql("select id from profiles where full_name='Shefrin'");
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const slotStatus = await page.evaluate(
    async ([id, d]) => {
      const r = await fetch(`/api/slots?counsellor=${id}&date=${d}&duration=60`);
      return r.status;
    },
    [shefrinId, date],
  );
  check("she is still bookable through /api/slots", slotStatus === 200, `HTTP ${slotStatus}`);

  step("Inactive counsellors stay on the roster, flagged");
  sql("update profiles set role='counsellor', is_active=false where full_name='Mahek'");
  await page.goto(`${APP}/counsellors`, { waitUntil: "networkidle" });
  check("an inactive counsellor is still listed",
    await page.getByText("Mahek", { exact: true }).first().isVisible().catch(() => false));
  check("and is flagged as not taking bookings",
    await page.getByText("Not taking bookings").first().isVisible().catch(() => false));

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  // Leave the seed as we found it.
  sql("update profiles set role='counsellor', is_active=true where full_name in ('Shefrin','Mahek')");
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All roster checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
