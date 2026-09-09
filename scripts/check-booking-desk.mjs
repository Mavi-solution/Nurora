/**
 * The booking desk, driven as a support user would drive it on a call.
 *
 * Covers the whole path: caller lookup, capturing a brand-new client,
 * matching a counsellor by specialism and language, taking a slot, and
 * confirming — then checks what actually landed in the database.
 *
 *   npm run test:desk
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP = "http://localhost:3000";
const SUPPORT = { email: "support@nurora.demo", password: "nurora1234" };
const COUNSELLOR = { email: "anisha@nurora.demo", password: "nurora1234" };

const psql = (sql) =>
  execSync(
    `docker exec -i supabase_db_Nurora psql -U postgres -d postgres -t -A -c "${sql}"`,
    { encoding: "utf8" },
  ).trim();

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function signIn(page, who) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const caller = `Desk Caller ${Date.now()}`;
const callerPhone = `+9198${Math.floor(10000000 + Math.random() * 89999999)}`;

try {
  step("Support signs in");
  await signIn(page, SUPPORT);
  check("reached the app", !page.url().includes("/login"), page.url());

  step("Support sees the desk, not clinical tools");
  check("Book a session in nav", await page.getByRole("link", { name: "Book a session" }).isVisible());
  check("Counsellors in nav", await page.getByRole("link", { name: "Counsellors" }).isVisible());
  check("no Timesheet for reception", (await page.getByRole("link", { name: "Timesheet" }).count()) === 0);

  step("Reception cannot start a session");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const startButtons = page.getByRole("button", { name: "Start", exact: true });
  const startCount = await startButtons.count();
  let allDisabled = true;
  for (let i = 0; i < startCount; i += 1) {
    if (await startButtons.nth(i).isEnabled()) allDisabled = false;
  }
  check("Start buttons are disabled for reception", allDisabled, `${startCount} buttons`);
  await page.screenshot({ path: "screenshots/12-support-schedule.png", fullPage: true });

  step("Open the booking desk");
  await page.goto(`${APP}/book`, { waitUntil: "networkidle" });
  check("caller search present", await page.getByLabel("Find the caller").isVisible());

  step("Look up a repeat caller by phone");
  await page.getByLabel("Find the caller").fill("9000000001");
  await page.waitForTimeout(900);
  check("finds Ravi Kumar by phone digits", await page.getByText("Ravi Kumar").first().isVisible());

  step("New caller instead");
  await page.getByLabel("Find the caller").fill(caller);
  await page.waitForTimeout(900);
  check("offers to add a new client", await page.getByText(/No existing record matches/i).isVisible());
  await page.getByRole("button", { name: "New client" }).click();
  check("new-client form opens", await page.getByLabel("Full name", { exact: true }).isVisible());

  await page.getByLabel("Full name", { exact: true }).fill(caller);
  await page.getByLabel("Phone", { exact: true }).fill(callerPhone);
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.getByLabel("Preferred language").selectOption("Tamil");
  await page
    .getByLabel("What do they need help with?")
    .fill("Constant worry about work, not sleeping well.");
  await page.screenshot({ path: "screenshots/13-desk-new-client.png", fullPage: true });
  await page.getByRole("button", { name: /Save and continue/i }).click();

  step("Match a counsellor");
  await page.getByLabel("Needs help with").waitFor({ timeout: 15000 });
  check("moved to the matching step", await page.getByLabel("Needs help with").isVisible());
  check(
    "language carried over from the client record",
    (await page.getByLabel("Language").inputValue()) === "Tamil",
  );

  await page.getByLabel("Needs help with").selectOption({ label: "Anxiety" });
  await page.waitForTimeout(1500);

  // Anisha and Saranya both do Anxiety; only some also speak Tamil.
  const laneNames = await page.locator(".text-\\[14px\\].font-medium").allTextContents();
  check("at least one counsellor matched", laneNames.length > 0, laneNames.join(","));

  const slotButtons = page.locator("button").filter({ hasText: /^\d{2}:\d{2}$/ });
  const slotCount = await slotButtons.count();
  check("slots offered", slotCount > 0, `${slotCount} slots`);
  await page.screenshot({ path: "screenshots/14-desk-match.png", fullPage: true });

  await slotButtons.first().click();
  await page.getByRole("button", { name: "Continue" }).click();

  step("Confirm the booking");
  await page.getByText("How did this booking come in?").waitFor({ timeout: 10000 });
  check("summary shows the caller", await page.getByText(caller).first().isVisible());
  check("reminder promise shown", await page.getByText(/reminder\s+three days before/i).isVisible());
  await page.getByLabel("Notes from the call").fill("Asked for an early slot if possible.");
  await page.screenshot({ path: "screenshots/15-desk-confirm.png", fullPage: true });
  await page.getByRole("button", { name: /Confirm booking/i }).click();

  await page.waitForURL(/\/appointments\//, { timeout: 20000 });
  check("landed on the new appointment", page.url().includes("/appointments/"));

  step("What reached the database");
  const row = psql(
    `select a.channel || '|' || coalesce(a.booking_notes,'') || '|' || p.full_name || '|' || c.preferred_language || '|' || c.age
       from appointments a
       join clients c on c.id = a.client_id
       join profiles p on p.id = a.counsellor_id
      where c.full_name = '${caller}';`,
  );
  const [channel, notes, counsellorName, language, age] = row.split("|");
  check("booked through the phone channel", channel === "phone", channel);
  check("call notes stored", notes.startsWith("Asked for an early"), notes);
  check("assigned to a real counsellor", counsellorName.length > 0, counsellorName);
  check("client language captured", language === "Tamil", language);
  check("client age captured", age === "34", age);
  check(
    "counsellor actually treats anxiety",
    psql(
      `select count(*) from counsellor_specialisms cs
         join specialisms s on s.id = cs.specialism_id
         join profiles p on p.id = cs.counsellor_id
        where p.full_name = '${counsellorName}' and s.slug = 'anxiety';`,
    ) === "1",
    counsellorName,
  );
  check(
    "invoice raised with the booking",
    psql(
      `select count(*) from invoices i join clients c on c.id = i.client_id
        where c.full_name = '${caller}';`,
    ) === "1",
  );
  check("booked_by recorded as the desk user", psql(
    `select p.role from appointments a
       join profiles p on p.id = a.booked_by
       join clients c on c.id = a.client_id
      where c.full_name = '${caller}';`,
  ) === "support");

  step("Reception cannot read clinical notes in the UI");
  // waitForURL resolves on navigation, before the page has finished
  // rendering — wait for real content before asserting on absence.
  await page.getByRole("heading", { name: caller }).waitFor({ timeout: 15000 });
  await page.getByText("From the booking").waitFor({ timeout: 15000 });
  check(
    "no Session notes card for support",
    (await page.getByText("Session notes").count()) === 0,
  );
  check(
    "booking notes ARE visible to support",
    await page.getByText("Asked for an early slot if possible.").isVisible(),
  );

  step("The counsellor sees their own clinical notes");
  await page.context().clearCookies();
  const apptUrl = page.url();
  await signIn(page, COUNSELLOR);
  await page.goto(apptUrl, { waitUntil: "networkidle" });
  check("Session notes card present for the counsellor", await page.getByText("Session notes").isVisible());

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\nFAILED: ${err.message}`);
  await page.screenshot({ path: "screenshots/desk-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "Booking desk verified." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
