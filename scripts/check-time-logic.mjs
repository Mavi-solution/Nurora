/**
 * Sanity checks for the timezone-sensitive logic: slot generation and the
 * 3-day reminder window. Node strips the TypeScript types on import.
 *
 *   node scripts/check-time-logic.mjs
 */
import * as time from "../src/lib/time.ts";

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL  ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

/* ---------------------------------------------------- zonedTimeToUtc */

// India is UTC+5:30 year round.
check(
  "IST 09:00 -> 03:30Z",
  time.zonedTimeToUtc(2026, 9, 8, 9, 0, "Asia/Kolkata").toISOString(),
  "2026-09-08T03:30:00.000Z",
);

// New York in summer is UTC-4 (EDT).
check(
  "EDT 09:00 -> 13:00Z",
  time.zonedTimeToUtc(2026, 7, 15, 9, 0, "America/New_York").toISOString(),
  "2026-07-15T13:00:00.000Z",
);

// New York in winter is UTC-5 (EST) — same wall clock, different instant.
check(
  "EST 09:00 -> 14:00Z",
  time.zonedTimeToUtc(2026, 1, 15, 9, 0, "America/New_York").toISOString(),
  "2026-01-15T14:00:00.000Z",
);

// The day US DST ends (1 Nov 2026): a 09:00 slot must still be 09:00 local.
check(
  "DST-end day 09:00 stays 09:00 local",
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time.zonedTimeToUtc(2026, 11, 1, 9, 0, "America/New_York")),
  "09:00",
);

/* ------------------------------------------------------- date helpers */

check("dateKey weekday: 2026-09-08 is Tuesday", time.weekdayOfDateKey("2026-09-08"), 2);
check("addDays across month end", time.addDaysToDateKey("2026-09-30", 1), "2026-10-01");
check("addDays across year end", time.addDaysToDateKey("2026-12-31", 1), "2027-01-01");
check("addDays backwards", time.addDaysToDateKey("2026-03-01", -1), "2026-02-28");
check("timeToMinutes 09:30", time.timeToMinutes("09:30"), 570);
check("minutesToTime 570", time.minutesToTime(570), "09:30");

/* ----------------------------------------------------- generateSlots */

const rules = [
  { id: "r1", counsellor_id: "c1", weekday: 2, start_time: "09:00", end_time: "12:00", is_active: true },
];

// 2026-09-08 is a Tuesday (weekday 2). 09:00-12:00 with 60-min sessions
// on a 60-min step = 09:00, 10:00, 11:00.
const basic = time.generateSlots({
  dateKey: "2026-09-08",
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [],
  busy: [],
  notBefore: new Date("2020-01-01T00:00:00Z"),
});
check("3 slots in a 3-hour window", basic.map((s) => s.label), ["09:00", "10:00", "11:00"]);
check(
  "first slot is 03:30Z (09:00 IST)",
  basic[0].startsAt,
  "2026-09-08T03:30:00.000Z",
);

// A booking at 10:00 must remove exactly that slot.
const withBusy = time.generateSlots({
  dateKey: "2026-09-08",
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [],
  busy: [{ starts_at: "2026-09-08T04:30:00.000Z", ends_at: "2026-09-08T05:30:00.000Z" }],
  notBefore: new Date("2020-01-01T00:00:00Z"),
});
check("busy slot removed", withBusy.map((s) => s.label), ["09:00", "11:00"]);

// A partial-day block 10:00-11:00 removes the 10:00 slot too.
const withBlock = time.generateSlots({
  dateKey: "2026-09-08",
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [
    { id: "e1", counsellor_id: "c1", on_date: "2026-09-08", is_available: false, start_time: "10:00", end_time: "11:00", reason: null, created_at: "" },
  ],
  busy: [],
  notBefore: new Date("2020-01-01T00:00:00Z"),
});
check("partial block removed", withBlock.map((s) => s.label), ["09:00", "11:00"]);

// A whole-day block clears everything.
const wholeDay = time.generateSlots({
  dateKey: "2026-09-08",
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [
    { id: "e2", counsellor_id: "c1", on_date: "2026-09-08", is_available: false, start_time: null, end_time: null, reason: "Holiday", created_at: "" },
  ],
  busy: [],
  notBefore: new Date("2020-01-01T00:00:00Z"),
});
check("whole-day block clears slots", wholeDay.length, 0);

// Extra hours on a date add slots outside the weekly rule.
const extra = time.generateSlots({
  dateKey: "2026-09-08",
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [
    { id: "e3", counsellor_id: "c1", on_date: "2026-09-08", is_available: true, start_time: "18:00", end_time: "20:00", reason: null, created_at: "" },
  ],
  busy: [],
  notBefore: new Date("2020-01-01T00:00:00Z"),
});
check("extra hours added", extra.map((s) => s.label), ["09:00", "10:00", "11:00", "18:00", "19:00"]);

// Slots before `notBefore` are dropped (today's past slots).
const trimmed = time.generateSlots({
  dateKey: "2026-09-08",
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [],
  busy: [],
  notBefore: new Date("2026-09-08T05:00:00.000Z"), // 10:30 IST
});
check("past slots trimmed", trimmed.map((s) => s.label), ["11:00"]);

// A wrong weekday yields nothing.
const wrongDay = time.generateSlots({
  dateKey: "2026-09-09", // Wednesday
  timezone: "Asia/Kolkata",
  durationMinutes: 60,
  stepMinutes: 60,
  rules,
  exceptions: [],
  busy: [],
  notBefore: new Date("2020-01-01T00:00:00Z"),
});
check("no slots on a non-working weekday", wrongDay.length, 0);

/* ------------------------------------------- 3-day reminder arithmetic */

function daysBetween(fromKey, toKey) {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

check("3 days ahead", daysBetween("2026-09-08", "2026-09-11"), 3);
check("3 days across a month boundary", daysBetween("2026-09-29", "2026-10-02"), 3);
check("3 days across a year boundary", daysBetween("2026-12-30", "2027-01-02"), 3);
check("not 3 days", daysBetween("2026-09-08", "2026-09-12"), 4);

// A late-evening IST session is still "3 days out" by local date, even
// though its UTC date is the day before.
const tz = "Asia/Kolkata";
const nowIst = new Date("2026-09-08T18:30:00.000Z"); // 2026-09-09 00:00 IST
check(
  "IST date rolls over before UTC",
  time.dateKeyInTimeZone(nowIst, tz),
  "2026-09-09",
);
check(
  "session at 00:30 IST reads as its local date",
  time.dateKeyInTimeZone(new Date("2026-09-11T19:00:00.000Z"), tz),
  "2026-09-12",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
