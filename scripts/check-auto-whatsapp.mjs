/**
 * WhatsApp automation: the app sends the message itself when Twilio is
 * configured, and falls back to a hand-tapped link when it is not.
 *
 *   supabase db reset && node scripts/check-auto-whatsapp.mjs
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
async function signIn(page) {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });
}
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1050 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  await signIn(page);

  step("Twilio NOT configured — falls back to sending by hand");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^Step 1:/ }).first().click();
  await page.getByText("Send the confirmation").waitFor({ timeout: 15000 });
  check("says WhatsApp is not connected",
    await page.getByText(/WhatsApp is not connected/).isVisible().catch(() => false));
  check("offers the manual link",
    await page.getByRole("link", { name: /Open in WhatsApp/ }).isVisible());
  check("no automatic send offered",
    (await page.getByRole("button", { name: /Send it now/ }).count()) === 0);
  check("primary action is Mark as sent",
    await page.getByRole("button", { name: "Mark as sent" }).isVisible());
  await page.keyboard.press("Escape");

  step("Follow-ups behave the same way");
  await page.goto(`${APP}/follow-ups`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New follow-up" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^What to send/ }).fill("the exercise sheet");
  await page.locator("select").last().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Send & complete" }).first().click();
  await page.waitForTimeout(2000);
  check("manual link offered", await page.getByRole("link", { name: /Open in WhatsApp/ }).isVisible());
  check("no automatic send offered",
    (await page.getByRole("button", { name: /Send it now/ }).count()) === 0);

  step("Nothing was sent, and nothing was falsely recorded");
  check("no whatsapp delivery logged",
    sql("select count(*) from notification_deliveries where kind='milestone_message'") === "0");
  check("milestone not ticked by merely opening the dialog",
    sql("select count(*) from appointments where message_sent_at is not null") === "0");

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All WhatsApp-automation checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
