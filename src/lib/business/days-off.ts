import { createClient } from "@/lib/supabase/server";

/**
 * Who is unavailable on a given date, and why.
 *
 * A week-off, approved leave or a clinic holiday all mean the same
 * thing to the booking desk: do not offer that counsellor. Reading all
 * three in one place keeps the rule in one place too — the schedule,
 * the slot API and the availability search each used to decide
 * availability from working hours alone, so a counsellor on leave was
 * still bookable.
 */
export type DaysOff = {
  /** Counsellor ids who are off on this date. */
  off: Set<string>;
  /** Set when the whole clinic is closed. */
  holiday: string | null;
  reasonFor: (counsellorId: string) => string | null;
};

export async function loadDaysOff(dateKey: string): Promise<DaysOff> {
  const supabase = await createClient();

  const [{ data: weekOffs }, { data: leaves }, { data: holidays }] =
    await Promise.all([
      supabase.from("week_offs").select("staff_id").eq("on_date", dateKey),
      // Unapproved leave still blocks: someone who has asked for the day
      // off should not have a client booked onto it while it is pending.
      supabase.from("leaves").select("staff_id, kind").eq("on_date", dateKey),
      supabase.from("holidays").select("name").eq("on_date", dateKey).limit(1),
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

  const holiday = (holidays ?? [])[0]?.name as string | undefined;

  return {
    off: new Set(reasons.keys()),
    holiday: holiday ?? null,
    reasonFor: (id) =>
      holiday ? `the clinic is closed (${holiday})` : (reasons.get(id) ?? null),
  };
}
