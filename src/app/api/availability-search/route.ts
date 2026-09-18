import { CLINICIAN_ROLES } from "@/lib/auth";
import { loadDaysOffRange } from "@/lib/business/days-off";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  generateSlots,
  zonedTimeToUtc,
} from "@/lib/time";
import type { AvailabilityException, AvailabilityRule } from "@/lib/types";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** How many days ahead to look when the chosen date has nothing free. */
const LOOKAHEAD_DAYS = 14;

type Counsellor = {
  id: string;
  full_name: string;
  timezone: string;
  default_duration_minutes: number;
  default_session_fee_cents: number;
  currency: string;
  languages: string[];
};

/**
 * Open slots across every counsellor who matches the caller's needs.
 *
 * The booking desk asks "who can see someone with anxiety, in Tamil, on
 * Thursday?" — so the search is by specialism and language first, and
 * only then by time. When the chosen day is full it reports the next few
 * days that are not, rather than a dead end on the phone.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const dateKey = searchParams.get("date");
  const specialismId = searchParams.get("specialism");
  const language = searchParams.get("language");
  const counsellorId = searchParams.get("counsellor");
  const duration = Number(searchParams.get("duration") ?? 0);

  if (!dateKey || !DATE_KEY.test(dateKey)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }

  // ---------------------------------------------------- who can we offer?
  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, timezone, default_duration_minutes, default_session_fee_cents, currency, languages",
    )
    .in("role", CLINICIAN_ROLES)
    .eq("is_active", true)
    .order("full_name");

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

  if (counsellors.length === 0) {
    return NextResponse.json({ slots: [], counsellors: [], nextDays: [] });
  }

  const ids = counsellors.map((c) => c.id);

  // Availability rules and bookings are fetched once for the whole window,
  // then sliced per day — far cheaper than a query per counsellor per day.
  const windowEndKey = addDaysToDateKey(dateKey, LOOKAHEAD_DAYS);
  const anchorTz = counsellors[0].timezone;
  const [wy, wm, wd] = dateKey.split("-").map(Number);
  const [ey, em, ed] = windowEndKey.split("-").map(Number);
  const windowStart = zonedTimeToUtc(wy, wm, wd, 0, 0, anchorTz);
  const windowEnd = zonedTimeToUtc(ey, em, ed, 0, 0, anchorTz);

  const [{ data: rules }, { data: exceptions }, { data: busy }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("*")
      .in("counsellor_id", ids)
      .eq("is_active", true),
    supabase
      .from("availability_exceptions")
      .select("*")
      .in("counsellor_id", ids)
      .gte("on_date", dateKey)
      .lte("on_date", windowEndKey),
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

  /*
   * Week-offs, leave, clinic holidays and closed weekdays, for every
   * day in the lookahead window.
   *
   * This module imported loadDaysOff and never called it, which is why
   * the booking desk kept offering counsellors who were on a week-off —
   * and why the desk could then book one, since bookAppointment trusted
   * the slot it was handed. Both halves are fixed: the search stops
   * offering the slot, and the action refuses it even if an old page
   * asks for one anyway.
   */
  const daysOffOn = await loadDaysOffRange(dateKey, windowEndKey);

  function slotsFor(counsellor: Counsellor, day: string) {
    const todayKey = dateKeyInTimeZone(now, counsellor.timezone);
    const [y, m, d] = day.split("-").map(Number);
    const daysOff = daysOffOn(day);

    return generateSlots({
      dateKey: day,
      timezone: counsellor.timezone,
      durationMinutes: duration || counsellor.default_duration_minutes || 60,
      stepMinutes: 30,
      rules: allRules.filter((r) => r.counsellor_id === counsellor.id),
      exceptions: allExceptions.filter(
        (e) => e.counsellor_id === counsellor.id && e.on_date === day,
      ),
      busy: allBusy.filter((b) => b.counsellor_id === counsellor.id),
      dayOff: daysOff.clinicClosed || daysOff.off.has(counsellor.id),
      notBefore:
        day === todayKey
          ? now
          : zonedTimeToUtc(y, m, d, 0, 0, counsellor.timezone),
    });
  }

  const slots = counsellors.flatMap((counsellor) =>
    slotsFor(counsellor, dateKey).map((slot) => ({
      counsellorId: counsellor.id,
      counsellorName: counsellor.full_name,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      label: slot.label,
      durationMinutes: duration || counsellor.default_duration_minutes || 60,
      feeCents: counsellor.default_session_fee_cents,
      currency: counsellor.currency,
    })),
  );

  slots.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.counsellorName.localeCompare(b.counsellorName),
  );

  // Nothing today? Say when there IS something, so the caller can be
  // offered an alternative without hanging up.
  const nextDays: { date: string; count: number }[] = [];
  if (slots.length === 0) {
    for (let i = 1; i <= LOOKAHEAD_DAYS && nextDays.length < 5; i += 1) {
      const day = addDaysToDateKey(dateKey, i);
      const count = counsellors.reduce(
        (total, c) => total + slotsFor(c, day).length,
        0,
      );
      if (count > 0) nextDays.push({ date: day, count });
    }
  }

  /*
   * When the day is empty because somebody is away rather than merely
   * busy, say so. "Nothing free on Friday", "Anisha is on a week-off"
   * and "we are closed on Sundays" send the desk down three completely
   * different paths on the phone.
   *
   * A named counsellor gets THEIR reason; a search across the whole
   * roster can only speak for the clinic, since one person's week-off
   * says nothing about everyone else's.
   */
  const chosen = daysOffOn(dateKey);
  const closedReason = counsellorId
    ? chosen.reasonFor(counsellorId)
    : chosen.holiday;

  return NextResponse.json({
    slots,
    closedReason,
    nextDays,
    counsellors: counsellors.map((c) => ({
      id: c.id,
      full_name: c.full_name,
      languages: c.languages,
      timezone: c.timezone,
      default_duration_minutes: c.default_duration_minutes,
      default_session_fee_cents: c.default_session_fee_cents,
      currency: c.currency,
    })),
  });
}
