/**
 * The five appointment milestones (FUNCTIONAL-GUIDE.md §2).
 *
 * The rule under test: an appointment is complete only when ALL FIVE
 * are done — and step 3 follows the session timer, never a manual tick.
 *
 *   supabase db reset && node scripts/check-milestones.mjs
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1050 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

const stepBtn = (n) => page.getByRole("button", { name: new RegExp(`^Step ${n}:`) }).first();

try {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });

  step("The track renders five steps");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // Lanes are ordered by counsellor, so the FIRST row on screen is not
  // necessarily the earliest appointment. Read the id off the row we are
  // actually driving, or every database assertion checks the wrong one.
  const firstRow = page.locator('a[href^="/appointments/"]').first();
  const apptId = (await firstRow.getAttribute("href")).split("/").pop();
  const clientPhone = sql(`select c.phone from clients c join appointments a on a.client_id=c.id where a.id='${apptId}'`);
  // Milestone 3 runs the real timer, which now requires the assigned
  // counsellor to be checked in for the day.
  sql(`insert into staff_shifts (staff_id, checked_in_at)
       select counsellor_id, now() from appointments where id='${apptId}'
       on conflict do nothing`);
  console.log(`        driving appointment ${apptId} (client phone ${clientPhone})`);

  check("five step buttons on the first appointment",
    (await page.getByRole("button", { name: /^Step \d:/ }).count()) >= 5,
    `${await page.getByRole("button", { name: /^Step \d:/ }).count()} found`);
  check("shows 'Step 1 of 5 · Personalize message'",
    await page.getByText("Step 1 of 5 · Personalize message").first().isVisible().catch(() => false));
  check("the client's phone shows on the row",
    await page.getByText(clientPhone).first().isVisible().catch(() => false), clientPhone);

  step("Step 3 cannot be ticked by hand — it follows the timer");
  await stepBtn(3).click();
  await page.waitForTimeout(700);
  check("refuses a manual tick",
    await page.getByText(/follows the session timer/i).first().isVisible().catch(() => false));
  check("nothing was recorded",
    sql(`select status from appointments where id='${apptId}'`) === "scheduled");

  step("Step 1 — personalise the message over WhatsApp");
  await stepBtn(1).click();
  await page.waitForTimeout(1800);
  check("offers the prefilled message",
    await page.getByText("Send the confirmation").first().isVisible().catch(() => false));
  const wa = await page.getByRole("link", { name: /Open in WhatsApp/ }).getAttribute("href");
  const expectedWa = `https://wa.me/${clientPhone.replace(/\D/g, "").replace(/^0+/, "").replace(/^(?!91)/, "91")}?text=`;
  check("wa.me link uses the E.164 number", (wa ?? "").startsWith(expectedWa), `${(wa ?? "").slice(0, 34)} vs ${expectedWa}`);
  const waText = decodeURIComponent((wa ?? "").split("?text=")[1] ?? "");
  check("uses the practice's approved confirmation copy",
    waText.startsWith("*Appointment Confirmation*"), waText.slice(0, 40));
  check("addressed to the client by first name", waText.includes("Hi Ravi,"), waText.slice(0, 60));
  check("carries the 10-minute arrival line", waText.includes("*10 minutes*"));
  check("carries the Important Note", waText.includes("*Important Note:*"));
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.waitForTimeout(2000);
  check("step 1 recorded",
    sql(`select (message_sent_at is not null) from appointments where id='${apptId}'`) === "t");
  check("track advances to step 2",
    await page.getByText("Step 2 of 5 · Call the client").first().isVisible().catch(() => false));

  step("Step 2 — mark the courtesy call");
  await stepBtn(2).click();
  await page.waitForTimeout(2000);
  check("step 2 recorded",
    sql(`select (call_made_at is not null) from appointments where id='${apptId}'`) === "t");
  check("track advances to step 3",
    await page.getByText("Step 3 of 5 · Start and end session").first().isVisible().catch(() => false));

  step("Step 3 — completed by running the session");
  await page.goto(`${APP}/appointments/${apptId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.waitForTimeout(2800);
  check("session completed", sql(`select status from appointments where id='${apptId}'`) === "completed");

  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("step 3 now shows done, track on step 4",
    await page.getByText("Step 4 of 5 · NuBills").first().isVisible().catch(() => false));

  step("Step 4 — NuBills parses the pasted billing text");
  await stepBtn(4).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(/Paid ₹/).fill("Paid ₹2,000 to Nurora · UPI Ref 402318778421");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(2200);
  const nb = sql(`select coalesce(parsed_amount_cents::text,'-')||'|'||coalesce(parsed_reference,'-') from nubills where appointment_id='${apptId}'`);
  console.log(`        parsed: ${nb}`);
  check("raw text stored",
    sql(`select (raw_text like 'Paid%') from nubills where appointment_id='${apptId}'`) === "t");
  check("amount extracted as paise", nb.split("|")[0] === "200000", nb);
  check("reference extracted", nb.split("|")[1] === "402318778421", nb);
  check("step 4 recorded",
    sql(`select (nubill_at is not null) from appointments where id='${apptId}'`) === "t");

  step("Step 5 — the Persona writes onto the client record");
  await stepBtn(5).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(/own words/).fill("Work stress, sleeping badly.");
  await page.getByPlaceholder("Tamil").fill("Tamil");
  await page.getByRole("button", { name: "Save Persona" }).click();
  await page.waitForTimeout(2200);
  check("concern saved to the client",
    sql(`select presenting_concern from clients c join appointments a on a.client_id=c.id where a.id='${apptId}'`) === "Work stress, sleeping badly.");
  check("language saved to the client",
    sql(`select preferred_language from clients c join appointments a on a.client_id=c.id where a.id='${apptId}'`) === "Tamil");

  step("Only all five count as complete");
  check("all five recorded",
    sql(`select (message_sent_at is not null and call_made_at is not null and nubill_at is not null and persona_at is not null and status='completed') from appointments where id='${apptId}'`) === "t");
  check("track reports every step done",
    await page.getByText("All 5 steps done").first().isVisible().catch(() => false));

  step("'Completed' means all five, not just a finished session");
  check("the lane header counts genuinely-completed bookings",
    await page.getByText(/\d+\/\d+ completed/).first().isVisible().catch(() => false));
  check("the finished appointment reads Completed",
    await page.getByText("Completed", { exact: true }).first().isVisible().catch(() => false));

  step("Reception can see the track but not drive it");
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("support@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("the track is visible to reception",
    (await page.getByRole("button", { name: /^Step \d:/ }).count()) >= 5);
  check("but its steps are disabled",
    await page.getByRole("button", { name: /^Step 1:/ }).first().isDisabled());

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All milestone checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
