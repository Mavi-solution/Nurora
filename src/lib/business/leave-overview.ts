import type { Holiday, Leave, LeaveKind, WeekOff } from "@/lib/types";

/*
 * Deliberately no runtime imports.
 *
 * This is arithmetic an admin makes staffing decisions on, so it is
 * unit-tested directly — and the test runner strips TypeScript types
 * without resolving the "@/" alias, so a module that imports across the
 * app cannot be loaded without a browser or a build.
 *
 * The two helpers below are therefore re-stated rather than imported.
 * Both are three lines and neither encodes a rule; the MONTHLY QUOTA,
 * which is a rule and is marked MUST MATCH, is NOT restated — it is
 * passed in, so weekoff.ts stays the only place it is decided.
 * check-leave-overview.mjs asserts these two agree with the canonical
 * versions, so the copies cannot drift unnoticed.
 */

/** "HH:MM" or "HH:MM:SS" -> minutes since midnight. Mirrors lib/time.ts. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Weekday index (0=Sun) for a "YYYY-MM-DD" key. Mirrors lib/time.ts. */
function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The practice-wide view of who is off.
 *
 * The Week-off & Leave screen was scoped to ONE person, chosen from a
 * dropdown, and defaulted to whoever was looking. An admin therefore
 * opened it, saw "Leave logged: 0" against their own empty month, and
 * had to pick each counsellor in turn to discover that two of them were
 * away — which is the opposite of what a rota screen is for.
 *
 * Everything here is pure so the arithmetic can be tested without a
 * browser or a database. The headline number an admin actually needs is
 * not "how many rows" but "how many people, and how many working hours"
 * — a week-off on a day somebody was not working anyway costs nothing,
 * and a screen that counted it the same as a full day would misinform.
 */

export type OffReason = "week-off" | "leave" | "holiday";

export type PersonOnDay = {
  staffId: string;
  name: string;
  reason: OffReason;
  /** "sick", "planned"… for leave; absent otherwise. */
  kind?: LeaveKind;
  /** False for leave still waiting on an admin. */
  approved: boolean;
  /** Working minutes this absence actually costs. */
  minutesLost: number;
};

export type DayOverview = {
  dateKey: string;
  /** Named when the whole clinic is shut. */
  holiday: string | null;
  people: PersonOnDay[];
  minutesLost: number;
};

export type PersonOverview = {
  staffId: string;
  name: string;
  weekOffsTaken: number;
  quota: number;
  remaining: number;
  leaveDays: number;
  pendingLeave: number;
  minutesLost: number;
  /** Their normal week, for context next to what they have lost. */
  weeklyMinutes: number;
};

export type LeaveOverview = {
  people: PersonOverview[];
  days: DayOverview[];
  totals: {
    staffCount: number;
    /** Distinct person-days away, holidays excluded. */
    absenceDays: number;
    minutesLost: number;
    pendingLeave: number;
    holidayDays: number;
  };
};

export type StaffMember = { id: string; full_name: string };

export type WorkingRule = {
  counsellor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

/**
 * Minutes this person normally works on that weekday.
 *
 * Overlapping windows are NOT double-counted — two rules that overlap
 * describe one stretch of availability, and adding them would invent
 * hours nobody ever worked. The editor now rejects overlaps, but
 * historical rows predate that, and this is the place it would show up
 * as a wrong number rather than an error.
 */
export function minutesOnWeekday(
  rules: WorkingRule[],
  staffId: string,
  weekday: number,
): number {
  const windows = rules
    .filter((r) => r.is_active && r.counsellor_id === staffId && r.weekday === weekday)
    .map((r) => [timeToMinutes(r.start_time), timeToMinutes(r.end_time)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let cursor = -1;

  for (const [start, end] of windows) {
    const from = Math.max(start, cursor);
    if (end > from) {
      total += end - from;
      cursor = end;
    }
  }

  return total;
}

/** Their whole week, for context. */
export function weeklyMinutes(rules: WorkingRule[], staffId: string): number {
  let total = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    total += minutesOnWeekday(rules, staffId, weekday);
  }
  return total;
}

export function summariseMonth(input: {
  year: number;
  month: number;
  /**
   * The month's week-off allowance, from weekoff.ts.
   *
   * Passed in rather than computed here: it is a MUST-MATCH rule with
   * one home, and a second implementation of it is exactly the mistake
   * the handoff warns about.
   */
  quota: number;
  staff: StaffMember[];
  rules: WorkingRule[];
  weekOffs: WeekOff[];
  leaves: Leave[];
  holidays: Holiday[];
}): LeaveOverview {
  const { year, month, quota, staff, rules, weekOffs, leaves, holidays } = input;

  const nameOf = new Map(staff.map((s) => [s.id, s.full_name]));
  const holidayByDate = new Map(holidays.map((h) => [h.on_date, h.name]));

  const byDate = new Map<string, PersonOnDay[]>();
  const push = (dateKey: string, person: PersonOnDay) => {
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), person]);
  };

  const cost = (staffId: string, dateKey: string) =>
    /*
     * A day off the clinic was closed anyway costs nothing, and neither
     * does one on a weekday this person does not work. Counting those
     * would inflate every total on the screen.
     */
    holidayByDate.has(dateKey)
      ? 0
      : minutesOnWeekday(rules, staffId, weekdayOfDateKey(dateKey));

  for (const w of weekOffs) {
    if (!nameOf.has(w.staff_id)) continue;
    push(w.on_date, {
      staffId: w.staff_id,
      name: nameOf.get(w.staff_id)!,
      reason: "week-off",
      approved: true,
      minutesLost: cost(w.staff_id, w.on_date),
    });
  }

  for (const l of leaves) {
    if (!nameOf.has(l.staff_id)) continue;
    // Someone with both a week-off and leave on one day is away once.
    const already = (byDate.get(l.on_date) ?? []).some(
      (p) => p.staffId === l.staff_id,
    );
    if (already) continue;

    push(l.on_date, {
      staffId: l.staff_id,
      name: nameOf.get(l.staff_id)!,
      reason: "leave",
      kind: l.kind,
      approved: Boolean(l.approved_at),
      minutesLost: cost(l.staff_id, l.on_date),
    });
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: DayOverview[] = [];

  for (let d = 1; d <= lastDay; d += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const people = byDate.get(dateKey) ?? [];
    days.push({
      dateKey,
      holiday: holidayByDate.get(dateKey) ?? null,
      people,
      minutesLost: people.reduce((sum, p) => sum + p.minutesLost, 0),
    });
  }

  const people: PersonOverview[] = staff.map((s) => {
    const mine = days.flatMap((day) => day.people.filter((p) => p.staffId === s.id));
    const taken = mine.filter((p) => p.reason === "week-off").length;
    const leaveDays = mine.filter((p) => p.reason === "leave");

    return {
      staffId: s.id,
      name: s.full_name,
      weekOffsTaken: taken,
      quota,
      remaining: Math.max(0, quota - taken),
      leaveDays: leaveDays.length,
      pendingLeave: leaveDays.filter((p) => !p.approved).length,
      minutesLost: mine.reduce((sum, p) => sum + p.minutesLost, 0),
      weeklyMinutes: weeklyMinutes(rules, s.id),
    };
  });

  return {
    people,
    days,
    totals: {
      staffCount: staff.length,
      absenceDays: days.reduce((sum, day) => sum + day.people.length, 0),
      minutesLost: days.reduce((sum, day) => sum + day.minutesLost, 0),
      pendingLeave: people.reduce((sum, p) => sum + p.pendingLeave, 0),
      holidayDays: days.filter((day) => day.holiday).length,
    },
  };
}

/** Who is away on one specific day. */
export function offOn(overview: LeaveOverview, dateKey: string): DayOverview | null {
  return overview.days.find((d) => d.dateKey === dateKey) ?? null;
}

/** Everyone away between two dates, inclusive. */
export function offBetween(
  overview: LeaveOverview,
  fromKey: string,
  toKey: string,
): DayOverview[] {
  return overview.days.filter((d) => d.dateKey >= fromKey && d.dateKey <= toKey);
}

/** "7h 30m", or "—" for nothing. */
export function formatMinutes(total: number): string {
  if (total <= 0) return "—";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
