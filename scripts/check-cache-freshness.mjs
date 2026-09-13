/**
 * Reference data is cached across requests, so the risk is staleness:
 * an admin edits the price list and the booking dialog keeps offering
 * the old one. Every mutation must invalidate its tag.
 *
 *   supabase db reset && node scripts/check-cache-freshness.mjs
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

async function serviceOptions() {
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  const opts = await page.getByLabel("Service / Category").locator("option").allTextContents();
  await page.keyboard.press("Escape");
  return opts;
}

try {
  await signIn(page, "anisha@nurora.demo");

  step("Baseline: the dialog offers the cached price list");
  let opts = await serviceOptions();
  check("Couple Therapy at ₹3,000", opts.some((o) => o.includes("Couple Therapy — ₹3,000")),
    opts.find((o) => o.includes("Couple Therapy")) ?? "missing");

  step("Editing a price invalidates the cache");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  await page.getByRole("row", { name: /Couple Therapy\s/ }).first()
    .getByRole("button", { name: "Edit" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("spinbutton", { name: "Price (₹)" }).fill("3750");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(2500);

  opts = await serviceOptions();
  check("the dialog shows the NEW price immediately",
    opts.some((o) => o.includes("Couple Therapy — ₹3,750")),
    opts.find((o) => o.includes("Couple Therapy")) ?? "missing");
  check("and no longer the old one",
    !opts.some((o) => o.includes("Couple Therapy — ₹3,000")));

  step("Adding a service appears without a restart");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add service" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^Name/ }).fill("Cache Probe Session");
  await page.getByRole("spinbutton", { name: "Price (₹)" }).fill("1234");
  await page.getByRole("button", { name: "Add service" }).last().click();
  await page.waitForTimeout(2500);

  opts = await serviceOptions();
  check("new service offered", opts.some((o) => o.includes("Cache Probe Session — ₹1,234")),
    opts.filter((o) => o.includes("Cache")).join("|") || "missing");

  step("Retiring it removes it again");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  await page.getByRole("row", { name: /Cache Probe Session/ }).getByRole("button", { name: "Retire" }).click();
  await page.waitForTimeout(2500);
  opts = await serviceOptions();
  check("retired service no longer offered",
    !opts.some((o) => o.includes("Cache Probe Session")));

  step("A new tag shows up in the dialog");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add tag" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^Label/ }).fill("Cache Tag");
  await page.getByRole("textbox", { name: /^Short form/ }).fill("CT");
  await page.getByRole("button", { name: "Add tag" }).last().click();
  await page.waitForTimeout(2500);
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  check("new tag offered",
    await page.getByRole("button", { name: /Cache Tag \(CT\)/ }).isVisible().catch(() => false));
  await page.keyboard.press("Escape");

  step("Clinic settings changes take effect immediately");
  await page.goto(`${APP}/clinic-settings`, { waitUntil: "networkidle" });
  await page.getByRole("spinbutton", { name: "At or below (₹)" }).fill("400");
  await page.getByRole("spinbutton", { name: "Above (₹)" }).fill("900");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" });
  check("saved value is read back, not a cached zero",
    (await page.getByRole("spinbutton", { name: "At or below (₹)" }).inputValue()) === "400");
  check("warning about unset tiers is gone",
    (await page.getByText(/Advance tiers are both zero/).count()) === 0);

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All cache-freshness checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
