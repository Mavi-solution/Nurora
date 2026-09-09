import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  generateSlots,
  zonedTimeToUtc,
} from "@/lib/time";
import type {
  AppointmentRow,
  AvailabilityException,
  AvailabilityRule,
  ClientSummary,
  CounsellorSummary,
  Invoice,
  ScheduleLane,
  TimeEntry,
} from "@/lib/types";
import { ScheduleBoard } from "./schedule-board";

export const metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ date?: string; counsellor?: string }>;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();

  const tz = profile.timezone;
  const todayKey = dateKeyInTimeZone(new Date(), tz);
  const dateKey =
    params.date && DATE_KEY.test(params.date) ? params.date : todayKey;
  const counsellorFilter = params.counsellor ?? "all";

  // Day boundaries as real instants, derived from the next date key so a
  // DST shift can never make the window 23 or 25 hours long.
  const [y, m, d] = dateKey.split("-").map(Number);
  const [ny, nm, nd] = addDaysToDateKey(dateKey, 1).split("-").map(Number);
  const dayStart = zonedTimeToUtc(y, m, d, 0, 0, tz);
  const dayEnd = zonedTimeToUtc(ny, nm, nd, 0, 0, tz);

  const [
    { data: counsellorRows },
    { data: appointmentRows },
    { data: ruleRows },
    { data: exceptionRows },
    { data: openShiftRows },
    { data: clientRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency",
      )
      .eq("role", "counsellor")
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("appointments")
      .select("*, client:clients(id, full_name, age, email, phone, user_id)")
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
      .order("starts_at"),
    supabase.from("availability_rules").select("*").eq("is_active", true),
    supabase
      .from("availability_exceptions")
      .select("*")
      .eq("on_date", dateKey),
    supabase
      .from("staff_shifts")
      .select("id, staff_id, checked_in_at")
      .is("checked_out_at", null),
    supabase
      .from("clients")
      .select("id, full_name, age, email, phone, user_id")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const counsellors = (counsellorRows ?? []) as CounsellorSummary[];
  const appointments = (appointmentRows ?? []) as AppointmentRow[];
  const rules = (ruleRows ?? []) as AvailabilityRule[];
  const exceptions = (exceptionRows ?? []) as AvailabilityException[];
  const clients = (clientRows ?? []) as ClientSummary[];

  // Timers and invoices are fetched separately — PostgREST returns
  // embedded one-to-one rows as arrays, which is awkward to type.
  const appointmentIds = appointments.map((a) => a.id);
  const [{ data: entryRows }, { data: invoiceRows }] =
    appointmentIds.length > 0
      ? await Promise.all([
          supabase.from("time_entries").select("*").in("appointment_id", appointmentIds),
          supabase.from("invoices").select("*").in("appointment_id", appointmentIds),
        ])
      : [{ data: [] as TimeEntry[] }, { data: [] as Invoice[] }];

  const entriesByAppointment = new Map<string, TimeEntry[]>();
  for (const entry of (entryRows ?? []) as TimeEntry[]) {
    const list = entriesByAppointment.get(entry.appointment_id) ?? [];
    list.push(entry);
    entriesByAppointment.set(entry.appointment_id, list);
  }

  const invoiceByAppointment = new Map<string, Invoice>();
  for (const invoice of (invoiceRows ?? []) as Invoice[]) {
    invoiceByAppointment.set(invoice.appointment_id, invoice);
  }

  const onShift = new Set((openShiftRows ?? []).map((s) => s.staff_id as string));
  const now = new Date();

  const lanes: ScheduleLane[] = counsellors
    .filter((c) => counsellorFilter === "all" || c.id === counsellorFilter)
    .map((counsellor) => {
      const mine = appointments
        .filter((a) => a.counsellor_id === counsellor.id)
        .map((a) => ({
          ...a,
          counsellor,
          time_entries: entriesByAppointment.get(a.id) ?? [],
          invoice: invoiceByAppointment.get(a.id) ?? null,
        }));

      const busy = mine
        .filter((a) => a.status !== "cancelled")
        .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at }));

      const openSlots = generateSlots({
        dateKey,
        timezone: counsellor.timezone,
        durationMinutes: counsellor.default_duration_minutes || 60,
        stepMinutes: 60,
        rules: rules.filter((r) => r.counsellor_id === counsellor.id),
        exceptions: exceptions.filter((e) => e.counsellor_id === counsellor.id),
        busy,
        // Past slots stay visible on past dates; only today is trimmed.
        notBefore: dateKey === todayKey ? now : dayStart,
      });

      const running = mine.find((a) =>
        a.time_entries.some((e) => e.ended_at === null),
      );

      return {
        counsellor,
        appointments: mine,
        openSlots,
        isOnShift: onShift.has(counsellor.id),
        activeAppointmentId: running?.id ?? null,
      };
    });

  const myOpenShift = (openShiftRows ?? []).find(
    (s) => s.staff_id === profile.id,
  );

  return (
    <ScheduleBoard
      profile={profile}
      dateKey={dateKey}
      todayKey={todayKey}
      counsellors={counsellors}
      counsellorFilter={counsellorFilter}
      lanes={lanes}
      clients={clients}
      checkedInAt={(myOpenShift?.checked_in_at as string) ?? null}
    />
  );
}
