import type { AvailabilityException, AvailabilityRule } from "./types";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

/**
 * Offset, in ms, between UTC and `tz` at the given instant.
 * Positive east of Greenwich. Derived from Intl so DST is handled for us.
 */
function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }

  // Intl can emit hour "24" for midnight in some locales/engines.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in `tz` to the real UTC instant.
 * Two passes so we land on the correct side of a DST transition.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hours: number,
  minutes: number,
  tz: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hours, minutes);
  const firstGuess = new Date(naive - tzOffsetMs(new Date(naive), tz));
  return new Date(naive - tzOffsetMs(firstGuess, tz));
}

/** Calendar parts of an instant as seen in `tz`. */
export function partsInTimeZone(instant: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }

  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hours: parts.hour === "24" ? 0 : Number(parts.hour),
    minutes: Number(parts.minute),
    weekday: weekdayIndex,
  };
}

/** "YYYY-MM-DD" for an instant, as seen in `tz`. */
export function dateKeyInTimeZone(instant: Date, tz: string): string {
  const { year, month, day } = partsInTimeZone(instant, tz);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:MM" or "HH:MM:SS" -> minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** Weekday index (0=Sun) for a "YYYY-MM-DD" key, timezone-independent. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Add days to a "YYYY-MM-DD" key without tripping over DST. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}`;
}

export type Slot = {
  /** ISO instant the slot starts. */
  startsAt: string;
  /** ISO instant the slot ends. */
  endsAt: string;
  /** "HH:MM" label in the counsellor's timezone. */
  label: string;
};

export type BusyRange = { starts_at: string; ends_at: string };

/**
 * Free slots on one calendar date in the counsellor's timezone.
 *
 * Windows come from the weekly rules, then exceptions are layered on:
 * an "unavailable" exception subtracts (whole day when it has no time
 * window), an "available" one adds. Existing bookings are then removed,
 * as is anything inside the lead-time cutoff.
 */
export function generateSlots(opts: {
  dateKey: string;
  timezone: string;
  durationMinutes: number;
  stepMinutes?: number;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  busy: BusyRange[];
  /** Slots starting before this instant are dropped. */
  notBefore?: Date;
}): Slot[] {
  const {
    dateKey,
    timezone,
    durationMinutes,
    stepMinutes = 30,
    rules,
    exceptions,
    busy,
    notBefore = new Date(),
  } = opts;

  const weekday = weekdayOfDateKey(dateKey);
  const dayExceptions = exceptions.filter((e) => e.on_date === dateKey);

  // A full-day block short-circuits everything.
  if (dayExceptions.some((e) => !e.is_available && !e.start_time)) return [];

  let windows: Array<[number, number]> = rules
    .filter((r) => r.is_active && r.weekday === weekday)
    .map((r) => [timeToMinutes(r.start_time), timeToMinutes(r.end_time)]);

  for (const e of dayExceptions) {
    if (e.is_available && e.start_time && e.end_time) {
      windows.push([timeToMinutes(e.start_time), timeToMinutes(e.end_time)]);
    }
  }

  // Subtract partial-day blocks.
  for (const e of dayExceptions) {
    if (e.is_available || !e.start_time || !e.end_time) continue;
    const [bs, be] = [timeToMinutes(e.start_time), timeToMinutes(e.end_time)];
    windows = windows.flatMap(([ws, we]) => {
      if (be <= ws || bs >= we) return [[ws, we] as [number, number]];
      const out: Array<[number, number]> = [];
      if (bs > ws) out.push([ws, bs]);
      if (be < we) out.push([be, we]);
      return out;
    });
  }

  windows.sort((a, b) => a[0] - b[0]);

  const [year, month, day] = dateKey.split("-").map(Number);
  const busyRanges = busy.map((b) => [
    new Date(b.starts_at).getTime(),
    new Date(b.ends_at).getTime(),
  ]);

  const slots: Slot[] = [];
  const seen = new Set<string>();

  for (const [wStart, wEnd] of windows) {
    for (let m = wStart; m + durationMinutes <= wEnd; m += stepMinutes) {
      const start = zonedTimeToUtc(
        year,
        month,
        day,
        Math.floor(m / 60),
        m % 60,
        timezone,
      );
      const end = new Date(start.getTime() + durationMinutes * 60_000);

      if (start.getTime() < notBefore.getTime()) continue;
      if (seen.has(start.toISOString())) continue;

      const overlaps = busyRanges.some(
        ([bs, be]) => start.getTime() < be && end.getTime() > bs,
      );
      if (overlaps) continue;

      seen.add(start.toISOString());
      slots.push({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        label: minutesToTime(m),
      });
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
