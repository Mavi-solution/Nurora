/**
 * Week-off quota — ARCHITECTURE.md rule 1, marked MUST MATCH.
 *
 * A month is NOT four Sun–Sat weeks. It is split into rows that each END
 * on a Saturday, and a stub row of three days or fewer at either end
 * merges into its neighbour. The monthly paid-leave quota is however
 * many rows survive that merge — 4 in some months, 5 in others.
 *
 * The handoff notes that a previous backend got this wrong by
 * re-deriving it from scratch. The two months it names are the
 * acceptance test and are asserted in scripts/check-business-rules.mjs:
 *
 *   August 2026    -> 4     September 2026 -> 5
 */

export type MonthWeek = {
  /** 1-based day of month this row starts on. */
  startDay: number;
  /** 1-based day of month this row ends on. */
  endDay: number;
  days: number;
};

/** Stub rows of this length or shorter merge into their neighbour. */
const STUB_DAYS = 3;

const SATURDAY = 6;

export function daysInMonth(year: number, month: number): number {
  // month is 1-based; day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The rows for one month. `month` is 1-based (1 = January), matching how
 * the rest of the app passes month keys around.
 */
export function getMonthWeeks(year: number, month: number): MonthWeek[] {
  const total = daysInMonth(year, month);
  const rows: MonthWeek[] = [];

  let startDay = 1;

  for (let day = 1; day <= total; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    // Close the row on every Saturday, and again at the month end for a
    // trailing stretch that never reached one.
    if (weekday === SATURDAY || day === total) {
      rows.push({ startDay, endDay: day, days: day - startDay + 1 });
      startDay = day + 1;
    }
  }

  return mergeStubs(rows);
}

/**
 * The paid week-off allowance for a month. This is a computed number,
 * never a stored one — storing it is what makes it drift.
 */
export function weekOffQuotaForMonth(year: number, month: number): number {
  return getMonthWeeks(year, month).length;
}

/** Which row a given day falls in, or null if the day is out of range. */
export function weekIndexForDay(
  year: number,
  month: number,
  day: number,
): number | null {
  const weeks = getMonthWeeks(year, month);
  const index = weeks.findIndex((w) => day >= w.startDay && day <= w.endDay);
  return index === -1 ? null : index;
}

/**
 * Merge a short leading row forward and a short trailing row backward.
 *
 * The leading merge runs first and can change which row is last, so the
 * trailing check is made against the already-merged array rather than
 * against the original indices.
 */
function mergeStubs(rows: MonthWeek[]): MonthWeek[] {
  if (rows.length < 2) return rows;

  const merged = rows.map((r) => ({ ...r }));

  if (merged[0].days <= STUB_DAYS) {
    const [first, second] = merged;
    merged.splice(0, 2, {
      startDay: first.startDay,
      endDay: second.endDay,
      days: first.days + second.days,
    });
  }

  const lastIndex = merged.length - 1;
  if (merged.length >= 2 && merged[lastIndex].days <= STUB_DAYS) {
    const previous = merged[lastIndex - 1];
    const last = merged[lastIndex];
    merged.splice(lastIndex - 1, 2, {
      startDay: previous.startDay,
      endDay: last.endDay,
      days: previous.days + last.days,
    });
  }

  return merged;
}
