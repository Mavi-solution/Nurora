/**
 * End-to-end smoke test against the local Supabase stack.
 *
 * Covers sign-up validation, password sign-in (including a rejected bad
 * password), then walks the app as a counsellor-admin: check in, start a
 * session, watch the timer, end it, and confirm the invoice picked up the
 * tracked time.
 *
 * The walkthrough mutates data (it completes a session), so run it against
 * a freshly seeded database:
 *
 *   npm run test:e2e     # supabase db reset && node scripts/e2e.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const APP = "http://localhost:3000";
const SHOTS = "screenshots";

// Seeded counsellor who also holds admin rights.
const EMAIL = "anisha@nurora.demo";
const PASSWORD = "nurora1234";

mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const step = (name) => console.log(`\n▸ ${name}`);
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

try {
  step("Landing page");
  await page.goto(APP, { waitUntil: "networkidle" });
  check("hero copy renders", await page.getByText("is about to happen.").isVisible());

  // Guard the whole styling pipeline. A 404 on the stylesheet, or a theme
  // token that resolves to nothing, drops the app to unstyled system fonts
  // without throwing anything.
  const styling = await page.evaluate(async () => {
    await document.fonts.ready;
    const root = getComputedStyle(document.documentElement);
    const h1 = document.querySelector("h1");
    return {
      brand: root.getPropertyValue("--color-brand-600").trim(),
      sans: root.getPropertyValue("--font-sans").trim(),
      display: root.getPropertyValue("--font-display").trim(),
      bodyFont: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/['"]/g, ""),
      headingFont: h1 ? getComputedStyle(h1).fontFamily.split(",")[0].replace(/['"]/g, "") : "",
      sheets: document.styleSheets.length,
    };
  });
  check("stylesheet loaded", styling.sheets > 0, `${styling.sheets} sheets`);
  check("brand colour token resolves", styling.brand === "#2f6f6b", styling.brand || "(empty)");
  check("--font-sans resolves", styling.sans.length > 0, styling.sans || "(empty)");
  check("--font-display resolves", styling.display.length > 0, styling.display || "(empty)");
  check("body renders in Inter", styling.bodyFont === "Inter", styling.bodyFont);
  check("headings render in Fraunces", styling.headingFont === "Fraunces", styling.headingFont);
  await page.screenshot({ path: `${SHOTS}/01-landing.png`, fullPage: true });

  step("Sign-up page");
  await page.goto(`${APP}/signup`, { waitUntil: "networkidle" });
  check("signup form renders", await page.getByLabel("Full name").isVisible());
  check("password field", await page.getByLabel("Password", { exact: true }).isVisible());
  check("confirm password field", await page.getByLabel("Confirm password").isVisible());
  await page.screenshot({ path: `${SHOTS}/02b-signup.png`, fullPage: true });

  step("Sign-up rejects mismatched passwords");
  await page.getByLabel("Full name").fill("Test Counsellor");
  await page.getByLabel("Email address").fill(`new-${Date.now()}@nurora.test`);
  await page.getByLabel("Password", { exact: true }).fill("supersecret1");
  await page.getByLabel("Confirm password").fill("different1");
  await page.getByRole("button", { name: /Create account/i }).click();
  check("mismatch is caught", await page.getByText(/passwords don't match/i).isVisible());

  step("Sign in with a password");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  check("email field", await page.getByLabel("Email address").isVisible());
  check("password field", await page.getByLabel("Password").isVisible());
  check("link to sign up", await page.getByRole("link", { name: /Create one/i }).isVisible());
  check(
    "no broken Google button",
    (await page.getByRole("button", { name: /Continue with Google/i }).count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS}/02-login.png`, fullPage: true });

  step("Wrong password is rejected");
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForTimeout(1500);
  check("bad credentials rejected", await page.getByText(/don't match an account/i).isVisible());
  check("still on login", page.url().includes("/login"));

  // The rejected sign-in above legitimately produces a 400 from Supabase.
  // Clear the log here rather than filtering, so later 400s still surface.
  errors.length = 0;

  step("Correct password signs in");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|onboarding)/, { timeout: 20000 });
  check("signed in", !page.url().includes("/login"), page.url());

  step("Schedule board");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("check-in control", await page.getByRole("button", { name: /Tap to check in|Checked in/ }).isVisible());
  const laneNames = await page.locator("p.font-semibold").allTextContents();
  check("Anisha's lane", laneNames.includes("Anisha"), laneNames.join(","));
  check("Ravi Kumar booked", await page.getByRole("link", { name: "Ravi Kumar" }).first().isVisible());
  check("Neha R. booked", await page.getByRole("link", { name: "Neha R." }).first().isVisible());
  check("Shefrin's lane", laneNames.includes("Shefrin"), laneNames.join(","));
  check("all five counsellors have lanes", laneNames.length === 5, laneNames.join(","));
  check("age chip shows 36", (await page.locator('select[aria-label="Client age"]').first().inputValue()) === "36");
  check("composer present", await page.getByPlaceholder("Message the team…").isVisible());
  check("Quick book present", await page.getByRole("button", { name: "Quick book" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/03-schedule.png`, fullPage: true });

  step("Check in");
  await page.getByRole("button", { name: /Tap to check in/ }).click();
  await page.getByRole("button", { name: /Checked in/ }).waitFor({ timeout: 10000 });
  check("checked in", await page.getByRole("button", { name: /Checked in/ }).isVisible());

  step("Start a session");
  const raviRow = page.locator("div").filter({ has: page.getByRole("link", { name: "Ravi Kumar" }) }).last();
  await raviRow.getByRole("button", { name: "Start" }).click();
  await page.getByRole("dialog").waitFor({ timeout: 10000 });
  check("dialog title", await page.getByText("Start this session?").isVisible());
  check("base fee shown", await page.getByText("Base session fee").isVisible());
  check("fee is ₹2,000", await page.getByText("₹2,000").isVisible());
  check(
    "billed-timer warning",
    await page.getByText(/starts the billed timer right away/i).isVisible(),
  );
  await page.waitForTimeout(600); // let the entry animation settle before capturing
  await page.screenshot({ path: `${SHOTS}/04-start-dialog.png` });

  await page.getByRole("button", { name: /Start timer/i }).click();
  await page.getByText("Session in progress").waitFor({ timeout: 15000 });
  check("session marked in progress", await page.getByText("Session in progress").isVisible());

  const first = await page.locator('[role="timer"]').first().textContent();
  await page.waitForTimeout(2200);
  const second = await page.locator('[role="timer"]').first().textContent();
  check("timer is ticking", first !== second, `${first} -> ${second}`);
  check("End button appears", (await page.getByRole("button", { name: "End", exact: true }).count()) >= 1);
  await page.screenshot({ path: `${SHOTS}/05-running.png`, fullPage: true });

  step("End the session");
  const runningRow = page.locator("div").filter({ has: page.locator('[role="timer"]') }).last();
  await runningRow.getByRole("button", { name: "End", exact: true }).click();
  await page.waitForTimeout(3000);
  check("no longer in progress", (await page.getByText("Session in progress").count()) === 0);
  check("session row shows tracked minutes", await page.getByText(/\d+ min/).first().isVisible());

  step("Payments picked up the tracked time");
  await page.goto(`${APP}/payments`, { waitUntil: "networkidle" });
  check("invoice number listed", await page.getByText(/NUR-\d+/).first().isVisible());
  check("tracked minutes on invoice", await page.getByText(/\d+m tracked/).first().isVisible());
  check("Mark paid available", await page.getByRole("button", { name: "Mark paid" }).first().isVisible());
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });

  step("Quick book validates");
  await page.getByRole("button", { name: "Quick book" }).click();
  await page.getByRole("dialog").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /Confirm booking/i }).click();
  check("rejects an empty booking", await page.getByText(/Pick a (client|time slot)/i).isVisible());
  await page.screenshot({ path: `${SHOTS}/06-quick-book.png` });
  await page.keyboard.press("Escape");

  step("Other pages");
  for (const [path, marker] of [
    ["/clients", "Clients"],
    ["/payments", "Payments"],
    ["/availability", "Availability"],
    ["/timesheet", "Timesheet"],
    ["/team", "Team"],
    ["/notifications", "Notifications"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    const heading = page.getByRole("heading", { name: marker, level: 1 });
    check(`${path} renders`, await heading.isVisible().catch(() => false));
    await page.screenshot({ path: `${SHOTS}/page${path.replace(/\//g, "-")}.png`, fullPage: true });
  }

  step("Payments reflect the tracked session");
  await page.goto(`${APP}/payments`, { waitUntil: "networkidle" });
  check("invoice list rendered", await page.getByText(/NUR-\d+/).first().isVisible());

  step("Counsellor-admin has admin powers");
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  check("People section visible to admin", await page.getByText("People").first().isVisible());
  check("admin checkboxes rendered", (await page.getByRole("checkbox", { name: "Admin" }).count()) > 0);
  await page.goto(`${APP}/availability`, { waitUntil: "networkidle" });
  check(
    "admin can pick any counsellor's availability",
    await page.getByLabel("Choose counsellor").isVisible(),
  );
  await page.screenshot({ path: `${SHOTS}/page-settings.png`, fullPage: true });

  step("Dark theme");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Switch to dark theme/i }).click();
  await page.waitForTimeout(600);
  check("dark class applied", await page.locator("html.dark").count() === 1);
  await page.screenshot({ path: `${SHOTS}/07-schedule-dark.png`, fullPage: true });

  step("Console health");
  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  check("no console errors", real.length === 0, real.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\nFAILED: ${err.message}`);
  await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "All end-to-end checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
