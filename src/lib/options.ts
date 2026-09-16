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

/** Currencies, as ISO 4217 with the symbol people recognise. */
export const CURRENCIES = [
  { code: "INR", label: "₹ Indian rupee" },
  { code: "USD", label: "$ US dollar" },
  { code: "EUR", label: "€ Euro" },
  { code: "GBP", label: "£ Pound sterling" },
  { code: "AED", label: "د.إ UAE dirham" },
  { code: "SGD", label: "S$ Singapore dollar" },
  { code: "MYR", label: "RM Malaysian ringgit" },
  { code: "AUD", label: "A$ Australian dollar" },
  { code: "CAD", label: "C$ Canadian dollar" },
  { code: "LKR", label: "Rs Sri Lankan rupee" },
  { code: "CHF", label: "CHF Swiss franc" },
  { code: "JPY", label: "¥ Japanese yen" },
] as const;

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
