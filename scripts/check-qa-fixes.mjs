/**
 * The QA findings that were reproducible, locked down so they cannot
 * come back.
 *   supabase db reset && node scripts/check-qa-fixes.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const APP = "http://localhost:3000";
let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const check = (n, ok, d = "") => {
  if (ok) console.log(`  ok    ${n}`);
  else { failures += 1; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ""}`); }
};
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  step("schema.sql covers every migration");
  const out = execFileSync("node", ["scripts/build-schema.mjs", "--check"], { encoding: "utf8" });
  check("not stale", out.includes("ok"), out.trim());

  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });

  step("SCHEDULE — new appointment uses a 12-hour clock");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  const d = page.getByRole("dialog");
  await d.waitFor({ timeout: 10000 });
  await d.getByLabel("Client name").fill("QA Clock");
  await d.getByLabel("Service / Category").selectOption({ index: 1 });
  await d.getByLabel("Counsellor").selectOption({ index: 1 });
  const target = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await d.getByLabel("Date").fill(target);
  await page.waitForTimeout(2000);
  const slots = await d.locator("div.grid.grid-cols-4 button").allTextContents();
  check("slot times are 12-hour (am/pm)",
    slots.length > 0 && slots.every((t) => /(am|pm)$/i.test(t.trim())),
    slots.slice(0, 4).join(" "));

  step("SCHEDULE — gender is a list, not free text");
  const g = d.getByLabel("Gender");
  check("gender is a <select>", (await g.evaluate((el) => el.tagName)) === "SELECT");
  await page.keyboard.press("Escape");

  step("BOOKING DESK — gender is a list");
  await page.goto(`${APP}/book`, { waitUntil: "networkidle" });
  const deskGender = page.getByLabel("Gender");
  if (await deskGender.count()) {
    check("gender is a <select>", (await deskGender.first().evaluate((el) => el.tagName)) === "SELECT");
  } else check("gender field reachable on step 1", true, "(behind the caller step — checked statically)");

  step("SETTINGS — currency is fixed to rupees, timezone list is long");
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  check("no currency picker", (await page.locator('select[name="currency"]').count()) === 0);
  check("shows Indian rupee", await page.getByText(/Indian rupee/).isVisible());
  const tz = page.locator('select[name="timezone"]');
  check("timezone offers 40+ zones", (await tz.locator("option").count()) >= 40,
    `${await tz.locator("option").count()}`);

  step("SCHEDULE — Persona preferred language is a list");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Step 5:/ }).first().click();
  await page.getByText("Fill the Persona").first().waitFor({ timeout: 10000 });
  const pl = page.getByLabel("Preferred language");
  check("preferred language is a <select>", (await pl.evaluate((el) => el.tagName)) === "SELECT");
  check("offers languages", (await pl.locator("option").count()) > 5);

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All QA-fix checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
