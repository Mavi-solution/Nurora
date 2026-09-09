"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Appointment } from "@/lib/types";
import {
  currentProfile,
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

const bookSchema = z.object({
  counsellorId: z.string().uuid(),
  clientId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(10).max(480),
  priceCents: z.coerce.number().int().min(0),
  title: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(200).optional().nullable(),
  meetingUrl: z.string().trim().max(400).optional().nullable(),
  clientNotes: z.string().trim().max(2000).optional().nullable(),
});

export async function bookAppointment(input: unknown) {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const profile = await currentProfile();
  if (!profile) return fail("Not signed in");

  const v = parsed.data;
  const supabase = await createClient();

  const startsAt = new Date(v.startsAt);
  const endsAt = new Date(startsAt.getTime() + v.durationMinutes * 60_000);

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      counsellor_id: v.counsellorId,
      client_id: v.clientId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      price_cents: v.priceCents,
      currency: profile.currency,
      title: v.title ?? "Counselling session",
      location: v.location || null,
      meeting_url: v.meetingUrl || null,
      client_notes: v.clientNotes || null,
      booked_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return fail(describeDbError(error.message, error.code));

  // Every booking gets an invoice up front so payments are never orphaned.
  await supabase.from("invoices").insert({
    appointment_id: data.id,
    counsellor_id: v.counsellorId,
    client_id: v.clientId,
    amount_cents: v.priceCents,
    currency: profile.currency,
    status: v.priceCents > 0 ? "unpaid" : "waived",
  });

  revalidatePath("/schedule");
  revalidatePath("/my");
  revalidatePath("/payments");
  return { ok: true as const, data: { id: data.id as string } };
}

/** Start the billed timer and flip the session to in-progress. */
export async function startSession(appointmentId: string) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: appt, error: apptError } = await supabase
    .from("appointments")
    .select("id, counsellor_id, status")
    .eq("id", appointmentId)
    .single();

  if (apptError) return fail(describeDbError(apptError.message, apptError.code));
  if (appt.status === "completed") return fail("This session is already completed.");
  if (appt.status === "cancelled") return fail("This session was cancelled.");
  if (!profileIsAdmin(profile) && appt.counsellor_id !== profile.id) {
    return fail("Only the assigned counsellor can start this session.");
  }

  const { error } = await supabase.from("time_entries").insert({
    appointment_id: appointmentId,
    counsellor_id: appt.counsellor_id,
    started_at: new Date().toISOString(),
    source: "timer",
  });

  if (error) return fail(describeDbError(error.message, error.code));

  await supabase
    .from("appointments")
    .update({ status: "in_progress" })
    .eq("id", appointmentId);

  revalidatePath("/schedule");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const };
}

/** Close the running timer, complete the session and bill it. */
export async function endSession(appointmentId: string) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("time_entries")
    .select("id, counsellor_id, started_at")
    .eq("appointment_id", appointmentId)
    .is("ended_at", null)
    .maybeSingle();

  if (!entry) return fail("No timer is running for this session.");
  if (!profileIsAdmin(profile) && entry.counsellor_id !== profile.id) {
    return fail("Only the assigned counsellor can end this session.");
  }

  const { error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", entry.id);

  if (error) return fail(describeDbError(error.message, error.code));

  await supabase
    .from("appointments")
    .update({ status: "completed" })
    .eq("id", appointmentId);

  // Stamp the invoice with what was actually tracked.
  const { data: tracked } = await supabase
    .from("time_entries")
    .select("duration_minutes")
    .eq("appointment_id", appointmentId)
    .not("ended_at", "is", null);

  const billedMinutes = (tracked ?? []).reduce(
    (sum, t) => sum + (t.duration_minutes ?? 0),
    0,
  );

  await supabase
    .from("invoices")
    .update({ billed_minutes: billedMinutes })
    .eq("appointment_id", appointmentId);

  revalidatePath("/schedule");
  revalidatePath("/payments");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const, data: { billedMinutes } };
}

export async function cancelAppointment(appointmentId: string, reason: string) {
  const profile = await currentProfile();
  if (!profile) return fail("Not signed in");

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason.trim() || null,
    })
    .eq("id", appointmentId);

  if (error) return fail(describeDbError(error.message, error.code));

  await supabase
    .from("invoices")
    .update({ status: "waived" })
    .eq("appointment_id", appointmentId)
    .eq("status", "unpaid");

  revalidatePath("/schedule");
  revalidatePath("/my");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const };
}

export async function rescheduleAppointment(
  appointmentId: string,
  startsAtIso: string,
  durationMinutes: number,
) {
  await currentProfile();
  const supabase = await createClient();

  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  const { error } = await supabase
    .from("appointments")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "scheduled",
    })
    .eq("id", appointmentId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const };
}

export async function setAppointmentStatus(
  appointmentId: string,
  status: Appointment["status"],
) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const };
}

export async function saveCounsellorNotes(appointmentId: string, notes: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("appointments")
    .update({ counsellor_notes: notes })
    .eq("id", appointmentId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const };
}

/** Manual time entry, for sessions run without the timer. */
export async function addManualTime(
  appointmentId: string,
  minutes: number,
  note: string,
) {
  const profile = await requireStaffProfile();
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
    return fail("Enter between 1 and 480 minutes.");
  }

  const supabase = await createClient();
  const { data: appt } = await supabase
    .from("appointments")
    .select("counsellor_id")
    .eq("id", appointmentId)
    .single();

  if (!appt) return fail("Session not found.");

  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - minutes * 60_000);

  const { error } = await supabase.from("time_entries").insert({
    appointment_id: appointmentId,
    counsellor_id: profileIsAdmin(profile) ? appt.counsellor_id : profile.id,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    source: "manual",
    note: note.trim() || null,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath(`/appointments/${appointmentId}`);
  revalidatePath("/timesheet");
  return { ok: true as const };
}
