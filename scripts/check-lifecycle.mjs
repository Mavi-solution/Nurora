/**
 * The appointment lifecycle: book -> WhatsApp -> start -> timer ->
 * end -> notes (typed or dictated).
 *
 *   supabase db reset && node scripts/check-lifecycle.mjs
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

const browser = await chromium.launch();
// Grant the mic so the dictation button is exercised, not just rendered.
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["microphone"],
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });

  /* ---------------------------------------- 1. book -> WhatsApp */
  step("Booking sends the WhatsApp confirmation");
  const apptId = sql("select id from appointments where status='scheduled' order by starts_at limit 1");
  const before = Number(sql("select count(*) from notification_deliveries where kind='appointment_booked'"));

  await page.goto(`${APP}/appointments/${apptId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Resend WhatsApp confirmation/i }).click();
  await page.waitForTimeout(2500);
  check("a WhatsApp delivery was recorded",
    Number(sql("select count(*) from notification_deliveries where kind='appointment_booked' and channel='whatsapp'")) > 0);

  /* ------------------------------------------- 2. start -> timer */
  step("Starting the session runs the timer");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.waitForTimeout(2500);

  check("a time entry is open",
    sql(`select count(*) from time_entries where appointment_id='${apptId}' and ended_at is null`) === "1");
  check("status flipped to in_progress",
    sql(`select status from appointments where id='${apptId}'`) === "in_progress");
  check("the running timer is on screen",
    await page.getByText("Session running").isVisible().catch(() => false));

  const t1 = await page.locator("text=/^\\d+:\\d{2}/").first().textContent().catch(() => null);
  await page.waitForTimeout(2600);
  const t2 = await page.locator("text=/^\\d+:\\d{2}/").first().textContent().catch(() => null);
  check("the timer is actually ticking", t1 !== null && t2 !== null && t1 !== t2, `${t1} -> ${t2}`);

  /* --------------------------------------------- 3. end -> notes */
  step("Ending the session bills it and asks for notes");
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.waitForTimeout(3000);

  check("the timer was closed",
    sql(`select count(*) from time_entries where appointment_id='${apptId}' and ended_at is null`) === "0");
  check("status is completed",
    sql(`select status from appointments where id='${apptId}'`) === "completed");
  check("tracked minutes reached the invoice",
    sql(`select (billed_minutes is not null) from invoices where appointment_id='${apptId}'`) === "t");
  check("it prompts for the write-up",
    await page.getByText(/Write up what happened while it is fresh/i).isVisible().catch(() => false));

  /* ------------------------------------------------ 4. dictation */
  step("Notes can be dictated or typed");
  const mic = page.getByRole("button", { name: "Dictate" });
  check("a Dictate button is offered on session notes",
    await mic.isVisible().catch(() => false));

  const body = "Client reported better sleep. Agreed to continue weekly.";
  await page.getByPlaceholder(/Observations, follow-ups/).fill(body);
  await page.getByRole("button", { name: "Save notes" }).click();
  await page.waitForTimeout(2500);

  check("notes saved to the clinical record",
    sql(`select body from session_notes where appointment_id='${apptId}'`) === body);
  check("the prompt clears once written up",
    !(await page.getByText(/Write up what happened/i).isVisible().catch(() => false)));

  step("Dictation is also on the team composer");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  check("composer mic present",
    await page.getByRole("button", { name: /Dictate a message/i }).isVisible().catch(() => false));

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All lifecycle checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
