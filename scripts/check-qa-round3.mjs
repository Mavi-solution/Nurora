/**
 * Round-3 QA findings.
 *   supabase db reset && node scripts/check-qa-round3.mjs
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

function utcDay(n) {
  const d = new Date(Date.now() + n*86400000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}

try {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("anisha@nurora.demo");
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard)/, { timeout: 20000 });

  step("A booking never becomes invisible when a counsellor is retired");
  const cid = sql("select id from profiles where full_name='Saranya'");
  const client = sql("select id from clients limit 1");
  sql(`insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
       values ('${cid}','${client}',
        (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '16 hours') at time zone 'Asia/Kolkata',
        (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '17 hours') at time zone 'Asia/Kolkata',
        'Retired Counsellor Session', 200000)`);
  sql(`update profiles set is_active=false where id='${cid}'`);
  await page.goto(`${APP}/counsellors`, { waitUntil: "networkidle" });
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  check("retired counsellor still gets a lane while booked",
    await page.getByText("Saranya").first().isVisible().catch(()=>false));
  check("and is labelled as no longer taking bookings",
    await page.getByText(/No longer taking bookings/).first().isVisible().catch(()=>false));
  sql(`update profiles set is_active=true where id='${cid}'`);

  step("Today button and the date/time header");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("full date shown at the top",
    await page.getByText(/\d{1,2} \w+ \d{4}/).first().isVisible().catch(()=>false));
  check("no Today button while already on today",
    (await page.getByRole("link", { name: "Back to today" }).count()) === 0);
  const other = utcDay(3);
  await page.goto(`${APP}/schedule?date=${other}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("Today button appears on another date",
    await page.getByRole("link", { name: "Back to today" }).isVisible());
  await page.getByRole("link", { name: "Back to today" }).click();
  await page.waitForTimeout(1500);
  check("it returns to today", !page.url().includes(other), page.url());

  step("A counsellor on week-off cannot be booked");
  const target = utcDay(4);
  const shef = sql("select id from profiles where full_name='Shefrin'");
  sql(`insert into week_offs (staff_id, on_date) values ('${shef}','${target}')
       on conflict do nothing`);
  const res = await page.evaluate(async ([c, d]) => {
    const r = await fetch(`/api/slots?counsellor=${c}&date=${d}&duration=60`);
    return (await r.json()).slots?.length ?? -1;
  }, [shef, target]);
  check("the slots API offers nothing that day", res === 0, `${res} slots`);

  const other2 = sql("select id from profiles where full_name='Mahek'");
  const res2 = await page.evaluate(async ([c, d]) => {
    const r = await fetch(`/api/slots?counsellor=${c}&date=${d}&duration=60`);
    return (await r.json()).slots?.length ?? -1;
  }, [other2, target]);
  check("another counsellor that day is unaffected", res2 > 0, `${res2} slots`);

  step("A clinic holiday closes the day for everyone");
  const hol = utcDay(5);
  sql(`insert into holidays (on_date, name) values ('${hol}','QA Holiday') on conflict do nothing`);
  const res3 = await page.evaluate(async ([c, d]) => {
    const r = await fetch(`/api/slots?counsellor=${c}&date=${d}&duration=60`);
    return (await r.json()).slots?.length ?? -1;
  }, [other2, hol]);
  check("no slots on a clinic holiday", res3 === 0, `${res3} slots`);

  step("Attendance shows hours worked, not just a log");
  sql(`insert into staff_shifts (staff_id, checked_in_at, checked_out_at)
       select id, now() - interval '3 hours', now() - interval '1 hour'
       from profiles where full_name='Anisha'`);
  await page.goto(`${APP}/attendance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("an hours-worked table is shown",
    await page.getByText("Hours worked").isVisible());
  check("with this-week and this-month columns",
    await page.getByRole("columnheader", { name: "This week" }).isVisible() &&
    await page.getByRole("columnheader", { name: "This month" }).isVisible());
  check("and a real total for the counsellor",
    await page.getByText(/2h 0m|1h 5\dm/).first().isVisible().catch(() => false));

  step("Console / server errors");
  check("none", errors.length === 0, errors.slice(0,2).join(" | "));
} catch (err) { failures++; console.log(`\n  FAIL  threw — ${err.message}`); }
finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All round-3 checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
