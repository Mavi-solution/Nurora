/**
 * End-to-end smoke test against the local Supabase stack.
 *
 * Signs in as a seeded counsellor using the real email-OTP flow (the code
 * is read from Mailpit, the local mail catcher), then walks the app:
 * check in, start a session, watch the timer, end it, and confirm the
 * invoice picked up the tracked time.
 *
 * The walkthrough mutates data (it completes a session), so run it against
 * a freshly seeded database:
 *
 *   npm run test:e2e     # supabase db reset && node scripts/e2e.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const APP = "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:54324";
const EMAIL = "anisha@nurora.demo";
const SHOTS = "screenshots";

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

async function latestOtp() {
  // Poll Mailpit for the newest message and pull the 6-digit code.
  for (let i = 0; i < 30; i += 1) {
    const list = await fetch(`${MAILPIT}/api/v1/messages?limit=1`).then((r) => r.json());
    const message = list.messages?.[0];
    if (message) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((r) => r.json());
      const body = `${full.Text ?? ""}${full.HTML ?? ""}`;
      const code = body.match(/\b(\d{6})\b/);
      if (code) return code[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("No OTP arrived in Mailpit");
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
  await page.screenshot({ path: `${SHOTS}/01-landing.png`, fullPage: true });

  step("Sign in with an email OTP");
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  check("Google button present", await page.getByRole("button", { name: /Continue with Google/i }).isVisible());
  check("phone tab present", await page.getByRole("button", { name: "Phone code" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/02-login.png`, fullPage: true });

  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByRole("button", { name: /Send me a code/i }).click();
  await page.getByLabel("Verification code").waitFor({ timeout: 15000 });

  const code = await latestOtp();
  console.log(`  (OTP from Mailpit: ${code})`);
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: /Verify and continue/i }).click();

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
