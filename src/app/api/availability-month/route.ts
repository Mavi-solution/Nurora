import { CLINICIAN_ROLES } from "@/lib/auth";
import { loadDaysOffRange } from "@/lib/business/days-off";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  generateSlots,
  pad,
  zonedTimeToUtc,
} from "@/lib/time";
import type { AvailabilityException, AvailabilityRule } from "@/lib/types";

const MONTH_KEY = /^\d{4}-\d{2}$/;

/** Two or fewer slots left reads as "almost gone" rather than "free". */
const LIMITED_AT = 2;

type Counsellor = {
  id: string;
  timezone: string;
  default_duration_minutes: number;
};

/**
 * One month of availability, as a colour per day.
 *
 * This exists so the date pickers can show the shape of the month
 * before anything is clicked. It answers the same question as
 * /api/slots — is this day bookable? — for thirty-odd days at once, and
 * deliberately shares generateSlots and loadDaysOffRange with it: a
 * calendar that paints a day green and a slot list that then offers
 * nothing is worse than no colour at all.
 *
 * Counts are NOT returned. The exact number of free slots on a day two
 * weeks out is not a decision the desk makes on, and returning it would
 * invite the calendar and the slot list to disagree over a booking made
 * in between.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const monthKey = searchParams.get("month");
  const counsellorId = searchParams.get("counsellor");
  const specialismId = searchParams.get("specialism");
  const language = searchParams.get("language");
  const duration = Number(searchParams.get("duration") ?? 0);

  if (!monthKey || !MONTH_KEY.test(monthKey)) {
    return NextResponse.json(
      { error: "month (YYYY-MM) is required" },
      { status: 400 },
    );
  }

  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstKey = `${monthKey}-01`;
  const lastKey = `${monthKey}-${pad(daysInMonth)}`;
  const allDays = Array.from(
    { length: daysInMonth },
    (_, i) => `${monthKey}-${pad(i + 1)}`,
  );

  /* ------------------------------------------------ who is being asked about */
  let query = supabase
    .from("profiles")
    .select("id, timezone, default_duration_minutes")
    .in("role", CLINICIAN_ROLES)
    .eq("is_active", true);

  if (counsellorId) query = query.eq("id", counsellorId);
  if (language) query = query.contains("languages", [language]);

  const { data: counsellorRows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let counsellors = (counsellorRows ?? []) as Counsellor[];

  if (specialismId) {
    const { data: matches } = await supabase
      .from("counsellor_specialisms")
      .select("counsellor_id")
      .eq("specialism_id", specialismId);
    const allowed = new Set((matches ?? []).map((m) => m.counsellor_id as string));
    counsellors = counsellors.filter((c) => allowed.has(c.id));
  }

  const daysOffOn = await loadDaysOffRange(firstKey, lastKey);

  // With nobody matching, the only thing still worth colouring is when
  // the clinic itself is shut — that is true regardless of the roster.
  if (counsellors.length === 0) {
    const status: Record<string, string> = {};
    for (const day of allDays) {
      if (daysOffOn(day).clinicClosed) status[day] = "closed";
    }
    return NextResponse.json({ status });
  }

  const ids = counsellors.map((c) => c.id);
  const anchorTz = counsellors[0].timezone;
  const nextMonthKey = addDaysToDateKey(lastKey, 1);
  const [ey, em, ed] = nextMonthKey.split("-").map(Number);
  const windowStart = zonedTimeToUtc(year, month, 1, 0, 0, anchorTz);
  const windowEnd = zonedTimeToUtc(ey, em, ed, 0, 0, anchorTz);

  const [{ data: rules }, { data: exceptions }, { data: busy }] =
    await Promise.all([
      supabase
        .from("availability_rules")
        .select("*")
        .in("counsellor_id", ids)
        .eq("is_active", true),
      supabase
        .from("availability_exceptions")
        .select("*")
        .in("counsellor_id", ids)
        .gte("on_date", firstKey)
        .lte("on_date", lastKey),
      supabase
        .from("appointments")
        .select("counsellor_id, starts_at, ends_at")
        .in("counsellor_id", ids)
        .neq("status", "cancelled")
        .gte("starts_at", windowStart.toISOString())
        .lt("starts_at", windowEnd.toISOString()),
    ]);

  const allRules = (rules ?? []) as AvailabilityRule[];
  const allExceptions = (exceptions ?? []) as AvailabilityException[];
  const allBusy = (busy ?? []) as {
    counsellor_id: string;
    starts_at: string;
    ends_at: string;
  }[];

  const now = new Date();
  const status: Record<string, string> = {};

  for (const day of allDays) {
    const daysOff = daysOffOn(day);

    if (daysOff.clinicClosed) {
      status[day] = "closed";
      continue;
    }

    let free = 0;
    let anyWorking = false;

    for (const c of counsellors) {
      if (daysOff.off.has(c.id)) continue;
      anyWorking = true;

      const [y, m, d] = day.split("-").map(Number);
      const todayKey = dateKeyInTimeZone(now, c.timezone);

      free += generateSlots({
        dateKey: day,
        timezone: c.timezone,
        durationMinutes: duration || c.default_duration_minutes || 60,
        stepMinutes: 30,
        rules: allRules.filter((r) => r.counsellor_id === c.id),
        exceptions: allExceptions.filter(
          (e) => e.counsellor_id === c.id && e.on_date === day,
        ),
        busy: allBusy.filter((b) => b.counsellor_id === c.id),
        notBefore:
          day === todayKey ? now : zonedTimeToUtc(y, m, d, 0, 0, c.timezone),
      }).length;
    }

    // Nobody working is "off" when it is the people who are away, and
    // simply "full" when they are here but have no hours left.
    if (!anyWorking) status[day] = "off";
    else if (free === 0) status[day] = "full";
    else if (free <= LIMITED_AT) status[day] = "limited";
    else status[day] = "open";
  }

  return NextResponse.json({ status });
}
