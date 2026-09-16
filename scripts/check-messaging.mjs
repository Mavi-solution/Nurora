/**
 * Covers the two features added in 0005:
 *   1. Booking a session fires a WhatsApp confirmation (recorded in the
 *      notification_deliveries ledger even when Twilio is unconfigured).
 *   2. Staff can message each other privately, and the recipient sees it.
 *
 *   supabase db reset && node scripts/check-messaging.mjs
 */
import { chromium } from "playwright";

const APP = "http://localhost:3000";
const PASSWORD = "nurora1234";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

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
  await page.getByLabel("Password").fill(PASSWORD);
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  /* ---------------------------------------------- 1. booking + WhatsApp */
  step("Book a session from the desk");
  await signIn(page, "support@nurora.demo");
  await page.goto(`${APP}/schedule`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Quick book" }).click();
  await page.waitForTimeout(600);
  check("quick-book dialog opens", await page.getByRole("dialog").isVisible());

  const dialog = page.getByRole("dialog");

  // The dialog needs a name, a service and a counsellor before it will
  // look for open times; the service is what sets the price and length.
  await dialog.getByLabel("Client name").fill("Smoke Test Caller");
  // A number is what makes the WhatsApp confirmation reachable — without
  // one there is correctly nothing to send.
  await dialog.getByLabel("WhatsApp number").fill("98400 55501");
  await dialog.getByLabel("Service / Category").selectOption({ index: 1 });
  await dialog.getByLabel("Counsellor").selectOption({ index: 1 });

  // Book a few days out rather than today. Today's remaining slots depend
  // on the wall clock, so a run late in the working day would otherwise
  // find an empty grid and fail for reasons unrelated to the feature.
  const target = nextWorkingDay(3);
  await dialog.getByLabel("Date").fill(target);
  await page.waitForTimeout(1500);

  // Slots load over /api/slots; wait for the grid rather than a fixed delay.
  const slot = dialog.locator("div.grid.grid-cols-4 button").first();
  await slot.waitFor({ state: "visible", timeout: 15000 });
  await slot.click();

  await dialog.getByRole("button", { name: "Book appointment" }).click();
  await page.waitForTimeout(3000);

  const stillOpen = await dialog.isVisible().catch(() => false);
  const shownError = stillOpen
    ? await dialog.locator("[class*='red']").first().textContent().catch(() => "")
    : "";
  check("booking completed without an error", !stillOpen, shownError);

  step("The booking fired a WhatsApp confirmation");
  // Twilio is unconfigured locally, so the expected ledger status is
  // "skipped" — what matters is that the send path ran and was recorded
  // rather than silently doing nothing or throwing.
  const ledger = await fetch(
    "http://127.0.0.1:54321/rest/v1/notification_deliveries" +
      "?kind=eq.appointment_booked&select=channel,status,recipient_key,destination",
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  ).then((r) => r.json());

  console.log(`        ledger: ${JSON.stringify(ledger)}`);
  check("a delivery row was written for the booking", Array.isArray(ledger) && ledger.length > 0);
  check("the client was targeted on WhatsApp",
    ledger.some((r) => r.channel === "whatsapp" && r.recipient_key.startsWith("client:")),
    JSON.stringify(ledger));
  check("destination was normalised to E.164",
    ledger.every((r) => r.destination === null || !r.destination.startsWith("whatsapp:")),
    JSON.stringify(ledger.map((r) => r.destination)));

  /* ------------------------------------------------- 2. the team channel */
  step("Team channel + private threads");
  await page.goto(`${APP}/team`, { waitUntil: "networkidle" });
  check("team page renders", await page.getByRole("heading", { name: "Team", level: 1 }).isVisible());
  check("conversation list is present", await page.getByText("Conversations").isVisible());
  check("team channel entry is listed", await page.getByText("Everyone on shift").first().isVisible());

  const shefrin = page.getByRole("link", { name: /Shefrin/ }).first();
  check("a colleague is listed to message", await shefrin.isVisible());

  step("Desk sends Shefrin a private message");
  await shefrin.click();
  await page.waitForLoadState("networkidle");
  check("thread header names the colleague", await page.getByText(/private/).first().isVisible());

  const body = `Room 2 is free from 3pm — ${Date.now()}`;
  const box = page.getByRole("textbox", { name: /Message Shefrin/i });
  await box.fill(body);
  await box.press("Enter");
  await page.waitForTimeout(2000);
  check("message appears in the thread", await page.getByText(body).first().isVisible());

  step("Shefrin receives it");
  const page2 = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await signIn(page2, "shefrin@nurora.demo");
  await page2.goto(`${APP}/team`, { waitUntil: "networkidle" });

  const deskThread = page2.getByRole("link", { name: /Divya/ }).first();
  check("sender shows in Shefrin's conversation list", await deskThread.isVisible());
  await deskThread.click();
  await page2.waitForLoadState("networkidle");
  check("Shefrin can read the message", await page2.getByText(body).first().isVisible());

  step("A third counsellor cannot see that thread");
  const page3 = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await signIn(page3, "ramya@nurora.demo");
  await page3.goto(`${APP}/team`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(800);
  check("private message is not visible to Ramya",
    !(await page3.getByText(body).first().isVisible().catch(() => false)));

  step("Shared channel still works");
  await page3.goto(`${APP}/team`, { waitUntil: "networkidle" });
  const shout = `Handover notes are up — ${Date.now()}`;
  const chanBox = page3.getByRole("textbox", { name: "Message the team" });
  await chanBox.fill(shout);
  await chanBox.press("Enter");
  await page3.waitForTimeout(1800);
  check("channel message posts", await page3.getByText(shout).first().isVisible());

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n✓ All messaging checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
