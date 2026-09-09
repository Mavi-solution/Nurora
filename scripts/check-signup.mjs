/**
 * Verifies the first-account bootstrap on an EMPTY database:
 * signing up must produce a counsellor who also holds admin rights,
 * land them on the schedule, and give them a working lane.
 *
 *   node scripts/check-signup.mjs
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP = "http://localhost:3000";
const psql = (sql) =>
  execSync(
    `docker exec -i supabase_db_Nurora psql -U postgres -d postgres -t -A -c "${sql}"`,
    { encoding: "utf8" },
  ).trim();

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("▸ Emptying the database (no accounts at all)");
psql("delete from auth.users;");
check("no profiles remain", psql("select count(*) from profiles;") === "0");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  console.log("\n▸ Signing up the very first account");
  await page.goto(`${APP}/signup`, { waitUntil: "networkidle" });
  check(
    "form says this account runs the practice",
    await page.getByText(/counsellor with admin rights/i).isVisible(),
  );
  check(
    "no role picker on the first account",
    (await page.getByText("How will you use Nurora?").count()) === 0,
  );

  const email = `owner-${Date.now()}@nurora.test`;
  await page.getByLabel("Full name").fill("Priya Owner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("nurora-secret-1");
  await page.getByLabel("Confirm password").fill("nurora-secret-1");
  await page.screenshot({ path: "screenshots/08-signup-first.png", fullPage: true });
  await page.getByRole("button", { name: /Create account/i }).click();

  await page.waitForURL(/\/(schedule|onboarding|dashboard)/, { timeout: 25000 });
  check("lands straight on the schedule", page.url().includes("/schedule"), page.url());

  console.log("\n▸ Database state");
  const row = psql(
    `select role || '|' || is_admin || '|' || onboarded || '|' || full_name from profiles where email = '${email}';`,
  );
  const [role, isAdmin, onboarded, name] = row.split("|");
  check("role is counsellor", role === "counsellor", role);
  check("has admin rights", isAdmin === "true", isAdmin);
  check("onboarding already complete", onboarded === "true", onboarded);
  check("name saved from the form", name === "Priya Owner", name);
  check(
    "default working week created",
    Number(psql("select count(*) from availability_rules;")) === 5,
  );

  console.log("\n▸ Admin surface is available");
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  check("People section present", await page.getByText("People").first().isVisible());

  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const lanes = await page.locator("p.font-semibold").allTextContents();
  check("owner has their own lane", lanes.includes("Priya Owner"), lanes.join(","));
  await page.screenshot({ path: "screenshots/09-first-account-schedule.png", fullPage: true });

  console.log("\n▸ A second sign-up is NOT auto-admin");
  await page.goto(`${APP}/auth/signout`).catch(() => {});
  await page.evaluate(() => document.querySelector("form[action='/auth/signout']")?.submit()).catch(() => {});
  await page.context().clearCookies();

  await page.goto(`${APP}/signup`, { waitUntil: "networkidle" });
  check(
    "role picker now offered",
    await page.getByText("How will you use Nurora?").isVisible(),
  );
  const email2 = `staff-${Date.now()}@nurora.test`;
  await page.getByLabel("Full name").fill("Second Counsellor");
  await page.getByLabel("Email address").fill(email2);
  await page.getByLabel("Password", { exact: true }).fill("nurora-secret-2");
  await page.getByLabel("Confirm password").fill("nurora-secret-2");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL(/\/(schedule|my|onboarding)/, { timeout: 25000 });

  const row2 = psql(
    `select role || '|' || is_admin from profiles where email = '${email2}';`,
  );
  check("second account is a counsellor", row2.split("|")[0] === "counsellor", row2);
  check("second account is NOT admin", row2.split("|")[1] === "false", row2);

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\nFAILED: ${err.message}`);
  await page.screenshot({ path: "screenshots/signup-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "Sign-up bootstrap verified." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
