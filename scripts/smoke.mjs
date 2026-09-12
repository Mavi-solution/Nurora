/**
 * Quick local smoke test: signs in as each role and confirms the screens
 * they should see actually render.
 *
 *   node scripts/smoke.mjs
 */
import { chromium } from "playwright";

const APP = "http://localhost:3000";
let failures = 0;
const check = (n, ok, d = "") => {
  if (ok) console.log(`  ok    ${n}`);
  else { failures += 1; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ""}`); }
};

async function signIn(page, email, password) {
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => {
  if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
});

try {
  console.log("\n▸ Public pages");
  for (const [path, marker] of [["/", "is about to happen."], ["/login", "Welcome back"], ["/signup", "Create your account"]]) {
    await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    check(`${path}`, await page.getByText(marker).first().isVisible());
  }

  console.log("\n▸ Counsellor + admin (anisha@nurora.demo)");
  await signIn(page, "anisha@nurora.demo", "nurora1234");
  for (const [path, heading] of [
    ["/schedule", null],
    ["/book", "Book a session"],
    ["/clients", "Clients"],
    ["/counsellors", "Counsellors"],
    ["/availability", "Availability"],
    ["/payments", "Payments"],
    ["/timesheet", "Timesheet"],
    ["/team", "Team"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    const ok = heading
      ? await page.getByRole("heading", { name: heading, level: 1 }).isVisible().catch(() => false)
      : (await page.locator("p.font-semibold").count()) > 0;
    check(`${path}`, ok);
  }
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const lanes = await page.locator("p.font-semibold").allTextContents();
  check("5 counsellor lanes", lanes.length === 5, lanes.join(", "));
  check("today's bookings visible", await page.getByRole("link", { name: "Ravi Kumar" }).first().isVisible());
  await page.screenshot({ path: "screenshots/local-schedule.png", fullPage: true });

  console.log("\n▸ Support desk (support@nurora.demo)");
  await signIn(page, "support@nurora.demo", "nurora1234");
  await page.goto(`${APP}/book`, { waitUntil: "networkidle" });
  check("booking desk opens", await page.getByLabel("Find the caller").isVisible());
  await page.getByLabel("Find the caller").fill("9000000001");
  await page.waitForTimeout(900);
  check("caller lookup by phone works", await page.getByText("Ravi Kumar").first().isVisible());
  check("no Timesheet for reception", (await page.getByRole("link", { name: "Timesheet" }).count()) === 0);
  await page.screenshot({ path: "screenshots/local-desk.png", fullPage: true });

  console.log("\n▸ Health");
  check("no server errors or page crashes", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\nFAILED: ${err.message}`);
  await page.screenshot({ path: "screenshots/smoke-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "Local app is healthy." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
