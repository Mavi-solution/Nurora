/**
 * Drive the DateField calendar the way a person does.
 *
 * The date controls stopped being <input type="date"> — they are a
 * button that opens a month grid, because the native input renders
 * differently in every browser and shows no calendar affordance on
 * several of them. `fill()` therefore no longer applies, and these
 * helpers exist so each test does not grow its own copy of the
 * open-navigate-click dance.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Choose `dateKey` ("YYYY-MM-DD") in the DateField labelled `label`
 * inside `scope` (a page or a dialog locator).
 */
export async function pickDate(scope, dateKey, label = "Date") {
  const [year, month, day] = dateKey.split("-").map(Number);
  const wanted = `${MONTHS[month - 1]} ${year}`;

  // The trigger's accessible name is "<label>: <pretty date>".
  const trigger = scope
    .getByRole("button", { name: new RegExp(`^${escapeRe(label)}:`) })
    .first();

  await trigger.click();

  const dialog = scope.getByRole("dialog", { name: "Choose a date" }).first();
  await dialog.waitFor({ timeout: 10000 });

  // Step to the right month. Bounded so a mislabelled header fails the
  // test rather than spinning.
  for (let i = 0; i < 24; i += 1) {
    const heading = (await dialog.locator("span").first().textContent()) ?? "";
    if (heading.trim() === wanted) break;

    const forward = laterThan(heading.trim(), wanted);
    await dialog
      .getByRole("button", { name: forward ? "Previous month" : "Next month" })
      .click();
    await scope.page?.().waitForTimeout?.(60);
  }

  await dialog
    .getByRole("button", { name: String(day), exact: true })
    .first()
    .click();

  await dialog.waitFor({ state: "detached", timeout: 10000 });
}

/** Is `shown` a later month than `wanted`? */
function laterThan(shown, wanted) {
  const key = (s) => {
    const [name, y] = s.split(" ");
    return Number(y) * 12 + MONTHS.indexOf(name);
  };
  return key(shown) > key(wanted);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
