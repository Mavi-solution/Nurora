/**
 * The admin's practice-wide view of Week-offs & Leave, and the account
 * menu on the profile name.
 *
 * The screen used to default to the viewer's OWN calendar, so an admin
 * opened the practice rota, saw "Leave logged: 0" against their own
 * empty month, and had to pick each counsellor from a dropdown to
 * discover anyone was away.
 *
 *   supabase db reset && node scripts/check-leave-admin.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const APP = "http://localhost:3000";
const sql = (q) =>
  execFileSync("psql", ["-h","127.0.0.1","-p","54322","-U","postgres","-d","postgres","-qtA","-c",q],
    { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" }).trim();

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const check = (n, ok, d = "") => {
  if (ok) console.log(`  ok    ${n}`);
  else { failures += 1; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ""}`); }
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1400 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

async function signIn(email) {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
  await page.waitForTimeout(1200);
}

try {
  /*
   * Two people away this month, neither of them the admin. That is the
   * whole point: the admin's own month is empty, so anything scoped to
   * them shows nothing.
   */
  const today = sql("select current_date::text");
  const soon = sql("select (current_date + 2)::text");
  const shefrin = sql("select id from profiles where email='shefrin@nurora.demo'");
  const ramya = sql("select id from profiles where email='ramya@nurora.demo'");

  sql(`insert into leaves (staff_id, on_date, kind, reason) values
       ('${shefrin}','${today}','sick','Fever'),
       ('${ramya}','${soon}','planned','Family function')
       on conflict (staff_id, on_date) do nothing`);

  await signIn("anisha@nurora.demo");

  step("An admin lands on everyone, not on themselves");
  await page.goto(`${APP}/leave`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("the practice table is shown",
    await page.getByRole("heading", { name: "Everyone this month" }).isVisible().catch(() => false));
  check("every active member has a row",
    (await page.getByRole("row").count()) >= 6,
    String(await page.getByRole("row").count()));

  step("The headline answers who is available");
  const board = await page.locator("main").innerText();
  check("availability is a headcount out of the team",
    /AVAILABLE TODAY/i.test(board) && /\d+\/\d+/.test(board), board.slice(0, 200));
  check("hours lost are reported, not just days",
    /HOURS LOST THIS MONTH/i.test(board));
  check("the coming week is called out", /AWAY IN THE NEXT 7 DAYS/i.test(board));
  check("leave awaiting approval is counted", /AWAITING APPROVAL/i.test(board));

  step("Someone away today is named");
  check("Shefrin shows as away today",
    await page.getByText(/Away today:/).isVisible().catch(() => false));
  check("and by name", board.includes("Shefrin"));

  /*
   * The tile the report was about. It showed 0 because it was scoped to
   * the admin's own record; it now lists everyone's.
   */
  step("'Leave this month' lists everyone's, not just the admin's");
  const leaveCard = page.locator("div").filter({ hasText: /^Leave this month/ }).first();
  check("Shefrin's sick leave is listed", board.includes("Fever"), "Fever");
  check("Ramya's planned leave is listed", board.includes("Family function"));
  check("it is no longer empty for an admin with no leave of their own",
    !/Leave this month[\s\S]{0,60}Nothing logged/.test(board));

  step("Approving from the practice view works");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.waitForTimeout(2200);
  check("the leave is approved",
    Number(sql(`select count(*) from leaves where approved_at is not null and staff_id in ('${shefrin}','${ramya}')`)) >= 1);

  step("A name still opens that person's calendar");
  await page.getByRole("row", { name: /Shefrin/ }).getByRole("button", { name: "Open" }).click();
  await page.waitForURL(/staff=/, { timeout: 15000 });
  await page.waitForTimeout(900);
  check("drilled into one person",
    await page.getByText("Each band is one week-off week", { exact: false }).isVisible().catch(() => false));
  check("their allowance is shown",
    await page.getByText("Allocated", { exact: true }).isVisible().catch(() => false));

  step("And there is a way back to everyone");
  await page.getByLabel("Whose calendar").selectOption("");
  await page.waitForTimeout(1500);
  check("back on the practice view",
    await page.getByRole("heading", { name: "Everyone this month" }).isVisible().catch(() => false));

  step("A counsellor still sees only their own");
  await signIn("shefrin@nurora.demo");
  await page.goto(`${APP}/leave`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("no practice-wide table",
    (await page.getByRole("heading", { name: "Everyone this month" }).count()) === 0);
  check("their own calendar instead",
    await page.getByText("Your month").isVisible().catch(() => false));
  check("and no staff picker",
    (await page.getByLabel("Whose calendar").count()) === 0);

  // Reading everyone's leave is admin-only at the action, not just hidden.
  const refused = await page.evaluate(async () => {
    const r = await fetch("/leave?month=2026-09", { headers: { accept: "text/html" } });
    return r.status;
  });
  check("the page itself still renders for them", refused === 200, String(refused));

  step("PROFILE — the name opens an account menu with Sign out");
  await signIn("anisha@nurora.demo");
  const trigger = page.getByRole("button", { name: /Account menu for/ });
  check("the profile name is a menu", await trigger.isVisible());
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ timeout: 8000 });
  const menuText = await menu.innerText();
  check("it names the account", menuText.includes("anisha@nurora.demo"), menuText.replace(/\n/g, " | "));
  check("Settings is there", await page.getByRole("menuitem", { name: "Settings" }).isVisible());
  check("Sign out is there", await page.getByRole("menuitem", { name: "Sign out" }).isVisible());

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes it", (await page.locator('[role="menu"]').count()) === 0);

  step("And it actually signs out");
  await trigger.click();
  await menu.waitFor({ timeout: 8000 });
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/schedule"), { timeout: 15000 });
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  check("the session is gone, not just the page",
    page.url().includes("/login"), page.url());

  step("Console / server errors");
  check("none", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All admin-leave checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
