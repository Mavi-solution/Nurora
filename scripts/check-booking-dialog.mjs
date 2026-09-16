/**
 * The booking dialog end to end: services from the catalogue, an
 * Interest that holds NO slot, a Booked appointment that does, tags,
 * attachments, and admin CRUD over the price list.
 *
 *   supabase db reset && node scripts/check-booking-dialog.mjs
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

async function signIn(page, email) {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("nurora1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
}

/**
 * A date a few days out that the clinic actually works.
 *
 * "+N days" alone is flaky: it lands on a Sunday one week in four, the
 * clinic has no Sunday availability, and the test then fails for a
 * reason unrelated to what it is checking.
 *
 * Everything here is UTC on purpose. Mixing getDay() (local) with
 * toISOString() (UTC) was the first attempt, and it disagreed with
 * itself in the evening: 8pm EDT is already the next day in UTC, so the
 * weekday checked was not the weekday of the string returned.
 */
function nextWorkingDay(fromDays = 3) {
  const d = new Date(Date.now() + fromDays * 86400000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

const future = nextWorkingDay(4);

async function openDialog() {
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15000 });
  return page.getByRole("dialog");
}

try {
  await signIn(page, "anisha@nurora.demo");

  /* ------------------------------------------- the catalogue is offered */
  step("The dialog offers the clinic price list");
  let d = await openDialog();
  check("dialog opens as New appointment",
    await d.getByText("New appointment").first().isVisible());

  const options = await d.locator("select").nth(0).locator("option").allTextContents();
  const serviceSel = d.getByLabel("Service / Category");
  const serviceOptions = await serviceSel.locator("option").allTextContents();
  check("all 20 services listed", serviceOptions.filter((o) => o.includes("₹")).length === 20,
    `${serviceOptions.filter((o) => o.includes("₹")).length}`);
  check("prices shown against each",
    serviceOptions.some((o) => o.includes("Child Therapy — ₹2,000")),
    serviceOptions.slice(1, 3).join(" | "));
  check("grouped by category",
    (await serviceSel.locator("optgroup").count()) >= 6,
    `${await serviceSel.locator("optgroup").count()} groups`);

  check("mode buttons present",
    await d.getByRole("button", { name: "Offline - Walk-in" }).isVisible());
  check("tags present",
    await d.getByRole("button", { name: /Counselling \(CO\)/ }).isVisible());
  check("attachment options present",
    await d.getByRole("button", { name: "Voice note" }).isVisible());

  /* --------------------------------------- an interest holds no slot */
  step("Saving as an Interest holds no slot");
  await d.getByRole("button", { name: "Interest", exact: true }).click();
  check("title switches to New interest",
    await d.getByText("New interest").first().isVisible());
  check("helper explains no slot is held",
    await d.getByText(/won't hold the slot/).isVisible());
  check("no time picker on an interest",
    (await d.getByText("Choose a service and counsellor to see open times.").count()) === 0 &&
    (await d.locator("text=Time").count()) === 0);

  await d.getByLabel("Client name").fill("Priya Interest");
  await d.getByLabel("Gender").selectOption("Female");
  await d.getByLabel("Age").fill("29");
  await serviceSel.selectOption({ label: "Child Therapy — ₹2,000" });
  await d.getByLabel("Counsellor").selectOption({ index: 1 });
  await d.getByLabel("Date").fill(future);
  await d.getByRole("button", { name: "Online", exact: true }).click();
  await d.getByLabel("WhatsApp number").fill("98400 11223");
  await d.getByRole("button", { name: /Counselling \(CO\)/ }).click();
  await d.getByRole("button", { name: /Child \(Ch\)/ }).click();
  await d.getByRole("button", { name: "Note", exact: true }).click();
  await d.getByPlaceholder("Type the note…").fill("Prefers early evening.");
  await d.getByRole("button", { name: "Save as Interest" }).click();
  await page.waitForTimeout(2500);

  check("confirmation says no slot held",
    await page.getByText(/no slot is held/).isVisible().catch(() => false));

  const row = sql(`select full_name||'|'||coalesce(gender,'')||'|'||coalesce(age::text,'')||'|'||coalesce(whatsapp,'')||'|'||mode||'|'||array_length(tag_ids,1)||'|'||attachment||'|'||coalesce(attachment_note,'')||'|'||status from interests where full_name='Priya Interest'`);
  console.log(`        row: ${row}`);
  const [nm, gd, ag, wa, md, tg, at, note, st] = row.split("|");
  check("saved to the interests table", nm === "Priya Interest");
  check("gender saved", gd === "Female");
  check("age saved", ag === "29");
  check("WhatsApp normalised to E.164", wa === "+919840011223", wa);
  check("mode saved", md === "online");
  check("both tags saved", tg === "2", tg);
  check("attachment kind saved", at === "note");
  check("attachment note saved", note === "Prefers early evening.");
  check("status is scheduled", st === "scheduled");
  check("attachment expires in 30 days",
    sql(`select (attachment_expires_at::date - current_date) from interests where full_name='Priya Interest'`) === "30");
  check("NO appointment was created", sql(`select count(*) from appointments where title='Child Therapy'`) === "0");
  check("price came from the catalogue, not the browser",
    sql(`select s.price_cents from interests i join services s on s.id=i.service_id where i.full_name='Priya Interest'`) === "200000");

  /* ------------------------------------------- a booking holds a slot */
  step("Saving as Booked creates the appointment and locks the slot");
  d = await openDialog();
  await d.getByLabel("Client name").fill("Ravi Booked");
  await serviceSel.selectOption({ label: "Couple Therapy — ₹3,000" });
  await d.getByLabel("Counsellor").selectOption({ index: 1 });
  await d.getByLabel("Date").fill(future);
  await d.getByRole("button", { name: "Offline - Walk-in" }).click();
  await d.getByLabel("WhatsApp number").fill("9000000123");
  await page.waitForTimeout(1500);

  const slot = d.locator("div.grid.grid-cols-4 button").first();
  await slot.waitFor({ state: "visible", timeout: 15000 });
  await slot.click();
  await d.getByLabel("Advance received").check();
  await d.getByRole("button", { name: "Book appointment" }).click();
  await page.waitForTimeout(3000);

  check("confirmation shown",
    await page.getByText("Appointment booked.").isVisible().catch(() => false));

  const appt = sql(`select title||'|'||price_cents||'|'||mode||'|'||client_type||'|'||advance_cents||'|'||(advance_paid_at is not null)||'|'||status from appointments where title='Couple Therapy'`);
  console.log(`        appt: ${appt}`);
  const [t, price, amode, ctype, adv, advPaid, astatus] = appt.split("|");
  check("appointment created from the service", t === "Couple Therapy");
  check("price taken from the catalogue", price === "300000", price);
  check("mode saved", amode === "offline_walk_in");
  check("client type saved", ctype === "new");
  check("walk-in demands the full advance", adv === "300000", adv);
  check("advance marked paid", advPaid === "true", advPaid);
  check("status scheduled", astatus === "scheduled");
  check("a client record was created", sql(`select count(*) from clients where full_name='Ravi Booked'`) === "1");
  check("WhatsApp stored on the client", sql(`select phone from clients where full_name='Ravi Booked'`) === "+919000000123");
  check("an invoice was raised", sql(`select amount_cents from invoices i join appointments a on a.id=i.appointment_id where a.title='Couple Therapy'`) === "300000");
  check("a WhatsApp confirmation was attempted",
    Number(sql(`select count(*) from notification_deliveries where kind='appointment_booked' and channel='whatsapp'`)) > 0);

  /* ----------------------------------- interests list + convert flow */
  step("Interest & Booked list, and booking one in");
  await page.goto(`${APP}/interests`, { waitUntil: "networkidle" });
  check("lead is listed", await page.getByText("Priya Interest").isVisible());
  check("its tags render", await page.getByText(/Counselling \(CO\)/).first().isVisible());
  check("explains nothing holds a slot", await page.getByText(/none of these hold a slot/i).isVisible());

  await page.getByRole("button", { name: "Book it in" }).first().click();
  await page.waitForTimeout(600);
  await page.getByLabel("Date and time").fill(`${future}T15:00`);
  await page.getByRole("button", { name: "Book appointment" }).click();
  await page.waitForTimeout(3000);

  check("interest is marked converted",
    sql(`select status from interests where full_name='Priya Interest'`) === "converted");
  check("it links to the appointment it became",
    sql(`select (converted_appointment_id is not null) from interests where full_name='Priya Interest'`) === "t");
  check("the appointment now exists",
    sql(`select count(*) from appointments where title='Child Therapy'`) === "1");
  check("tags carried over to the appointment",
    sql(`select array_length(tag_ids,1) from appointments where title='Child Therapy'`) === "2");

  /* ------------------------------------------------ admin CRUD */
  step("Admin CRUD over services");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  check("price list page renders",
    await page.getByRole("heading", { name: "Services & pricing", level: 1 }).isVisible());
  check("all 20 seeded services shown",
    (await page.locator("tbody tr").count()) === 20,
    `${await page.locator("tbody tr").count()} rows`);

  await page.getByRole("button", { name: "Add service" }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("Name").fill("Group Therapy – Pilot");
  await page.getByLabel("Category").fill("General");
  await page.getByLabel("Price (₹)").fill("1500");
  await page.getByLabel("Minutes").fill("90");
  await page.getByRole("button", { name: "Add service" }).last().click();
  await page.waitForTimeout(2000);
  check("service created",
    sql(`select price_cents||'|'||duration_minutes from services where name='Group Therapy – Pilot'`) === "150000|90");

  await page.getByRole("row", { name: /Group Therapy – Pilot/ }).getByRole("button", { name: "Edit" }).click();
  await page.waitForTimeout(400);
  await page.getByLabel("Price (₹)").fill("1800");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(2000);
  check("service updated",
    sql(`select price_cents from services where name='Group Therapy – Pilot'`) === "180000");

  await page.getByRole("row", { name: /Group Therapy – Pilot/ }).getByRole("button", { name: "Retire" }).click();
  await page.waitForTimeout(2000);
  check("service retired",
    sql(`select is_active from services where name='Group Therapy – Pilot'`) === "f");

  await page.getByRole("row", { name: /Group Therapy – Pilot/ }).getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await page.waitForTimeout(2000);
  check("unused service deleted outright",
    sql(`select count(*) from services where name='Group Therapy – Pilot'`) === "0");

  step("A service in use is retired, never deleted");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  await page.getByRole("row", { name: /Couple Therapy —|Couple Therapy\s/ }).first()
    .getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await page.waitForTimeout(2000);
  check("still exists, retired instead",
    sql(`select is_active from services where name='Couple Therapy'`) === "f");
  check("the historical appointment kept its service",
    sql(`select (service_id is not null) from appointments where title='Couple Therapy'`) === "t");

  step("A non-admin cannot reach the price list");
  await signIn(page, "shefrin@nurora.demo");
  await page.goto(`${APP}/services`, { waitUntil: "networkidle" });
  check("redirected away from /services", !page.url().includes("/services"), page.url());

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All booking-dialog checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
