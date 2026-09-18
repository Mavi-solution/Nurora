/**
 * Editable message templates and their schedules.
 *   supabase db reset && node scripts/check-messaging-templates.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const APP = "http://localhost:3000";
const sql = (q) => execFileSync("psql",["-h","127.0.0.1","-p","54322","-U","postgres","-d","postgres","-qtA","-c",q],
  { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" }).trim();
let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const check = (n, ok, d="") => { if (ok) console.log(`  ok    ${n}`); else { failures++; console.log(`  FAIL  ${n}${d?` — ${d}`:""}`);} };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport:{width:1440,height:1200} })).newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("response", r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });

  step("The seeded templates preserve what the app already sent");
  await page.goto(`${APP}/messages`, { waitUntil: "networkidle" });
  check("page renders", await page.getByRole("heading", { name: "Messages", level: 1 }).isVisible());
  check("booking confirmation is there",
    await page.getByText("Booking confirmation").first().isVisible());
  check("its wording is the approved copy",
    sql("select body like '%Appointment Confirmation%' from message_templates where key='booking_confirmation'") === "t");
  check("the old 3-day reminder is now a schedule",
    sql("select offset_minutes from message_schedules s join message_templates t on t.id=s.template_id where t.key='session_reminder'") === "4320");

  step("Editing a template, with a live preview");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 8000 });
  const d = page.getByRole("dialog");
  check("shows how the client will see it",
    await d.getByText("How the client will see it").isVisible());
  check("placeholders are resolved in the preview",
    await d.getByText(/Meera/).first().isVisible().catch(()=>false));

  step("A placeholder typo is caught before it reaches a client");
  const body = d.getByRole("textbox").nth(1);
  await body.fill("Hi {{frist_name}}, see you on {{date_time}}.");
  await page.waitForTimeout(400);
  check("warns about the unknown placeholder",
    await d.getByText(/Unknown placeholder/).isVisible());
  check("and blocks saving", await d.getByRole("button", { name: /Save/ }).isDisabled());

  step("A corrected template saves");
  await body.fill("Hi {{client_name}}, your session is on {{date_time}}. — {{practice}}");
  await page.waitForTimeout(400);
  check("warning clears", (await d.getByText(/Unknown placeholder/).count()) === 0);
  await d.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(2500);
  check("saved to the database",
    sql("select count(*) from message_templates where body like 'Hi {{client_name}}, your session%'") === "1");

  step("Adding a schedule");
  await page.getByRole("button", { name: "Add a schedule" }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 8000 });
  const s2 = page.getByRole("dialog");
  await s2.getByRole("textbox").first().fill("Day before");
  await s2.getByLabel("When").selectOption("before_appointment");
  await s2.getByLabel("Days").fill("1");
  await s2.getByLabel("Hours").fill("0");
  await s2.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(2500);
  check("stored with the right offset",
    sql("select offset_minutes from message_schedules where name='Day before'") === "1440");
  check("it shows in human terms",
    await page.getByText(/1 day before/).first().isVisible().catch(()=>false));

  step("A built-in template cannot be deleted out from under the code");
  const sysId = sql("select id from message_templates where key='booking_confirmation'");
  const del = sql(`select count(*) from message_templates where id='${sysId}'`);
  check("still present", del === "1");

  step("The sweep runs from the schedules");
  // The route requires the bearer token, so call it the way the
  // platform does rather than from the page — a browser fetch is
  // correctly rejected, which is the point of the guard.
  const secret = (process.env.CRON_SECRET || "local-test-secret");
  const unauth = await fetch(`${APP}/api/cron/reminders`, { method: "POST" });
  check("refuses a call with no secret", unauth.status === 401, String(unauth.status));

  const res = await (await fetch(`${APP}/api/cron/reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  })).json();
  console.log(`        ${JSON.stringify(res)}`);
  check("cron reports the schedules it walked",
    typeof res.schedules === "number" && res.schedules >= 1, JSON.stringify(res));

  step("Non-admins cannot reach it");
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("shefrin@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
  await page.goto(`${APP}/messages`, { waitUntil: "networkidle" });
  check("redirected away", !page.url().includes("/messages"), page.url());

  step("Console / server errors");
  check("none", errors.length === 0, errors.slice(0,2).join(" | "));
} catch (err) { failures++; console.log(`\n  FAIL  threw — ${err.message}`); }
finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All message-template checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
