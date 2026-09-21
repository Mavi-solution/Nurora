/**
 * Unit tests for the practice-wide leave arithmetic.
 *
 * The number that matters is hours, not rows. A week-off on a day
 * somebody was not working anyway costs the practice nothing, and a
 * screen that counted it the same as a full day would tell an admin
 * they were short-staffed when they were not.
 *
 *   node scripts/check-leave-overview.mjs
 */
import {
  formatMinutes,
  minutesOnWeekday,
  summariseMonth,
  weeklyMinutes,
} from "../src/lib/business/leave-overview.ts";
import { timeToMinutes, weekdayOfDateKey } from "../src/lib/time.ts";
import { weekOffQuotaForMonth } from "../src/lib/business/weekoff.ts";

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const rule = (staff, weekday, start, end, is_active = true) =>
  ({ counsellor_id: staff, weekday, start_time: start, end_time: end, is_active });

// September 2026: the 1st is a Tuesday. The 9th is a Wednesday,
// the 10th a Thursday, the 13th a Sunday.
const YEAR = 2026, MONTH = 9;

const staff = [
  { id: "a", full_name: "Anisha" },
  { id: "b", full_name: "Shefrin" },
];

// Anisha works Mon-Fri 9-6. Shefrin works Wed and Thu only.
const rules = [
  ...[1, 2, 3, 4, 5].map((d) => rule("a", d, "09:00", "18:00")),
  rule("b", 3, "10:00", "13:00"),
  rule("b", 4, "10:00", "16:00"),
];

/* ------------------------------------------------------- the hours */

step("Scheduled minutes come from the working week");
ok("Anisha on a Monday is 9 hours", minutesOnWeekday(rules, "a", 1) === 540);
ok("Anisha on a Sunday is nothing", minutesOnWeekday(rules, "a", 0) === 0);
ok("Shefrin on a Wednesday is 3 hours", minutesOnWeekday(rules, "b", 3) === 180);
ok("Anisha's week is 45 hours", weeklyMinutes(rules, "a") === 45 * 60);
ok("Shefrin's week is 9 hours", weeklyMinutes(rules, "b") === 9 * 60);

/*
 * Two rules describing one stretch are one stretch. Adding them would
 * invent hours nobody ever worked — the availability editor rejects
 * overlaps now, but rows predating that are still in the database.
 */
step("Overlapping windows are not counted twice");
const overlapping = [rule("x", 1, "09:00", "13:00"), rule("x", 1, "12:00", "17:00")];
ok("09:00-13:00 plus 12:00-17:00 is 8 hours, not 9",
  minutesOnWeekday(overlapping, "x", 1) === 480,
  String(minutesOnWeekday(overlapping, "x", 1)));
ok("a window wholly inside another adds nothing",
  minutesOnWeekday([rule("x", 1, "09:00", "18:00"), rule("x", 1, "10:00", "12:00")], "x", 1) === 540);
ok("an inactive rule is not working time",
  minutesOnWeekday([rule("x", 1, "09:00", "18:00", false)], "x", 1) === 0);

/* ---------------------------------------------------- the overview */

const base = {
  year: YEAR,
  month: MONTH,
  quota: weekOffQuotaForMonth(YEAR, MONTH),
  staff,
  rules,
  weekOffs: [],
  leaves: [],
  holidays: [],
};

/*
 * leave-overview.ts re-states timeToMinutes and weekdayOfDateKey so it
 * can be loaded without the app's module alias. These assertions are
 * what stop the copies drifting from the originals.
 */
step("The mirrored time helpers still agree with lib/time.ts");
ok("minutes on a weekday match timeToMinutes",
  minutesOnWeekday([rule("t", 1, "09:15", "17:45")], "t", 1) ===
    timeToMinutes("17:45") - timeToMinutes("09:15"));
for (const [dateKey, expected] of [
  ["2026-09-01", 2], ["2026-09-09", 3], ["2026-09-13", 0], ["2026-09-30", 3],
]) {
  ok(`weekday of ${dateKey} is ${expected}`, weekdayOfDateKey(dateKey) === expected,
    String(weekdayOfDateKey(dateKey)));
}

step("A week-off costs the hours that were actually scheduled");
const weekday = summariseMonth({
  ...base,
  weekOffs: [{ id: "1", staff_id: "a", on_date: "2026-09-09" }],
});
ok("Anisha loses her 9 hours on the Wednesday",
  weekday.totals.minutesLost === 540, String(weekday.totals.minutesLost));
ok("counted as one person-day", weekday.totals.absenceDays === 1);

step("A day off that nobody was working costs nothing");
const sunday = summariseMonth({
  ...base,
  weekOffs: [{ id: "1", staff_id: "a", on_date: "2026-09-13" }],
});
ok("Sunday costs no hours", sunday.totals.minutesLost === 0);
ok("but is still shown as a day off", sunday.totals.absenceDays === 1);

step("A clinic holiday is a closure, not an absence anyone caused");
const holiday = summariseMonth({
  ...base,
  weekOffs: [{ id: "1", staff_id: "a", on_date: "2026-09-09" }],
  holidays: [{ id: "h", on_date: "2026-09-09", name: "Onam" }],
});
ok("no hours are charged against the week-off", holiday.totals.minutesLost === 0);
ok("the holiday is reported separately", holiday.totals.holidayDays === 1);

step("One person away once, however it was recorded");
const both = summariseMonth({
  ...base,
  weekOffs: [{ id: "1", staff_id: "a", on_date: "2026-09-09" }],
  leaves: [{ id: "2", staff_id: "a", on_date: "2026-09-09", kind: "sick", approved_at: null }],
});
ok("a week-off and leave on one day is one absence", both.totals.absenceDays === 1);
ok("and charged once", both.totals.minutesLost === 540, String(both.totals.minutesLost));

step("Leave waiting on an admin is counted and flagged");
const pending = summariseMonth({
  ...base,
  leaves: [
    { id: "1", staff_id: "b", on_date: "2026-09-09", kind: "sick", approved_at: null },
    { id: "2", staff_id: "b", on_date: "2026-09-10", kind: "planned", approved_at: "2026-09-01" },
  ],
});
ok("both days are absences", pending.totals.absenceDays === 2);
ok("one is awaiting approval", pending.totals.pendingLeave === 1);
ok("hours are Wednesday's 3 plus Thursday's 6",
  pending.totals.minutesLost === 180 + 360, String(pending.totals.minutesLost));

step("Per person, the allowance and what is left");
const perPerson = summariseMonth({
  ...base,
  weekOffs: [
    { id: "1", staff_id: "a", on_date: "2026-09-09" },
    { id: "2", staff_id: "a", on_date: "2026-09-16" },
  ],
});
const anisha = perPerson.people.find((p) => p.staffId === "a");
ok("two week-offs taken", anisha.weekOffsTaken === 2);
ok("remaining is the quota less what was taken",
  anisha.remaining === anisha.quota - 2, `${anisha.remaining} of ${anisha.quota}`);
ok("September 2026 allows five", anisha.quota === 5, String(anisha.quota));
const shefrin = perPerson.people.find((p) => p.staffId === "b");
ok("someone with no days off still appears", Boolean(shefrin));
ok("with nothing lost", shefrin.minutesLost === 0);

step("Rows for people who are not on the list are ignored");
const stranger = summariseMonth({
  ...base,
  weekOffs: [{ id: "1", staff_id: "gone", on_date: "2026-09-09" }],
});
ok("a departed member's rows do not appear", stranger.totals.absenceDays === 0);

step("Every day of the month is represented");
ok("September has 30 day rows", summariseMonth(base).days.length === 30);

step("Hours read as hours");
ok("540 is 9h", formatMinutes(540) === "9h", formatMinutes(540));
ok("450 is 7h 30m", formatMinutes(450) === "7h 30m", formatMinutes(450));
ok("45 is 45m", formatMinutes(45) === "45m", formatMinutes(45));
ok("nothing is an em dash", formatMinutes(0) === "—");

console.log(failures === 0 ? "\n✓ All leave-overview checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
