/**
 * Phone numbers as typed by reception are not dial-ready. Twilio needs
 * E.164 ("+919876543210") and silently 400s on anything else, so every
 * outbound WhatsApp/SMS destination goes through here first.
 */

/** Default dialling code for numbers stored without one. */
function defaultCode(): string {
  const raw = process.env.NOTIFY_DEFAULT_COUNTRY_CODE ?? "+91";
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : "+91";
}

/**
 * Best-effort E.164. Returns null when there is nothing plausibly
 * dialable, so callers can skip the channel rather than send garbage.
 */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const trimmed = phone.trim();
  if (!trimmed) return null;

  // "whatsapp:+91..." is already a destination — hand back the number.
  const withoutScheme = trimmed.replace(/^whatsapp:/i, "");

  // 00 is the international prefix everywhere that isn't NANP.
  const normalised = withoutScheme.replace(/^00/, "+");
  const digits = normalised.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;

  if (normalised.startsWith("+")) return `+${digits}`;

  const code = defaultCode();
  const codeDigits = code.slice(1);

  // A local number that already carries its country code (a stored
  // "919876543210") must not become "+91919876543210".
  if (digits.startsWith(codeDigits) && digits.length > codeDigits.length + 6) {
    return `+${digits}`;
  }

  // Indian numbers are often stored with a trunk 0 — drop it.
  const local = digits.replace(/^0+/, "");
  if (!local) return null;

  // E.164 allows 15 digits at most. Prefixing a country code can push a
  // long local number past that, and the result would be silently
  // undialable — better to reject it than to hand Twilio a number that
  // cannot exist.
  if (codeDigits.length + local.length > 15) return null;

  return `${code}${local}`;
}

/** Human-readable form for audit trails and the UI. */
export function maskPhone(phone: string | null): string {
  const e164 = toE164(phone);
  if (!e164) return "—";
  return `${e164.slice(0, -4).replace(/\d(?=\d{2})/g, "•")}${e164.slice(-4)}`;
}
