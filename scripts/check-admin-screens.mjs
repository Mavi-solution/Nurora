/**
 * The admin oversight screens from FUNCTIONAL-GUIDE.md §3.
 *   supabase db reset && node scripts/check-admin-screens.mjs
 */
import { chromium } from "playwright";
const APP = "http://localhost:3000";
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
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  await signIn(page, "anisha@nurora.demo");

  step("Every admin screen renders");
  for (const [path, heading] of [
    ["/bric", "BRIC"], ["/persona", "Persona"], ["/attendance", "Attendance"],
    ["/nubills", "Nubills"], ["/reports", "Reports"],
  ]) {
    await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    check(`${path}`, await page.getByRole("heading", { name: heading, level: 1 }).isVisible().catch(() => false));
  }

  step("BRIC has four tabs and separates moved from cancelled");
  await page.goto(`${APP}/bric`, { waitUntil: "networkidle" });
  // Scoped to the tab bar: each Booked row now carries its own
  // "Reschedule" link, which is the way INTO the tab.
  const tabs = page.getByRole("navigation", { name: "BRIC tabs" });
  for (const t of ["Booked", "Reschedule", "Interest", "Cancelled"]) {
    check(`tab ${t}`, await tabs.getByRole("link", { name: t, exact: true }).isVisible().catch(() => false));
  }
  check("admin sees a Phone column",
    await page.getByRole("columnheader", { name: "Phone" }).isVisible().catch(() => false));
  check("export offered", await page.getByRole("button", { name: "Export CSV" }).isVisible());
  await page.goto(`${APP}/bric?tab=cancelled`, { waitUntil: "networkidle" });
  check("cancelled tab explains moved ones are elsewhere",
    await page.getByText(/Moved sessions appear under Reschedule/).isVisible().catch(() => false));

  step("Reports use the five-milestone definition");
  await page.goto(`${APP}/reports`, { waitUntil: "networkidle" });
  check("window covers the whole month, not just up to today",
    await page.getByRole("button", { name: "Apply" }).isVisible().catch(() => false));
  check("says so explicitly",
    await page.getByText(/all five milestones done, not merely/).isVisible().catch(() => false));
  check("per-counsellor table", await page.getByRole("columnheader", { name: "Counsellor" }).isVisible());
  check("revenue column", await page.getByRole("columnheader", { name: "Revenue" }).isVisible());

  step("Persona is searchable and shows completion");
  await page.goto(`${APP}/persona`, { waitUntil: "networkidle" });
  check("search box", await page.getByPlaceholder("Name, phone or email").isVisible());
  // "Persona filled" counted one field out of eight; it now reports the
  // whole intake, and how many first visits are still outstanding.
  check("completion stat", await page.getByText("Complete", { exact: true }).isVisible());
  check("first-visit backlog", await page.getByText("First visit due", { exact: true }).isVisible());

  step("A counsellor sees BRIC without contact details");
  await signIn(page, "shefrin@nurora.demo");
  await page.goto(`${APP}/bric`, { waitUntil: "networkidle" });
  check("BRIC still available", await page.getByRole("heading", { name: "BRIC", level: 1 }).isVisible());
  check("NO phone column for a counsellor",
    (await page.getByRole("columnheader", { name: "Phone" }).count()) === 0);
  check("told contacts are admin-only",
    await page.getByText(/Contact details are admin-only/).isVisible().catch(() => false));

  step("Reports are admin-only");
  await page.goto(`${APP}/reports`, { waitUntil: "networkidle" });
  check("redirected away", !page.url().includes("/reports"), page.url());

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All admin-screen checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
