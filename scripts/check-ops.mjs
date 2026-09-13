/**
 * The remaining §3 surfaces: clinic settings (incl. billing tiers and
 * the geofence), follow-ups, commitments, reviews, per-feature
 * permissions and NuLancer.
 *   supabase db reset && node scripts/check-ops.mjs
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
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  await signIn(page, "anisha@nurora.demo");

  step("Clinic settings save, and drive the advance");
  await page.goto(`${APP}/clinic-settings`, { waitUntil: "networkidle" });
  check("warns tiers are unset", await page.getByText(/Advance tiers are both zero/).isVisible().catch(() => false));
  await page.getByRole("spinbutton", { name: "Threshold (₹)" }).fill("1500");
  await page.getByRole("spinbutton", { name: "At or below (₹)" }).fill("500");
  await page.getByRole("spinbutton", { name: "Above (₹)" }).fill("1000");
  await page.getByRole("spinbutton", { name: "Grace minutes" }).fill("10");
  await page.getByRole("spinbutton", { name: "Block price (₹)" }).fill("250");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForTimeout(2500);
  const row = sql("select advance_tier_threshold_cents||'|'||advance_at_or_below_cents||'|'||advance_above_cents||'|'||grace_minutes||'|'||extension_block_cents from clinic_settings");
  check("saved as paise", row === "150000|50000|100000|10|25000", row);

  step("Geofence refuses check-out tighter than check-in");
  await page.getByRole("spinbutton", { name: "Check-in radius (m)" }).fill("500");
  await page.getByRole("spinbutton", { name: "Check-out radius (m)" }).fill("100");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForTimeout(2000);
  check("rejected, with the reason",
    await page.getByText(/leaving is checked more leniently than arriving/).isVisible().catch(() => false));

  step("Follow-up completion records HOW it was finished");
  await page.goto(`${APP}/follow-ups`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New follow-up" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^What to send/ }).fill("the breathing exercise sheet");
  await page.locator("select").last().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(2200);
  check("created", sql("select count(*) from follow_ups where what like 'the breathing%'") === "1");

  await page.getByRole("button", { name: "Send & complete" }).first().click();
  await page.waitForTimeout(2000);
  const wa = await page.getByRole("link", { name: /Open in WhatsApp/ }).getAttribute("href").catch(() => null);
  check("offers a prefilled WhatsApp link", (wa ?? "").startsWith("https://wa.me/"), String(wa).slice(0, 30));
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.waitForTimeout(2200);
  check("recorded as sent on WhatsApp",
    sql("select completed_via from follow_ups where what like 'the breathing%'") === "whatsapp");

  step("Commitments tab");
  await page.goto(`${APP}/follow-ups?tab=commitments`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New commitment" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^Commitment/ }).fill("Order new intake forms");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(2200);
  check("created", sql("select count(*) from commitments where title='Order new intake forms'") === "1");
  await page.getByRole("checkbox", { name: "Order new intake forms" }).check();
  await page.waitForTimeout(2200);
  check("marked done", sql("select (done_at is not null) from commitments where title='Order new intake forms'") === "t");

  step("Google Reviews with a monthly milestone");
  await page.goto(`${APP}/clinic-settings`, { waitUntil: "networkidle" });
  await page.getByRole("spinbutton", { name: "Reviews per counsellor / month" }).fill("2");
  await page.getByRole("spinbutton", { name: "Check-out radius (m)" }).fill("1000");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForTimeout(2200);
  await page.goto(`${APP}/reviews`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log a review" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^Client name/ }).fill("Grateful Client");
  await page.getByRole("button", { name: "Log it" }).click();
  await page.waitForTimeout(2200);
  check("logged", sql("select count(*) from reviews where client_name='Grateful Client'") === "1");
  check("milestone bar shown", await page.getByText("Monthly milestone by counsellor").isVisible());

  step("Per-feature permissions");
  const id = sql("select id from profiles where email='shefrin@nurora.demo'");
  await page.goto(`${APP}/counsellors/${id}`, { waitUntil: "networkidle" });
  check("Feature access card", await page.getByText("Feature access").isVisible());
  await page.getByRole("checkbox", { name: "Nubills" }).uncheck();
  await page.waitForTimeout(2200);
  check("stored as off", sql(`select nubills from counsellor_permissions where counsellor_id='${id}'`) === "f");
  check("others stay on", sql(`select bric from counsellor_permissions where counsellor_id='${id}'`) === "t");

  step("NuLancer and benefits");
  await page.getByRole("checkbox", { name: /is a NuLancer/ }).check();
  await page.waitForTimeout(2200);
  check("flagged", sql(`select is_nulancer from profiles where id='${id}'`) === "t");
  await page.getByRole("spinbutton", { name: "Individual session (₹)" }).fill("800");
  await page.getByRole("button", { name: "Save rates" }).click();
  await page.waitForTimeout(2200);
  check("rate saved as paise", sql(`select nulancer_individual_cents from profiles where id='${id}'`) === "80000");
  await page.getByRole("button", { name: "Grant a benefit" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^Benefit/ }).fill("Supervision hours");
  await page.getByRole("button", { name: "Grant", exact: true }).click();
  await page.waitForTimeout(2200);
  check("benefit granted", sql(`select count(*) from benefits where counsellor_id='${id}'`) === "1");

  step("Clinic settings are admin-only");
  await signIn(page, "shefrin@nurora.demo");
  await page.goto(`${APP}/clinic-settings`, { waitUntil: "networkidle" });
  check("redirected away", !page.url().includes("/clinic-settings"), page.url());

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All ops checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
