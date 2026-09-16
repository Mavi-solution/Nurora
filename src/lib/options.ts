/**
 * Shared option lists for fields QA found were free text.
 *
 * Typing these by hand produced values that never matched each other —
 * "Female"/"female"/"F" are three different genders as far as a filter
 * or a report is concerned. One list, used everywhere, keeps them
 * comparable.
 */

export const GENDERS = [
  "Female",
  "Male",
  "Non-binary",
  "Prefer not to say",
] as const;

/**
 * Languages the practice works in. The booking desk narrows by what a
 * counsellor actually speaks, but a client's own preference has to be
 * recordable even when nobody on the roster speaks it yet.
 */
export const LANGUAGES = [
  "English",
  "Tamil",
  "Hindi",
  "Telugu",
  "Malayalam",
  "Kannada",
  "Marathi",
  "Bengali",
  "Gujarati",
  "Punjabi",
  "Urdu",
  "Odia",
  "Assamese",
  "Konkani",
  "Sinhala",
  "Arabic",
  "French",
  "German",
  "Spanish",
] as const;

/**
 * The practice bills in Indian rupees only.
 *
 * Kept as a named constant rather than scattered "INR" literals so the
 * day it stops being true there is one place to change. Every currency
 * column in the schema already defaults to INR; this makes the app
 * agree with the database instead of offering a choice that nothing
 * downstream is set up to honour — a session priced in one currency and
 * invoiced in another is a reporting problem, not a feature.
 */
export const PRACTICE_CURRENCY = "INR";
export const PRACTICE_CURRENCY_LABEL = "₹ Indian rupee (INR)";

/**
 * Merge a stored value into a list so an existing record never silently
 * loses it. A client recorded as "Sinhala" before that was on the list
 * must still show "Sinhala" rather than falling back to blank.
 */
export function withCurrent<T extends string>(
  options: readonly T[] | readonly string[],
  current: string | null | undefined,
): string[] {
  const list = [...options] as string[];
  if (current && !list.includes(current)) return [current, ...list];
  return list;
}
