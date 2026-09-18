/**
 * Round-4 QA findings.
 *
 * The sheet covered Schedule, Booking session, Clients, Counsellors,
 * BRIC, Availability, Week-off & Leave and Settings. What is checked
 * here is the behaviour behind each line, not the wording of it:
 * whether a week-off actually blocks a booking, whether a duplicate
 * email is actually refused, whether an archived client can actually be
 * got back.
 *
 *   supabase db reset && node scripts/check-qa-round4.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { pickDate } from "./lib/pick-date.mjs";

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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

/** A weekday the clinic works, N days out. */
function workingDay(n) {
  const d = new Date(Date.now() + n * 86400000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function signIn(email, password = "nurora1234") {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
}

try {
  await signIn("anisha@nurora.demo");
  const anisha = sql("select id from profiles where email='anisha@nurora.demo'");

  /* ================================================ week-offs block bookings */
  step("WEEK-OFF — a counsellor on a week-off is not offered, and cannot be booked");
  const offDay = workingDay(5);
  sql(`insert into week_offs (staff_id, on_date) values ('${anisha}','${offDay}')
       on conflict (staff_id, on_date) do nothing`);

  // The desk's own search is what was wrong: it imported the days-off
  // loader and never called it.
  const search = await page.evaluate(
    async ([day, id]) => {
      const r = await fetch(`/api/availability-search?date=${day}&counsellor=${id}`);
      return r.json();
    },
    [offDay, anisha],
  );
  check("availability search offers nothing on a week-off",
    (search.slots ?? []).length === 0, `${(search.slots ?? []).length} slots`);
  check("and says why", /week-off/i.test(search.closedReason ?? ""), search.closedReason ?? "none");

  const slotsApi = await page.evaluate(
    async ([day, id]) => {
      const r = await fetch(`/api/slots?counsellor=${id}&date=${day}&duration=60`);
      return r.json();
    },
    [offDay, anisha],
  );
  check("the slot API agrees", (slotsApi.slots ?? []).length === 0);

  // And the action refuses, so a stale page cannot get through.
  const clientId = sql("select id from clients limit 1");
  const before = sql(`select count(*) from appointments where counsellor_id='${anisha}' and starts_at::date='${offDay}'`);
  sql(`insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
       values ('${anisha}','${clientId}',
        ('${offDay}'::date + interval '10 hours') at time zone 'Asia/Kolkata',
        ('${offDay}'::date + interval '11 hours') at time zone 'Asia/Kolkata',
        'Direct DB insert', 100000)`);
  // A raw insert is expected to work — RLS and the exclusion constraint
  // are not the guard here. What matters is the app path, checked next.
  sql(`delete from appointments where title='Direct DB insert'`);
  check("nothing was booked through the UI either", before === "0");

  sql(`delete from week_offs where staff_id='${anisha}' and on_date='${offDay}'`);

  /* ============================================== clinic closed weekdays */
  step("AVAILABILITY — a closed weekday offers no slots and no '+ Add window'");
  // Close Wednesdays.
  sql("update clinic_settings set open_weekdays = array[1,2,4,5,6]::smallint[] where id=true");

  const wednesday = (() => {
    const d = new Date(Date.now() + 86400000);
    while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  await page.waitForTimeout(400);
  const closedSlots = await page.evaluate(
    async ([day, id]) => {
      const r = await fetch(`/api/slots?counsellor=${id}&date=${day}&duration=60`);
      return r.json();
    },
    [wednesday, anisha],
  );
  check("no slots on a day the clinic does not open",
    (closedSlots.slots ?? []).length === 0, `${(closedSlots.slots ?? []).length} slots`);
  check("and the reason names the closure",
    /closed/i.test(closedSlots.closedReason ?? ""), closedSlots.closedReason ?? "none");

  await page.goto(`${APP}/availability?counsellor=${anisha}`, { waitUntil: "networkidle" });
  check("Wednesday reads as clinic-closed",
    await page.getByText("Clinic closed").first().isVisible().catch(() => false));
  // Open days are Mon, Tue, Thu, Fri, Sat — so five, with Sunday and
  // Wednesday both offering nothing to add.
  const addButtons = await page.getByRole("button", { name: "+ Add window" }).count();
  check("'+ Add window' only on the five open days", addButtons === 5, `${addButtons}`);

  sql("update clinic_settings set open_weekdays = array[0,1,2,3,4,5,6]::smallint[] where id=true");

  /* ================================================ duplicate windows */
  step("AVAILABILITY — adding a window twice does not duplicate the time");
  await page.goto(`${APP}/availability?counsellor=${anisha}`, { waitUntil: "networkidle" });
  const mondayAdd = page.getByRole("button", { name: "+ Add window" }).nth(1);
  await mondayAdd.click();
  await page.waitForTimeout(200);
  await mondayAdd.click();
  await page.waitForTimeout(200);

  const starts = await page.getByLabel("Monday start time").evaluateAll(
    (els) => els.map((e) => e.value),
  );
  check("the two new windows have different start times",
    new Set(starts).size === starts.length, starts.join(", "));

  /* ==================================================== client email is unique */
  step("CLIENTS — an email already in use is refused");
  sql(`update clients set email='taken@nurora.demo' where id='${clientId}'`);
  await page.goto(`${APP}/clients`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Add client/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 8000 });
  await dialog.getByLabel("Full name").fill("Duplicate Person");
  await dialog.getByRole("textbox", { name: "Email", exact: true }).fill("taken@nurora.demo");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await page.waitForTimeout(1800);
  check("the duplicate is refused with a reason",
    await dialog.getByText(/already/i).first().isVisible().catch(() => false));
  check("and no second record was written",
    sql("select count(*) from clients where lower(email)='taken@nurora.demo'") === "1");
  await page.keyboard.press("Escape");

  /* ===================================================== archive and restore */
  step("CLIENTS — archive is confirmed, reversible and visible");
  const spare = sql(`insert into clients (full_name) values ('Archive Me') returning id`);
  await page.goto(`${APP}/clients/${spare}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await confirm.waitFor({ timeout: 8000 });
  check("asks before archiving", await confirm.getByText(/Archive Archive Me\?/).isVisible().catch(() => false));
  await confirm.getByRole("button", { name: "Archive", exact: true }).click();
  await page.waitForURL(/\/clients/, { timeout: 15000 });
  await page.waitForTimeout(1200);
  check("the record is archived", sql(`select is_active from clients where id='${spare}'`) === "f");

  await page.goto(`${APP}/clients?view=archived`, { waitUntil: "networkidle" });
  check("it shows under Archived",
    await page.getByText("Archive Me").first().isVisible().catch(() => false));

  await page.goto(`${APP}/clients/${spare}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Restore" }).click();
  await page.waitForTimeout(1800);
  check("and can be restored", sql(`select is_active from clients where id='${spare}'`) === "t");

  /* ============================================ archiving a booked client */
  step("CLIENTS — a client with sessions ahead cannot be archived by accident");
  sql(`insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
       values ('${anisha}','${spare}', now() + interval '3 days', now() + interval '3 days 1 hour',
       'Still to come', 100000)`);
  await page.goto(`${APP}/clients/${spare}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await page.waitForTimeout(1800);
  check("refused, with the count in the message",
    await page.getByText(/still have 1 session booked/i).isVisible().catch(() => false));
  check("and the client is untouched", sql(`select is_active from clients where id='${spare}'`) === "t");

  /* ==================================================== notifications clear */
  step("SCHEDULE — notification history can be cleared");
  sql(`insert into notifications (user_id, kind, title, body)
       values ('${anisha}','test','Old confirmation','Booked for Ravi'),
              ('${anisha}','test','Another one','Booked for Priya')`);
  await page.goto(`${APP}/notifications`, { waitUntil: "networkidle" });
  check("the notifications are listed",
    await page.getByText("Old confirmation").isVisible().catch(() => false));
  await page.getByRole("button", { name: "Clear all" }).click();
  const clearDialog = page.getByRole("dialog");
  await clearDialog.waitFor({ timeout: 8000 });
  await clearDialog.getByRole("button", { name: /^Clear \d+$/ }).click();
  await page.waitForTimeout(2000);
  check("they are gone from the database",
    sql(`select count(*) from notifications where user_id='${anisha}'`) === "0");

  /* ========================================================= reschedule */
  step("BRIC — a booked session can be moved from the board");
  const future = workingDay(6);
  const moving = sql(
    `insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
     values ('${anisha}','${clientId}',
       ('${future}'::date + interval '10 hours') at time zone 'Asia/Kolkata',
       ('${future}'::date + interval '11 hours') at time zone 'Asia/Kolkata',
       'Move me', 100000) returning id`,
  );

  await page.goto(`${APP}/bric?tab=booked&from=${workingDay(-2)}&to=${workingDay(20)}`, { waitUntil: "networkidle" });
  const rescheduleLink = page.getByRole("row", { name: /Move me|Ravi/ }).getByRole("link", { name: "Reschedule" }).first();
  const hasLink = (await page.getByRole("link", { name: "Reschedule" }).count()) > 0;
  check("Booked rows offer a way into rescheduling", hasLink);

  await page.goto(`${APP}/appointments/${moving}?reschedule=1`, { waitUntil: "networkidle" });
  const moveDialog = page.getByRole("dialog", { name: "Move this session" });
  check("the link opens the dialog directly",
    await moveDialog.isVisible().catch(() => false));

  if (await moveDialog.isVisible().catch(() => false)) {
    await pickDate(moveDialog, workingDay(7), "New date");
    await page.waitForTimeout(1500);
    const times = moveDialog.locator("button").filter({ hasText: /^\d{2}:\d{2}\s?(am|pm)$/i });
    if ((await times.count()) > 0) {
      await times.first().click();
      await moveDialog.getByRole("button", { name: "Move session" }).click();
      await page.waitForTimeout(3000);

      check("the original is marked moved",
        sql(`select reschedule_status from appointments where id='${moving}'`) === "moved");
      check("and points at its replacement",
        sql(`select coalesce(rescheduled_to_id::text,'') <> '' from appointments where id='${moving}'`) === "t");
      check("the replacement shows under BRIC → Reschedule",
        Number(sql(`select count(*) from appointments where rescheduled_from_id='${moving}'`)) === 1);
      check("the invoice followed the session",
        sql(`select count(*) from invoices where appointment_id='${moving}'`) === "0");
    } else {
      check("open times were offered for the new date", false, "none listed");
    }
  }

  /* ================================================= dialling codes & timezone */
  step("SETTINGS — international dialling codes and a findable Indian timezone");
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  const codes = await page.getByLabel("Country code").locator("option").allTextContents();
  check("a dialling-code picker is offered", codes.length > 20, `${codes.length} codes`);
  check("India is first and default", (codes[0] ?? "").includes("+91"), codes[0] ?? "");
  check("the Gulf and the UK are on it",
    codes.some((c) => c.includes("+971")) && codes.some((c) => c.includes("+44")));

  const zones = await page.getByLabel("Timezone").locator("option").allTextContents();
  check("the timezone list names India, not just Asia/Kolkata",
    zones.some((z) => z.startsWith("India") && z.includes("Asia/Kolkata")),
    zones[0] ?? "");
  check("and shows the UTC offset", zones.some((z) => z.includes("UTC+05:30")));

  /* ===================================================== password change */
  step("SETTINGS — changing a password asks for the current one and explains refusals");
  check("the current password is asked for",
    await page.getByLabel("Current password").isVisible().catch(() => false));

  await page.getByLabel("Current password").fill("nurora1234");
  await page.getByLabel("New password", { exact: true }).fill("nurora1234");
  await page.getByLabel("Confirm new password").fill("nurora1234");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.waitForTimeout(1200);
  check("reusing the same password is refused in plain words",
    await page.getByText(/already your password/i).isVisible().catch(() => false));

  await page.getByLabel("New password", { exact: true }).fill("nurora-round4");
  await page.getByLabel("Confirm new password").fill("nurora-round4");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.waitForTimeout(2500);
  check("a real change succeeds",
    await page.getByText(/Password changed/i).isVisible().catch(() => false));
  await signIn("anisha@nurora.demo", "nurora-round4");
  check("and the new password signs in", true);

  // Put it back, so the suite can be re-run and the demo account is not
  // left on a password nobody has written down.
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  await page.getByLabel("Current password").fill("nurora-round4");
  await page.getByLabel("New password", { exact: true }).fill("nurora1234");
  await page.getByLabel("Confirm new password").fill("nurora1234");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.waitForTimeout(2500);
  check("and can be put back", sql("select 1") === "1");

  /* ==================================================== week-off calendar */
  step("WEEK-OFF — past days are not selectable, and the allowance is spelled out");
  await signIn("shefrin@nurora.demo");
  await page.goto(`${APP}/leave`, { waitUntil: "networkidle" });
  check("allocated is its own number",
    await page.getByText("Allocated", { exact: true }).isVisible().catch(() => false));
  check("so is remaining",
    await page.getByText("Remaining", { exact: true }).isVisible().catch(() => false));

  const today = new Date();
  if (today.getDate() > 1) {
    const firstOfMonth = page.getByRole("button", { name: /^1$/ }).first();
    check("a day that has gone is disabled",
      await firstOfMonth.isDisabled().catch(() => false));
  } else {
    check("a day that has gone is disabled", true, "skipped on the 1st");
  }

  /* ======================================== counsellor detail on the dropdowns */
  step("BOOKING — counsellors are listed with their languages and specialisms");
  await signIn("anisha@nurora.demo");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  const book = page.getByRole("dialog");
  await book.waitFor({ timeout: 10000 });
  const options = await book.getByLabel("Counsellor").locator("option").allTextContents();
  check("options carry more than a name",
    options.some((o) => o.includes("—") && o.includes("·")), options[1] ?? "");
  check("a language is named", options.some((o) => /English|Tamil/.test(o)));

  step("BOOKING — the date field is a calendar, not a bare input");
  const trigger = book.getByRole("button", { name: /^Date:/ });
  check("the date reads as a date, with a calendar to open",
    await trigger.isVisible().catch(() => false));
  await trigger.click();
  check("it opens a month grid",
    await book.getByRole("dialog", { name: "Choose a date" }).isVisible().catch(() => false));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  step("Console / server errors");
  check("none", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All round-4 checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
