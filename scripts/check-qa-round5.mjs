/**
 * Round-5 QA findings — mostly a re-test of round 4.
 *
 * The important one is "can't enter mobile number", reported against
 * four screens. Every round-4 browser check used fill(), which sets a
 * value in one shot and measures nothing about whether a person could
 * have done it: the dialling-code select had taken the whole row and
 * left the number box thirty pixels wide. So the checks here TYPE, and
 * they assert the box is big enough to type into.
 *
 *   supabase db reset && node scripts/check-qa-round5.mjs
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

/** A control nobody could use is a broken control, however it reports. */
const USABLE_PX = 120;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

async function signIn(email, password = "nurora1234") {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
}

const widthOf = async (locator) =>
  Math.round((await locator.boundingBox())?.width ?? 0);

/** Type into a phone box the way a person does, then leave it. */
async function typePhone(scope, label, text, away) {
  const box = scope.getByRole("textbox", { name: label, exact: true });
  await box.fill("");
  await box.click();
  await box.pressSequentially(text, { delay: 25 });
  const whileTyping = await box.inputValue();
  await away.click();
  await page.waitForTimeout(200);
  return { whileTyping, settled: await box.inputValue(), width: await widthOf(box) };
}

try {
  await signIn("anisha@nurora.demo");

  /* ============================================ the number box is usable */
  step("Every phone field is big enough to type into");
  const screens = [
    { name: "Settings", url: "/settings", label: "Phone" },
  ];
  for (const s of screens) {
    await page.goto(`${APP}${s.url}`, { waitUntil: "networkidle" });
    const w = await widthOf(page.getByRole("textbox", { name: s.label, exact: true }));
    check(`${s.name}: number box is ${w}px`, w >= USABLE_PX, `${w}px`);
  }

  // The dialogs, where the field sits in a two-column grid.
  await page.goto(`${APP}/clients`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Add client/i }).click();
  const addClient = page.getByRole("dialog");
  await addClient.waitFor({ timeout: 8000 });
  const clientW = await widthOf(addClient.getByRole("textbox", { name: "Phone", exact: true }));
  check(`Add client: number box is ${clientW}px`, clientW >= USABLE_PX, `${clientW}px`);
  await page.keyboard.press("Escape");

  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  const quick = page.getByRole("dialog");
  await quick.waitFor({ timeout: 10000 });
  const waW = await widthOf(quick.getByRole("textbox", { name: "WhatsApp number", exact: true }));
  check(`Quick book: WhatsApp box is ${waW}px`, waW >= USABLE_PX, `${waW}px`);

  /* ========================================== typing, one character at a time */
  step("A number typed one character at a time arrives intact");
  const age = quick.getByRole("spinbutton", { name: "Age" });
  await age.click();
  await age.pressSequentially("29", { delay: 60 });
  check("age accepts typed digits", (await age.inputValue()) === "29", await age.inputValue());
  check("age box is usable", (await widthOf(age)) >= 80, `${await widthOf(age)}px`);

  const name = quick.getByRole("textbox", { name: "Client name" });
  const typed = await typePhone(quick, "WhatsApp number", "9840011223", name);
  check("what you type is what you see", typed.whileTyping === "9840011223", typed.whileTyping);
  check("and it survives leaving the field", typed.settled === "9840011223", typed.settled);
  await page.keyboard.press("Escape");

  /* =============================================== country codes and pasting */
  step("A number that carries its own country code is understood");
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  const fullName = page.getByRole("textbox", { name: "Full name" });
  const codeSelect = page.getByLabel("Country code");

  // The field must never rewrite what is on screen mid-word — that is
  // what made it feel like the number "could not be entered".
  const india = await typePhone(page, "Phone", "+919840011223", fullName);
  check("nothing is rewritten while typing",
    india.whileTyping === "+919840011223", india.whileTyping);
  check("the + and country code are absorbed on blur",
    india.settled === "9840011223", india.settled);
  check("the code stays India", (await codeSelect.inputValue()) === "91");

  const dubai = await typePhone(page, "Phone", "+971 50 123 4567", fullName);
  check("a Gulf number moves the country to +971",
    (await codeSelect.inputValue()) === "971", `+${await codeSelect.inputValue()}`);
  check("and keeps its national part", dubai.settled === "501234567", dubai.settled);

  // Back to India, then the trap: a real Indian mobile beginning "91".
  await codeSelect.selectOption("91");
  const local = await typePhone(page, "Phone", "9123456789", fullName);
  check("a local number starting 91 keeps all ten digits",
    local.settled === "9123456789", local.settled);

  const doubled = await typePhone(page, "Phone", "919840011223", fullName);
  check("but the code typed twice is de-duplicated",
    doubled.settled === "9840011223", doubled.settled);

  // And it actually saves.
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForTimeout(2500);
  check("the number is stored in E.164",
    sql("select phone from profiles where email='anisha@nurora.demo'") === "+919840011223",
    sql("select phone from profiles where email='anisha@nurora.demo'"));

  /* ================================================== notifications clear */
  step("Clearing notifications actually empties them");
  const me = sql("select id from profiles where email='anisha@nurora.demo'");
  sql(`insert into notifications (user_id, kind, title, body)
       values ('${me}','test','Confirmation one','Booked for Ravi'),
              ('${me}','test','Confirmation two','Booked for Priya')`);
  await page.goto(`${APP}/notifications`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Clear all" }).click();
  const clearDialog = page.getByRole("dialog");
  await clearDialog.waitFor({ timeout: 8000 });
  await clearDialog.getByRole("button", { name: /^Clear \d+$/ }).click();
  await page.waitForTimeout(2000);
  check("gone from the database",
    sql(`select count(*) from notifications where user_id='${me}'`) === "0");
  check("and gone from the page",
    (await page.getByText("Confirmation one").count()) === 0);

  /* ============================================= availability closed days */
  step("A closed weekday offers no '+ Add window'");
  sql("update clinic_settings set open_weekdays = array[1,2,3,4,5,6]::smallint[] where id=true");
  await page.waitForTimeout(400);
  await page.goto(`${APP}/availability?counsellor=${me}`, { waitUntil: "networkidle" });
  check("Sunday reads as clinic-closed",
    await page.getByText("Clinic closed").first().isVisible().catch(() => false));
  check("six '+ Add window' buttons, not seven",
    (await page.getByRole("button", { name: "+ Add window" }).count()) === 6,
    String(await page.getByRole("button", { name: "+ Add window" }).count()));

  /* ================================================ week-off past days */
  step("Past days are not selectable, for an admin either");
  // An admin lands on the whole practice now; these checks are about
  // the per-person calendar, so ask for it by name. The overview has
  // its own suite — check-leave-admin.mjs.
  await page.goto(`${APP}/leave?staff=${me}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const today = new Date();
  if (today.getDate() > 1) {
    const first = page.getByRole("button", { name: /^1$/ }).first();
    check("an admin sees past days disabled by default",
      await first.isDisabled().catch(() => false));
    // ...but can deliberately opt in to correct the record.
    await page.getByLabel("Allow past days").check();
    await page.waitForTimeout(400);
    check("and can opt in to correct a past month",
      !(await first.isDisabled().catch(() => true)));
  } else {
    check("an admin sees past days disabled by default", true, "skipped on the 1st");
    check("and can opt in to correct a past month", true, "skipped on the 1st");
  }
  check("allocated, taken and remaining are three separate numbers",
    (await page.getByText("Allocated", { exact: true }).count()) === 1 &&
    (await page.getByText("Taken", { exact: true }).count()) === 1 &&
    (await page.getByText("Remaining", { exact: true }).count()) === 1);

  /* ============================================ counsellor preferred language */
  step("A counsellor has a preferred language, distinct from what they speak");
  const shefrin = sql("select id from profiles where email='shefrin@nurora.demo'");
  await page.goto(`${APP}/counsellors/${shefrin}`, { waitUntil: "networkidle" });

  for (const l of ["English", "Tamil"]) {
    const chip = page.getByRole("button", { name: l, exact: true });
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
  }
  await page.waitForTimeout(300);
  const preferred = page.getByLabel("Preferred language");
  check("the picker appears once more than one language is set",
    await preferred.isVisible().catch(() => false));
  await preferred.selectOption("Tamil");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForTimeout(2500);
  check("it is stored",
    sql(`select coalesce(preferred_language,'') from profiles where id='${shefrin}'`) === "Tamil",
    sql(`select coalesce(preferred_language,'') from profiles where id='${shefrin}'`));

  // Dropping the preferred language must not leave a dangling preference.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tamil", exact: true }).click();
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForTimeout(2500);
  const settled = sql(`select coalesce(preferred_language,'') from profiles where id='${shefrin}'`);
  check("dropping it falls back rather than dangling",
    settled !== "Tamil" && settled !== "", settled);

  step("The desk sees the preferred language first");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  const d2 = page.getByRole("dialog");
  await d2.waitFor({ timeout: 10000 });
  const opts = await d2.getByLabel("Counsellor").locator("option").allTextContents();
  check("counsellor options still describe languages and specialisms",
    opts.some((o) => o.includes("—") && o.includes("·")), opts[1] ?? "");
  await page.keyboard.press("Escape");

  /* ================================================== migration awareness */
  step("The app says so when the database is behind");
  const health = await (await fetch(`${APP}/api/health`)).json();
  check("health reports pending migrations",
    Array.isArray(health.migrationsPending), JSON.stringify(health.migrationsPending));
  check("and this database is up to date",
    health.migrationsPending.length === 0, JSON.stringify(health.migrationsPending));
  check("so no banner is shown",
    (await page.getByText("This database is behind the app").count()) === 0);

  step("Console / server errors");
  check("none", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All round-5 checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
