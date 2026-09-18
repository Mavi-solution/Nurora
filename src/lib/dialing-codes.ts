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
};

export const DIALING_CODES: DialingCode[] = [
  { iso: "IN", name: "India", code: "91" },

  { iso: "AE", name: "United Arab Emirates", code: "971" },
  { iso: "SA", name: "Saudi Arabia", code: "966" },
  { iso: "QA", name: "Qatar", code: "974" },
  { iso: "KW", name: "Kuwait", code: "965" },
  { iso: "OM", name: "Oman", code: "968" },
  { iso: "BH", name: "Bahrain", code: "973" },

  { iso: "LK", name: "Sri Lanka", code: "94" },
  { iso: "BD", name: "Bangladesh", code: "880" },
  { iso: "NP", name: "Nepal", code: "977" },
  { iso: "PK", name: "Pakistan", code: "92" },
  { iso: "MV", name: "Maldives", code: "960" },
  { iso: "BT", name: "Bhutan", code: "975" },

  { iso: "SG", name: "Singapore", code: "65" },
  { iso: "MY", name: "Malaysia", code: "60" },
  { iso: "TH", name: "Thailand", code: "66" },
  { iso: "ID", name: "Indonesia", code: "62" },
  { iso: "PH", name: "Philippines", code: "63" },
  { iso: "HK", name: "Hong Kong", code: "852" },
  { iso: "CN", name: "China", code: "86" },
  { iso: "JP", name: "Japan", code: "81" },
  { iso: "KR", name: "South Korea", code: "82" },

  { iso: "GB", name: "United Kingdom", code: "44" },
  { iso: "US", name: "United States", code: "1" },
  { iso: "CA", name: "Canada", code: "1" },
  { iso: "AU", name: "Australia", code: "61" },
  { iso: "NZ", name: "New Zealand", code: "64" },
  { iso: "IE", name: "Ireland", code: "353" },
  { iso: "ZA", name: "South Africa", code: "27" },

  { iso: "AR", name: "Argentina", code: "54" },
  { iso: "AT", name: "Austria", code: "43" },
  { iso: "BE", name: "Belgium", code: "32" },
  { iso: "BR", name: "Brazil", code: "55" },
  { iso: "CH", name: "Switzerland", code: "41" },
  { iso: "DE", name: "Germany", code: "49" },
  { iso: "DK", name: "Denmark", code: "45" },
  { iso: "EG", name: "Egypt", code: "20" },
  { iso: "ES", name: "Spain", code: "34" },
  { iso: "FI", name: "Finland", code: "358" },
  { iso: "FR", name: "France", code: "33" },
  { iso: "GR", name: "Greece", code: "30" },
  { iso: "IL", name: "Israel", code: "972" },
  { iso: "IT", name: "Italy", code: "39" },
  { iso: "KE", name: "Kenya", code: "254" },
  { iso: "MX", name: "Mexico", code: "52" },
  { iso: "NG", name: "Nigeria", code: "234" },
  { iso: "NL", name: "Netherlands", code: "31" },
  { iso: "NO", name: "Norway", code: "47" },
  { iso: "PL", name: "Poland", code: "48" },
  { iso: "PT", name: "Portugal", code: "351" },
  { iso: "RU", name: "Russia", code: "7" },
  { iso: "SE", name: "Sweden", code: "46" },
  { iso: "TR", name: "Turkey", code: "90" },
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
