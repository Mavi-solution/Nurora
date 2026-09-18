/**
 * Admin editing a counsellor's details — profile, specialisms, active
 * state, role and admin rights.
 *   supabase db reset && node scripts/check-counsellor-edit.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const APP = "http://localhost:3000";
const sql = (q) => execFileSync("psql",
  ["-h","127.0.0.1","-p","54322","-U","postgres","-d","postgres","-qtA","-c",q],
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
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

try {
  const id = sql("select id from profiles where email='shefrin@nurora.demo'");
  await signIn(page, "anisha@nurora.demo");

  step("The roster links through to an editor");
  await page.goto(`${APP}/counsellors`, { waitUntil: "networkidle" });
  check("Edit link on each row", (await page.getByRole("link", { name: "Edit" }).count()) > 0);
  await page.getByRole("link", { name: "Shefrin", exact: true }).first().click();
  await page.waitForURL(/\/counsellors\/[0-9a-f-]{36}/, { timeout: 20000 });
  check("lands on the editor", page.url().includes(`/counsellors/${id}`), page.url());

  step("Editing the profile persists");
  await page.getByLabel("Headline").fill("Senior counsellor, trauma");
  // The national part only — the dialling code is its own control now.
  await page.getByLabel("Phone", { exact: true }).fill("9840011999");
  // Languages are chips rather than comma-separated text: a typo used
  // to create a language nothing could ever filter on.
  const languageChip = (name) =>
    page.getByRole("button", { name, exact: true, pressed: undefined });
  for (const l of ["English", "Tamil", "Hindi"]) {
    const chip = languageChip(l);
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
  }
  await page.getByLabel("Session fee").fill("2500");
  await page.getByLabel("Minutes").fill("45");
  await page.getByRole("button", { name: "Anxiety" }).click();
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForTimeout(2500);

  const row = sql(`select coalesce(headline,'')||'|'||coalesce(phone,'')||'|'||array_to_string(languages,',')||'|'||default_session_fee_cents||'|'||default_duration_minutes from profiles where id='${id}'`);
  console.log(`        saved: ${row}`);
  const [h, ph, langs, fee, mins] = row.split("|");
  check("headline saved", h === "Senior counsellor, trauma");
  check("phone saved", ph === "+919840011999");
  check(
    "languages saved",
    ["English", "Tamil", "Hindi"].every((l) => langs.split(",").includes(l)),
    langs,
  );
  check("fee saved as paise", fee === "250000", fee);
  check("duration saved", mins === "45");
  check("specialism added",
    Number(sql(`select count(*) from counsellor_specialisms cs join specialisms s on s.id=cs.specialism_id where cs.counsellor_id='${id}' and s.name='Anxiety'`)) === 1);

  step("Toggling bookings on and off");
  await page.getByRole("button", { name: "Stop taking bookings" }).click();
  await page.waitForTimeout(2200);
  check("marked inactive", sql(`select is_active from profiles where id='${id}'`) === "f");
  await page.getByRole("button", { name: "Resume taking bookings" }).click();
  await page.waitForTimeout(2200);
  check("active again", sql(`select is_active from profiles where id='${id}'`) === "t");

  step("Granting admin rights");
  await page.getByRole("checkbox", { name: /Admin rights/ }).check();
  await page.waitForTimeout(2200);
  check("is_admin set", sql(`select is_admin from profiles where id='${id}'`) === "t");
  check("role unchanged — admin is a flag, not a role",
    sql(`select role from profiles where id='${id}'`) === "counsellor");
  await page.getByRole("checkbox", { name: /Admin rights/ }).uncheck();
  await page.waitForTimeout(2200);
  check("revoked", sql(`select is_admin from profiles where id='${id}'`) === "f");

  step("Setting a temporary password");
  await page.getByRole("button", { name: "Set a temporary password" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("textbox", { name: /Temporary password/ }).fill("handover-2026");
  await page.getByRole("button", { name: "Set password" }).click();
  await page.waitForTimeout(2500);
  check("confirmed", await page.getByText(/Password set/).isVisible().catch(() => false));
  await signIn(page, "shefrin@nurora.demo").catch(() => {});
  await page.context().clearCookies();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("shefrin@nurora.demo");
  await page.getByLabel("Password").fill("handover-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(schedule|dashboard|my)/, { timeout: 20000 });
  check("the new password actually signs in", true);

  step("An admin cannot change their OWN role or rights");
  await signIn(page, "anisha@nurora.demo");
  const me = sql("select id from profiles where email='anisha@nurora.demo'");
  await page.goto(`${APP}/counsellors/${me}`, { waitUntil: "networkidle" });
  // Target the role select by name. The Profile card now carries a
  // timezone dropdown ahead of it, so "the first combobox" is no
  // longer the one under Access.
  check("own role locked", await page.getByLabel("Role", { exact: true }).isDisabled());
  check("own admin checkbox locked", await page.getByRole("checkbox", { name: /Admin rights/ }).isDisabled());

  step("Reception can edit profiles but not access");
  await signIn(page, "support@nurora.demo");
  await page.goto(`${APP}/counsellors/${id}`, { waitUntil: "networkidle" });
  check("reception reaches the editor", await page.getByRole("button", { name: "Save profile" }).isVisible());
  check("but sees no Access card", (await page.getByText("Admin only.").count()) === 0);

  step("Console / server errors");
  check("no page errors or 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failures += 1;
  console.log(`\n  FAIL  threw — ${err.message}`);
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All counsellor-edit checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
