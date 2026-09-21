/**
 * Round-6 QA findings.
 *
 *   supabase db reset && node scripts/check-qa-round6.mjs
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
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
}

try {
  await signIn("support@nurora.demo");

  /* ================================ the counsellor list follows the filters */
  step("BOOK — choosing a specialism narrows the counsellors offered");
  await page.goto(`${APP}/book`, { waitUntil: "networkidle" });
  await page.getByLabel("Find the caller").fill("9000000001");
  await page.waitForTimeout(1200);
  await page.getByText("Ravi Kumar").first().click();
  await page.getByLabel("Needs help with").waitFor({ timeout: 15000 });

  const counsellorOptions = () =>
    page.getByLabel("Counsellor", { exact: true }).locator("option").allTextContents();

  const everyone = await counsellorOptions();
  check("all counsellors listed to begin with", everyone.length >= 5, String(everyone.length));

  // Grief & loss is seeded against fewer counsellors than Anxiety.
  const narrowSpecialism = sql(
    "select s.name from specialisms s join counsellor_specialisms cs on cs.specialism_id=s.id" +
    " group by s.name having count(*) = 1 limit 1",
  );
  check("a single-counsellor specialism exists to test with",
    narrowSpecialism.length > 0, narrowSpecialism);

  await page.getByLabel("Needs help with").selectOption({ label: narrowSpecialism });
  await page.waitForTimeout(1200);
  const narrowed = await counsellorOptions();
  check(`"${narrowSpecialism}" narrows the list`,
    narrowed.length < everyone.length, `${everyone.length} -> ${narrowed.length}`);

  const whoTreatsIt = sql(
    `select p.full_name from profiles p
       join counsellor_specialisms cs on cs.counsellor_id = p.id
       join specialisms s on s.id = cs.specialism_id
      where s.name = '${narrowSpecialism}' and p.is_active`,
  );
  check("and lists the counsellor who actually treats it",
    narrowed.some((o) => o.startsWith(whoTreatsIt)), `${narrowed.join(" | ")} vs ${whoTreatsIt}`);
  check("everyone else is gone",
    !narrowed.some((o) => o.includes("—") && !o.startsWith(whoTreatsIt)),
    narrowed.join(" | "));

  // A counsellor already chosen must let go when the filter excludes them.
  await page.getByLabel("Needs help with").selectOption("");
  await page.waitForTimeout(800);
  const other = (await counsellorOptions()).find(
    (o) => o.includes("—") && !o.startsWith(whoTreatsIt),
  );
  await page.getByLabel("Counsellor", { exact: true }).selectOption({ label: other });
  await page.getByLabel("Needs help with").selectOption({ label: narrowSpecialism });
  await page.waitForTimeout(1200);
  check("a counsellor the filter rules out is deselected",
    (await page.getByLabel("Counsellor", { exact: true }).inputValue()) === "");

  /* ==================================== the confirmation page states details */
  step("BOOK — the confirmation page shows contact details and age");
  await page.getByLabel("Needs help with").selectOption("");
  await page.waitForTimeout(1500);
  const slots = page.locator("button").filter({ hasText: /^\d{2}:\d{2}$/ });
  await slots.first().waitFor({ timeout: 20000 });
  await slots.first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("How did this booking come in?").waitFor({ timeout: 10000 });

  const summary = await page.locator("main").innerText();
  const client = sql("select coalesce(phone,'')||'|'||coalesce(email,'')||'|'||coalesce(age::text,'') from clients where full_name='Ravi Kumar'");
  const [phone, email, age] = client.split("|");
  check("phone is shown", summary.includes(phone), phone);
  check("email is shown", summary.includes(email), email);
  check("age is shown", new RegExp(`Age\\s*\\n?\\s*${age}`).test(summary), age);

  /* ================================= the new-appointment dialog has no status */
  step("SCHEDULE — New appointment no longer offers a session status");
  await signIn("anisha@nurora.demo");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quick book" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 10000 });
  check("no Status field", (await dialog.getByLabel("Status", { exact: true }).count()) === 0);
  for (const gone of ["In session", "Completed", "No-show"]) {
    check(`"${gone}" is not offered at booking time`,
      (await dialog.getByRole("option", { name: gone }).count()) === 0);
  }
  check("Booking status (Interest / Booked) is untouched",
    await dialog.getByRole("button", { name: "Interest", exact: true }).isVisible());
  await page.keyboard.press("Escape");

  /* ================================================== the Persona intake form */
  step("PERSONA — a first visit asks for the once-only details");
  const clientId = sql("select id from clients where full_name='Ravi Kumar'");
  sql(`update clients set address=null, area=null, education=null, occupation=null,
       background=null, referral_source=null, intake_completed_at=null where id='${clientId}'`);

  await page.goto(`${APP}/clients/${clientId}`, { waitUntil: "networkidle" });
  check("the client record carries a Persona card",
    await page.getByRole("heading", { name: "Persona" }).isVisible().catch(() => false));
  check("it is flagged as a first visit",
    await page.getByText("First visit — details to take").isVisible().catch(() => false));
  check("and the once-only fields are asked for",
    await page.getByLabel("Occupation").isVisible().catch(() => false));

  await page.getByLabel("Background").fill("Lives with parents. No previous therapy.");
  await page.getByLabel("What they are seeking help with").fill("Work stress, poor sleep.");
  await page.getByLabel("How did they find the clinic?").selectOption("Friend or family");
  await page.getByLabel("Address").fill("12 Main Street");
  await page.getByLabel("Area").fill("Adyar");
  await page.getByLabel("Education").fill("B.Com");
  await page.getByLabel("Occupation").fill("Accountant");
  await page.getByRole("button", { name: "Save Persona" }).click();
  await page.waitForTimeout(2500);

  const saved = sql(
    `select coalesce(background,'')||'|'||coalesce(referral_source,'')||'|'||coalesce(area,'')||'|'||coalesce(occupation,'')||'|'||(intake_completed_at is not null) from clients where id='${clientId}'`,
  );
  const [bg, via, area, job, stamped] = saved.split("|");
  check("background saved", bg.startsWith("Lives with parents"), bg);
  check("how they found us saved", via === "Friend or family", via);
  check("area saved", area === "Adyar", area);
  check("occupation saved", job === "Accountant", job);
  check("the intake is stamped as taken", stamped === "true", stamped);

  step("PERSONA — a follow-up skips straight past them");
  await page.reload({ waitUntil: "networkidle" });
  check("no longer a first visit",
    await page.getByText("Details on file").isVisible().catch(() => false));
  check("the once-only fields are skipped",
    (await page.getByLabel("Occupation").count()) === 0 ||
    !(await page.getByLabel("Occupation").isVisible().catch(() => false)));
  check("but the concern is still asked",
    await page.getByLabel("What they are seeking help with").isVisible().catch(() => false));

  // ...and they stay reachable, because people move house.
  await page.getByRole("button", { name: "Update" }).first().click();
  await page.waitForTimeout(400);
  check("they can still be corrected on request",
    await page.getByLabel("Occupation").isVisible().catch(() => false));

  step("PERSONA — the screen reports the whole intake, not one field");
  await page.goto(`${APP}/persona`, { waitUntil: "networkidle" });
  check("the list renders",
    await page.getByRole("heading", { name: "Persona", level: 1 }).isVisible());
  check("it counts first visits still due",
    await page.getByText("First visit due").isVisible().catch(() => false));
  check("and shows the once-only facts it holds",
    await page.getByText(/Adyar/).first().isVisible().catch(() => false));

  step("PERSONA — the session milestone uses the same form");
  const appt = sql(
    `insert into appointments (counsellor_id, client_id, starts_at, ends_at, title, price_cents)
     select p.id, '${clientId}', now() + interval '2 hours', now() + interval '3 hours',
            'Persona milestone', 100000
       from profiles p where p.email='anisha@nurora.demo' returning id`,
  );
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const personaStep = page.getByRole("button", { name: /Fill the Persona/ }).first();
  if (await personaStep.count()) {
    await personaStep.click();
    const d = page.getByRole("dialog", { name: "Fill the Persona" });
    await d.waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
    check("it opens on what is already on file",
      (await d.getByLabel("What they are seeking help with").inputValue()).includes("Work stress"));
    check("and skips the details already taken",
      await d.getByText("Details on file").isVisible().catch(() => false));
    await page.keyboard.press("Escape");
  } else {
    check("it opens on what is already on file", false, "no Persona step found");
    check("and skips the details already taken", false, "no Persona step found");
  }
  sql(`delete from appointments where id='${appt}'`);

  step("Console / server errors");
  check("none", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All round-6 checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
