/**
 * Week-offs, leave and holidays — including the quota rule the handoff
 * marks MUST MATCH, enforced through the real UI.
 *
 *   supabase db reset && node scripts/check-leave.mjs
 */
import { chromium } from "playwright";

const APP = "http://localhost:3000";
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

/**
 * Past days are not selectable by default — for admins either, since an
 * admin account is what a practice uses day to day. Correcting a month
 * that has gone is a deliberate act, so it has a deliberate switch.
 *
 * August 2026 is one of the two months ARCHITECTURE.md names as the
 * acceptance test for the quota rule, so the test has to reach it
 * whatever today's date happens to be.
 */
async function allowPastDays() {
  const box = page.getByLabel("Allow past days");
  if (await box.count()) await box.check();
  await page.waitForTimeout(250);
}

// Take a week-off on the given day-of-month, via the calendar.
async function takeWeekOff(day) {
  await page.getByRole("button", { name: String(day), exact: true }).first().click();
  await page.waitForTimeout(500);
  const btn = page.getByRole("button", { name: /Take a week-off|No week-offs left/ });
  const disabled = await btn.isDisabled();
  if (disabled) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); return "blocked"; }
  await btn.click();
  await page.waitForTimeout(1400);
  const err = await page.locator("[class*='red']").first().textContent().catch(() => null);
  if (err && err.trim()) { await page.keyboard.press("Escape"); return err.trim(); }
  return "taken";
}

try {
  await signIn(page, "anisha@nurora.demo");

  /* --- the handoff's two named months, shown through the UI --------- */
  step("The quota on screen matches the computed rule");

  await page.goto(`${APP}/leave?month=2026-08`, { waitUntil: "networkidle" });
  check("page renders", await page.getByRole("heading", { name: "Week-offs & Leave", level: 1 }).isVisible());
  const statText = (label) =>
    page.getByText(label, { exact: true })
      .locator("xpath=following-sibling::div[1]")
      .textContent();
  const augAllowance = await statText("Allocated");
  check("August 2026 shows an allocation of 4", (augAllowance ?? "").trim() === "4", augAllowance ?? "");
  check("August renders 4 week bands", (await page.getByTitle(/^Week \d+:/).count()) === 4,
    `${await page.getByTitle(/^Week \d+:/).count()} bands`);

  await page.goto(`${APP}/leave?month=2026-09`, { waitUntil: "networkidle" });
  const sepAllowance = await statText("Allocated");
  check("September 2026 shows an allocation of 5", (sepAllowance ?? "").trim() === "5", sepAllowance ?? "");
  check("September renders 5 week bands", (await page.getByTitle(/^Week \d+:/).count()) === 5,
    `${await page.getByTitle(/^Week \d+:/).count()} bands`);

  /* --- one per week, then the quota itself -------------------------- */
  step("August 2026: one week-off per week, then the allowance runs out");
  await page.goto(`${APP}/leave?month=2026-08`, { waitUntil: "networkidle" });
  await allowPastDays();

  // August 2026 rows after merging: 1-8, 9-15, 16-22, 23-31.
  check("first week-off is accepted", (await takeWeekOff(3)) === "taken");

  const sameWeek = await takeWeekOff(5);
  check("a second in the SAME week is refused", /Only one per week/i.test(sameWeek), sameWeek);

  check("a week-off in week 2 is accepted", (await takeWeekOff(10)) === "taken");
  check("a week-off in week 3 is accepted", (await takeWeekOff(17)) === "taken");
  check("a week-off in week 4 is accepted", (await takeWeekOff(24)) === "taken");

  await page.reload({ waitUntil: "networkidle" });
  await allowPastDays();
  const fifth = await takeWeekOff(26);
  check("a fifth is refused once the allowance is spent",
    fifth === "blocked" || /allows 4|Only one per week/i.test(fifth), fifth);

  const takenStat = await statText("Taken");
  check("the counter reads 4 taken", (takenStat ?? "").trim() === "4", takenStat ?? "");

  /* --- leave and holidays ------------------------------------------ */
  step("Leave is separate from a week-off");
  await page.getByRole("button", { name: "26", exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.locator("select").last().selectOption("sick");
  await page.getByPlaceholder("Reason (optional)").fill("Fever");
  await page.getByRole("button", { name: "Log leave" }).click();
  await page.waitForTimeout(1500);
  check("leave can still be logged after the quota is spent",
    await page.getByText("Fever").first().isVisible().catch(() => false));

  step("Admin adds an org-wide holiday");
  await page.getByRole("button", { name: "Add holiday" }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("Date").last().fill("2026-08-15");
  await page.getByLabel("Name").fill("Independence Day");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(1500);
  check("holiday appears", await page.getByText("Independence Day").first().isVisible().catch(() => false));

  /* --- permissions -------------------------------------------------- */
  step("A non-admin counsellor cannot set clinic holidays");
  await signIn(page, "shefrin@nurora.demo");
  await page.goto(`${APP}/leave`, { waitUntil: "networkidle" });
  check("no Add holiday button for a plain counsellor",
    (await page.getByRole("button", { name: "Add holiday" }).count()) === 0);
  check("no staff picker for a plain counsellor",
    (await page.locator("select[aria-label='Whose calendar']").count()) === 0);

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All leave checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
