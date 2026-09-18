import { createClient } from "@/lib/supabase/server";
import { getClinicSettings } from "@/lib/data/reference";
import { weekdayOfDateKey, WEEKDAYS } from "@/lib/time";

/**
 * Who is unavailable on a given date, and why.
 *
 * A week-off, approved leave, a clinic holiday or a weekday the clinic
 * simply does not open all mean the same thing to the booking desk: do
 * not offer that counsellor. Reading all four in one place keeps the
 * rule in one place too — the schedule, the slot API and the
 * availability search each used to decide availability from working
 * hours alone, so a counsellor on leave was still bookable.
 */
export type DaysOff = {
  /** Counsellor ids who are off on this date. */
  off: Set<string>;
  /** Set when the whole clinic is closed — a holiday, or a closed weekday. */
  holiday: string | null;
  /** True when NOBODY works, whatever their own hours say. */
  clinicClosed: boolean;
  reasonFor: (counsellorId: string) => string | null;
};

export async function loadDaysOff(dateKey: string): Promise<DaysOff> {
  const supabase = await createClient();

  const [{ data: weekOffs }, { data: leaves }, { data: holidays }, settings] =
    await Promise.all([
      supabase.from("week_offs").select("staff_id").eq("on_date", dateKey),
      // Unapproved leave still blocks: someone who has asked for the day
      // off should not have a client booked onto it while it is pending.
      supabase.from("leaves").select("staff_id, kind").eq("on_date", dateKey),
      supabase.from("holidays").select("name").eq("on_date", dateKey).limit(1),
      getClinicSettings(),
    ]);

  const reasons = new Map<string, string>();
  for (const w of weekOffs ?? []) {
    reasons.set(w.staff_id as string, "on a week-off");
  }
  for (const l of leaves ?? []) {
    if (!reasons.has(l.staff_id as string)) {
      reasons.set(l.staff_id as string, `on ${l.kind as string} leave`);
    }
  }

  const named = (holidays ?? [])[0]?.name as string | undefined;

  /*
   * A weekday the clinic does not open is treated exactly like a
   * holiday, because to a client ringing up it IS one. Absent settings
   * mean "open every day" rather than "closed every day": a missing
   * configuration row must never silently shut the practice.
   */
  const openWeekdays = settings?.open_weekdays;
  const weekday = weekdayOfDateKey(dateKey);
  const closedWeekday =
    Array.isArray(openWeekdays) &&
    openWeekdays.length > 0 &&
    !openWeekdays.includes(weekday);

  const holiday =
    named ?? (closedWeekday ? `closed on ${WEEKDAYS[weekday]}s` : null);

  return {
    off: new Set(reasons.keys()),
    holiday,
    clinicClosed: holiday !== null,
    reasonFor: (id) =>
      holiday ? `the clinic is closed (${holiday})` : (reasons.get(id) ?? null),
  };
}

/**
 * The same answer for every date in a window, in one round trip.
 *
 * The availability search looks two weeks ahead, and calling
 * loadDaysOff() per day would be forty-odd queries for one keystroke at
 * the booking desk. Everything is fetched once and sliced by date here.
 * The per-day result is deliberately the SAME shape, so a caller cannot
 * accidentally apply a weaker rule to the lookahead than to the day it
 * actually books.
 */
export async function loadDaysOffRange(
  fromKey: string,
  toKey: string,
): Promise<(dateKey: string) => DaysOff> {
  const supabase = await createClient();

  const [{ data: weekOffs }, { data: leaves }, { data: holidays }, settings] =
    await Promise.all([
      supabase
        .from("week_offs")
        .select("staff_id, on_date")
        .gte("on_date", fromKey)
        .lte("on_date", toKey),
      supabase
        .from("leaves")
        .select("staff_id, kind, on_date")
        .gte("on_date", fromKey)
        .lte("on_date", toKey),
      supabase
        .from("holidays")
        .select("name, on_date")
        .gte("on_date", fromKey)
        .lte("on_date", toKey),
      getClinicSettings(),
    ]);

  const byDate = new Map<string, Map<string, string>>();
  const reasonsOn = (date: string) => {
    let m = byDate.get(date);
    if (!m) {
      m = new Map();
      byDate.set(date, m);
    }
    return m;
  };

  for (const w of weekOffs ?? []) {
    reasonsOn(w.on_date as string).set(w.staff_id as string, "on a week-off");
  }
  for (const l of leaves ?? []) {
    const m = reasonsOn(l.on_date as string);
    const id = l.staff_id as string;
    if (!m.has(id)) m.set(id, `on ${l.kind as string} leave`);
  }

  const holidayByDate = new Map(
    (holidays ?? []).map((h) => [h.on_date as string, h.name as string]),
  );

  const openWeekdays = settings?.open_weekdays;
  const hasOpenDays = Array.isArray(openWeekdays) && openWeekdays.length > 0;

  return (dateKey: string): DaysOff => {
    const reasons = byDate.get(dateKey) ?? new Map<string, string>();
    const weekday = weekdayOfDateKey(dateKey);
    const closedWeekday = hasOpenDays && !openWeekdays.includes(weekday);
    const holiday =
      holidayByDate.get(dateKey) ??
      (closedWeekday ? `closed on ${WEEKDAYS[weekday]}s` : null);

    return {
      off: new Set(reasons.keys()),
      holiday,
      clinicClosed: holiday !== null,
      reasonFor: (id) =>
        holiday
          ? `the clinic is closed (${holiday})`
          : (reasons.get(id) ?? null),
    };
  };
}
