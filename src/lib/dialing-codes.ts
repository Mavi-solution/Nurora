/**
 * International dialling codes.
 *
 * QA asked for these on every phone field. The reason is not cosmetic:
 * a number typed as "98400 11223" is only dialable because toE164()
 * guesses +91 for it. That guess is right for a Chennai practice and
 * wrong the moment a client rings from Dubai — and the failure is
 * silent, because a WhatsApp reminder to a malformed number is simply
 * never delivered. Making the code an explicit choice turns a guess
 * into a decision the desk actually made.
 *
 * India is first and is the default. The rest are ordered by where this
 * practice's clients live: the Gulf, then south and east Asia, then the
 * anglophone diaspora, then everyone else alphabetically.
 */

export type DialingCode = {
  /** ISO 3166-1 alpha-2, used only to key the list. */
  iso: string;
  name: string;
  /** Digits only, no plus. */
  code: string;
  /**
   * Length of the national number, where the country has exactly one.
   *
   * Used for one job only: telling a country code typed TWICE apart
   * from a local number that happens to begin with the same digits.
   * Left undefined wherever the length varies, because a wrong guess
   * here silently shortens a real number.
   */
  nsn?: number;
};

export const DIALING_CODES: DialingCode[] = [
  { iso: "IN", name: "India", code: "91", nsn: 10 },

  { iso: "AE", name: "United Arab Emirates", code: "971", nsn: 9 },
  { iso: "SA", name: "Saudi Arabia", code: "966", nsn: 9 },
  { iso: "QA", name: "Qatar", code: "974", nsn: 8 },
  { iso: "KW", name: "Kuwait", code: "965", nsn: 8 },
  { iso: "OM", name: "Oman", code: "968", nsn: 8 },
  { iso: "BH", name: "Bahrain", code: "973", nsn: 8 },

  { iso: "LK", name: "Sri Lanka", code: "94", nsn: 9 },
  { iso: "BD", name: "Bangladesh", code: "880", nsn: 10 },
  { iso: "NP", name: "Nepal", code: "977", nsn: 10 },
  { iso: "PK", name: "Pakistan", code: "92", nsn: 10 },
  { iso: "MV", name: "Maldives", code: "960" },
  { iso: "BT", name: "Bhutan", code: "975" },

  { iso: "SG", name: "Singapore", code: "65", nsn: 8 },
  { iso: "MY", name: "Malaysia", code: "60" },
  { iso: "TH", name: "Thailand", code: "66" },
  { iso: "ID", name: "Indonesia", code: "62" },
  { iso: "PH", name: "Philippines", code: "63" },
  { iso: "HK", name: "Hong Kong", code: "852", nsn: 8 },
  { iso: "CN", name: "China", code: "86" },
  { iso: "JP", name: "Japan", code: "81" },
  { iso: "KR", name: "South Korea", code: "82" },

  { iso: "GB", name: "United Kingdom", code: "44", nsn: 10 },
  { iso: "US", name: "United States", code: "1", nsn: 10 },
  { iso: "CA", name: "Canada", code: "1", nsn: 10 },
  { iso: "AU", name: "Australia", code: "61", nsn: 9 },
  { iso: "NZ", name: "New Zealand", code: "64" },
  { iso: "IE", name: "Ireland", code: "353", nsn: 9 },
  { iso: "ZA", name: "South Africa", code: "27", nsn: 9 },

  { iso: "AR", name: "Argentina", code: "54" },
  { iso: "AT", name: "Austria", code: "43" },
  { iso: "BE", name: "Belgium", code: "32", nsn: 9 },
  { iso: "BR", name: "Brazil", code: "55" },
  { iso: "CH", name: "Switzerland", code: "41", nsn: 9 },
  { iso: "DE", name: "Germany", code: "49" },
  { iso: "DK", name: "Denmark", code: "45", nsn: 8 },
  { iso: "EG", name: "Egypt", code: "20" },
  { iso: "ES", name: "Spain", code: "34", nsn: 9 },
  { iso: "FI", name: "Finland", code: "358" },
  { iso: "FR", name: "France", code: "33", nsn: 9 },
  { iso: "GR", name: "Greece", code: "30", nsn: 10 },
  { iso: "IL", name: "Israel", code: "972" },
  { iso: "IT", name: "Italy", code: "39" },
  { iso: "KE", name: "Kenya", code: "254", nsn: 9 },
  { iso: "MX", name: "Mexico", code: "52" },
  { iso: "NG", name: "Nigeria", code: "234", nsn: 10 },
  { iso: "NL", name: "Netherlands", code: "31", nsn: 9 },
  { iso: "NO", name: "Norway", code: "47", nsn: 8 },
  { iso: "PL", name: "Poland", code: "48", nsn: 9 },
  { iso: "PT", name: "Portugal", code: "351", nsn: 9 },
  { iso: "RU", name: "Russia", code: "7" },
  { iso: "SE", name: "Sweden", code: "46" },
  { iso: "TR", name: "Turkey", code: "90", nsn: 10 },
];

export const DEFAULT_DIALING_CODE = "91";

/**
 * Longest-match the dialling code off the front of an E.164 number.
 *
 * Longest first matters: "+1..." and "+91..." both begin with a 1 when
 * compared naively, and "+971..." (UAE) starts with the "97" of nothing
 * in particular. Sorting by length stops a Dubai number being read as
 * an Indian one.
 */
const BY_LENGTH = [...new Set(DIALING_CODES.map((c) => c.code))].sort(
  (a, b) => b.length - a.length,
);

/** Split "+919840011223" into { code: "91", national: "9840011223" }. */
export function splitDialingCode(value: string | null | undefined): {
  code: string;
  national: string;
} {
  const raw = (value ?? "").trim();
  if (!raw) return { code: DEFAULT_DIALING_CODE, national: "" };

  // Only a number that declares itself international can have its code
  // read off it. "9840011223" is a local number, not a +98 one.
  const international = raw.startsWith("+") || raw.startsWith("00");
  const digits = raw.replace(/\D/g, "");

  if (!international) return { code: DEFAULT_DIALING_CODE, national: digits };

  const body = raw.startsWith("00") ? digits.replace(/^00/, "") : digits;
  for (const code of BY_LENGTH) {
    if (body.startsWith(code) && body.length > code.length) {
      return { code, national: body.slice(code.length) };
    }
  }
  return { code: DEFAULT_DIALING_CODE, national: body };
}

/** Rejoin the two halves into the E.164 string we store. */
export function joinDialingCode(code: string, national: string): string {
  const local = national.replace(/\D/g, "").replace(/^0+/, "");
  if (!local) return "";
  return `+${code.replace(/\D/g, "")}${local}`;
}

export function dialingCodeLabel(c: DialingCode): string {
  return `${c.name} +${c.code}`;
}


/**
 * Tidy what someone typed into the national-number box.
 *
 * Deliberately NOT run on every keystroke. An earlier version re-split
 * the value on each character, which meant typing "+919840011223" had
 * its "+" swallowed on the second keystroke and the country code then
 * read as part of the local number — the field visibly fought back as
 * you typed. This runs on paste and on blur, so what is on screen is
 * always exactly what was typed until the moment you leave the field.
 *
 * Two things are fixed:
 *
 *   "+971 50 123 4567"  an international number pasted into the
 *                       national box, which would otherwise be stored
 *                       against whatever code the dropdown had
 *   "919840011223"      the country code typed as well as selected
 *
 * The second is why `nsn` exists. An Indian mobile can legitimately
 * begin "91" — 9123456789 is a real number — so a prefix match alone
 * must not strip it. Only a string that is EXACTLY code + national
 * length is treated as the code typed twice.
 */
export function normalisePhoneInput(
  code: string,
  typed: string,
): { code: string; national: string } {
  const raw = (typed ?? "").trim();
  if (!raw) return { code, national: "" };

  // Anything declaring itself international carries its own code.
  if (raw.startsWith("+") || raw.startsWith("00")) {
    const split = splitDialingCode(raw);
    return split.national ? split : { code, national: "" };
  }

  const digits = raw.replace(/\D/g, "");
  const nsn = DIALING_CODES.find((c) => c.code === code)?.nsn;

  if (nsn && digits.length === code.length + nsn && digits.startsWith(code)) {
    return { code, national: digits.slice(code.length) };
  }

  return { code, national: raw };
}
