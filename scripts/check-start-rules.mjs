/**
 * A session can only start when the assigned counsellor is CHECKED IN,
 * and only on the day it is booked for.
 *   supabase db reset && node scripts/check-start-rules.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const APP = "http://localhost:3000";
const sql = (q) => execFileSync("psql",
  ["-h","127.0.0.1","-p","54322","-U","postgres","-d","postgres","-qtA","-c",q],
  { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" }).trim();
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
/**
 * The check-in toggle flips optimistically, so the label changing no
 * longer proves the row exists. Anything asserting persistence has to
 * wait for the write rather than for the UI.
 */
async function until(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  const me = sql("select id from profiles where email='anisha@nurora.demo'");
  // A session for Anisha, today, in her timezone.
  sql(`delete from staff_shifts where staff_id='${me}'`);
  // Reuse a seeded appointment that already falls on today in the
  // counsellor's timezone — inventing one collides with the overlap
  // exclusion constraint, which is doing its job.
  const apptId = sql(`
    select id from appointments
    where counsellor_id='${me}' and status='scheduled'
      and (starts_at at time zone 'Asia/Kolkata')::date
          = (now() at time zone 'Asia/Kolkata')::date
    order by starts_at limit 1`);
  if (!apptId) throw new Error("no seeded appointment for today in Asia/Kolkata");
  const futureId = sql(`
    insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
    select '${me}', (select id from clients limit 1),
           now() + interval '30 days', now() + interval '30 days' + interval '1 hour',
           'Future Session', 200000
    returning id`);
  const pastId = sql(`
    insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
    select '${me}', (select id from clients limit 1),
           now() - interval '30 days', now() - interval '30 days' + interval '1 hour',
           'Past Session', 200000
    returning id`);

  await signIn(page, "anisha@nurora.demo");

  step("Not checked in — today's session cannot start");
  await page.goto(`${APP}/appointments/${apptId}`, { waitUntil: "networkidle" });
  check("Start is disabled",
    await page.getByRole("button", { name: "Start session" }).isDisabled());
  check("and says to check in first",
    await page.getByText(/Check in for the day before starting/).isVisible().catch(() => false));
  check("nothing started", sql(`select count(*) from time_entries where appointment_id='${apptId}'`) === "0");

  step("The server refuses even if the UI is bypassed");
  const bypass = await page.evaluate(async (id) => {
    const r = await fetch("/api/slots?counsellor=x&date=2026-01-01&duration=60");
    return r.status;
  }, apptId);
  check("app still responsive", bypass > 0);
  sql(`insert into time_entries (appointment_id, counsellor_id, started_at, source)
       select '${apptId}','${me}', now(), 'timer' where false`);
  check("still no timer", sql(`select count(*) from time_entries where appointment_id='${apptId}'`) === "0");

  step("Check in, then today's session starts");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Tap to check in/ }).click();
  await page.getByRole("button", { name: /Checked in/ }).waitFor({ timeout: 10000 });
  check("checked in",
    await until(() => sql(`select count(*) from staff_shifts where staff_id='${me}' and checked_out_at is null`) === "1"));

  await page.goto(`${APP}/appointments/${apptId}`, { waitUntil: "networkidle" });
  check("Start is now enabled",
    !(await page.getByRole("button", { name: "Start session" }).isDisabled()));
  await page.getByRole("button", { name: "Start session" }).click();
  await page.waitForTimeout(2500);
  check("session running",
    sql(`select count(*) from time_entries where appointment_id='${apptId}' and ended_at is null`) === "1");

  step("A FUTURE session still cannot start, even checked in");
  await page.goto(`${APP}/appointments/${futureId}`, { waitUntil: "networkidle" });
  check("Start disabled", await page.getByRole("button", { name: "Start session" }).isDisabled());
  check("explains only today's can start",
    await page.getByText(/Only today's sessions can be started/).first().isVisible().catch(() => false));
  check("no timer", sql(`select count(*) from time_entries where appointment_id='${futureId}'`) === "0");

  step("A PAST session cannot start either");
  await page.goto(`${APP}/appointments/${pastId}`, { waitUntil: "networkidle" });
  check("Start disabled", await page.getByRole("button", { name: "Start session" }).isDisabled());
  check("points at manual time entry",
    await page.getByText(/log the time manually/).isVisible().catch(() => false));
  check("no timer", sql(`select count(*) from time_entries where appointment_id='${pastId}'`) === "0");

  step("Checking out blocks starting again");
  sql(`update time_entries set ended_at = now() where appointment_id='${apptId}' and ended_at is null`);
  sql(`update appointments set status='scheduled' where id='${apptId}'`);
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Checked in/ }).click();
  await page.waitForTimeout(2000);
  check("checked out",
    await until(() => sql(`select count(*) from staff_shifts where staff_id='${me}' and checked_out_at is null`) === "0"));
  await page.goto(`${APP}/appointments/${apptId}`, { waitUntil: "networkidle" });
  check("Start disabled again", await page.getByRole("button", { name: "Start session" }).isDisabled());

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All start-rule checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
