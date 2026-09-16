/**
 * Field validation fires on blur — when you leave the field — not on
 * submit, and clears as you correct it.
 *   supabase db reset && node scripts/check-validation.mjs
 */
import { chromium } from "playwright";
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

/** Type junk, tab away, and see whether it complains there and then. */
async function blurCheck(label, field, junk, good) {
  await field.click();
  await field.fill(junk);
  await field.blur();
  await page.waitForTimeout(300);

  // Look at THIS field's own message, not whichever alert happens to be
  // first on the page — another field's error would give a false pass.
  const describedBy = await field.getAttribute("aria-describedby");
  check(`${label}: rejects ${JSON.stringify(junk)} on blur`, Boolean(describedBy),
    describedBy === null ? "no error message rendered" : "");
  if (describedBy) {
    const msg = await page.evaluate(
      (id) => document.getElementById(id)?.textContent ?? "",
      describedBy,
    );
    console.log(`        says: "${(msg || "").trim()}"`);
  }
  check(`${label}: marked aria-invalid`,
    (await field.getAttribute("aria-invalid")) === "true");

  await field.click();
  await field.fill(good);
  await page.waitForTimeout(300);
  check(`${label}: clears once corrected`,
    (await field.getAttribute("aria-invalid")) === null);
}

try {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });

  step("BOOKING — WhatsApp number");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  await page.getByRole("dialog").waitFor({ timeout: 10000 });
  await blurCheck("whatsapp", page.getByRole("dialog").getByLabel("WhatsApp number"),
    "98400 1122a", "9840011223");
  await page.keyboard.press("Escape");

  step("CLIENT — phone and email");
  await page.goto(`${APP}/clients`, { waitUntil: "networkidle" });
  const nc = page.getByRole("button", { name: /New client|Add client/i }).first();
  if (await nc.count()) {
    await nc.click();
    await page.getByRole("dialog").waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    const dlgs = await page.getByRole("dialog").count();
    const inputs = await page.getByRole("dialog").locator("input").count();
    console.log(`        (dialogs on page: ${dlgs}, inputs inside: ${inputs})`);
    await blurCheck("client email", page.getByRole("dialog").getByRole("textbox", { name: "Email", exact: true }),
      "not-an-email", "someone@clinic.org");
    await blurCheck("client phone", page.getByRole("dialog").getByRole("textbox", { name: "Phone", exact: true }),
      "123", "9840011223");
    await page.keyboard.press("Escape");
  }

  step("SETTINGS — phone (uncontrolled form field)");
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  await blurCheck("settings phone",
    page.getByRole("textbox", { name: "Phone", exact: true }), "abcd", "+91 98400 11223");

  step("Nothing complains before you have touched it");
  await page.goto(`${APP}/clients`, { waitUntil: "networkidle" });
  if (await nc.count()) {
    await nc.click();
    await page.getByRole("dialog").waitFor({ timeout: 8000 });
    // Next's dev overlay keeps an empty role="alert" node around, so
    // count only alerts that actually say something.
    const stray = (await page.getByRole("alert").allTextContents())
      .map((t) => t.trim())
      .filter(Boolean);
    check("a freshly opened form shows no errors", stray.length === 0,
      JSON.stringify(stray));
    await page.keyboard.press("Escape");
  }

  step("Console errors");
  check("none", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All validation checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
