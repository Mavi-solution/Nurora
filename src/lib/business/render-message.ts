import { formatDate, formatDateTime, formatTimeRange } from "../format";

/**
 * Filling a message template.
 *
 * One place knows the placeholder vocabulary, so the editor, the
 * preview and the sender cannot disagree about what {{date}} means.
 */
export const PLACEHOLDERS = [
  { key: "client_name", label: "Client's first name", example: "Meera" },
  { key: "client_full_name", label: "Client's full name", example: "Meera Raghavan" },
  { key: "counsellor_name", label: "Counsellor", example: "Anisha" },
  { key: "date", label: "Date", example: "Mon, 21 Sep 2026" },
  { key: "time", label: "Time", example: "04:00 pm" },
  { key: "date_time", label: "Date and time", example: "Mon, 21 Sep 2026, 04:00 pm" },
  { key: "service", label: "Service booked", example: "Couple Therapy" },
  { key: "practice", label: "Practice name", example: "Nurora" },
  { key: "location", label: "Where, or the join link", example: "at the clinic" },
] as const;

export type PlaceholderKey = (typeof PLACEHOLDERS)[number]["key"];
export type MessageVars = Partial<Record<PlaceholderKey, string>>;

/**
 * Substitute {{placeholders}}.
 *
 * An unknown placeholder is left exactly as written rather than blanked.
 * A message reading "Hi {{frist_name}}" is obviously broken and gets
 * fixed; one reading "Hi ," looks almost right and ships.
 */
export function renderTemplate(body: string, vars: MessageVars): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const value = vars[name.toLowerCase() as PlaceholderKey];
    return value ?? whole;
  });
}

/** Placeholders used by a body, in the order they first appear. */
export function placeholdersUsed(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    const k = m[1].toLowerCase();
    if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}

/** Placeholders in a body that this app cannot fill. */
export function unknownPlaceholders(body: string): string[] {
  const known = new Set<string>(PLACEHOLDERS.map((p) => p.key));
  return placeholdersUsed(body).filter((k) => !known.has(k));
}

/** Sample values, for the preview in the editor. */
export function sampleVars(): MessageVars {
  return Object.fromEntries(
    PLACEHOLDERS.map((p) => [p.key, p.example]),
  ) as MessageVars;
}

/** Build the real values for one appointment. */
export function varsForAppointment(input: {
  clientFullName: string;
  counsellorName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  serviceName?: string | null;
  practiceName: string;
  location?: string | null;
  meetingUrl?: string | null;
}): MessageVars {
  const first = input.clientFullName.trim().split(/\s+/)[0] || "there";

  return {
    client_name: first,
    client_full_name: input.clientFullName,
    counsellor_name: input.counsellorName,
    date: formatDate(input.startsAt, input.timezone),
    time: formatTimeRange(input.startsAt, input.endsAt, input.timezone).split(" – ")[0],
    date_time: formatDateTime(input.startsAt, input.timezone),
    service: input.serviceName ?? "your session",
    practice: input.practiceName,
    location: input.meetingUrl
      ? `Join here: ${input.meetingUrl}`
      : input.location
        ? `Where: ${input.location}`
        : "at the clinic",
  };
}

/**
 * Positional variables for an approved Meta template.
 *
 * Meta templates use {{1}}, {{2}} … so the order registered with them
 * has to match what is sent. `variables` on the template row records
 * that order; getting it wrong silently swaps the name and the date in
 * the client's message.
 */
export function positionalVars(
  order: string[],
  vars: MessageVars,
): Record<string, string> {
  const out: Record<string, string> = {};
  order.forEach((key, i) => {
    out[String(i + 1)] = vars[key as PlaceholderKey] ?? "";
  });
  return out;
}

/** Roughly how a WhatsApp message will be billed and whether it fits. */
export function messageStats(body: string): {
  characters: number;
  overWhatsAppLimit: boolean;
  smsSegments: number;
} {
  const characters = body.length;
  // GSM-7 fits 160 per segment, 153 when concatenated; anything outside
  // that alphabet drops to UCS-2 at 70/67.
  const unicode = /[^\x00-\x7F]/.test(body);
  const per = unicode ? 67 : 153;
  return {
    characters,
    overWhatsAppLimit: characters > 1024,
    smsSegments: characters === 0 ? 0 : Math.ceil(characters / per),
  };
}
