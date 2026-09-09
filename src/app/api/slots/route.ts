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

/** Open slots for one counsellor on one date. Used by the booking dialogs. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const counsellorId = searchParams.get("counsellor");
  const dateKey = searchParams.get("date");
  const duration = Number(searchParams.get("duration") ?? 60);

  if (!counsellorId || !dateKey || !DATE_KEY.test(dateKey)) {
    return NextResponse.json(
      { error: "counsellor and date (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  if (!Number.isFinite(duration) || duration < 10 || duration > 480) {
    return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
  }

  const { data: counsellor } = await supabase
    .from("profiles")
    .select("id, timezone")
    .eq("id", counsellorId)
    .eq("role", "counsellor")
    .maybeSingle();

  if (!counsellor) {
    return NextResponse.json({ error: "Counsellor not found" }, { status: 404 });
  }

  const tz = counsellor.timezone as string;
  const [y, m, d] = dateKey.split("-").map(Number);
  const [ny, nm, nd] = addDaysToDateKey(dateKey, 1).split("-").map(Number);
  const dayStart = zonedTimeToUtc(y, m, d, 0, 0, tz);
  const dayEnd = zonedTimeToUtc(ny, nm, nd, 0, 0, tz);

  const [{ data: rules }, { data: exceptions }, { data: busy }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("*")
      .eq("counsellor_id", counsellorId)
      .eq("is_active", true),
    supabase
      .from("availability_exceptions")
      .select("*")
      .eq("counsellor_id", counsellorId)
      .eq("on_date", dateKey),
    supabase
      .from("appointments")
      .select("starts_at, ends_at")
      .eq("counsellor_id", counsellorId)
      .neq("status", "cancelled")
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString()),
  ]);

  const todayKey = dateKeyInTimeZone(new Date(), tz);

  const slots = generateSlots({
    dateKey,
    timezone: tz,
    durationMinutes: duration,
    stepMinutes: 30,
    rules: (rules ?? []) as AvailabilityRule[],
    exceptions: (exceptions ?? []) as AvailabilityException[],
    busy: busy ?? [],
    notBefore: dateKey === todayKey ? new Date() : dayStart,
  });

  return NextResponse.json({ slots, timezone: tz });
}
