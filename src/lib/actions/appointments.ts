"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canStartSession } from "@/lib/business/session-start";
import { notifyAppointmentEvent } from "@/lib/notify/appointment";
import { createClient } from "@/lib/supabase/server";
import type { Appointment } from "@/lib/types";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  profileIsClinical,
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
  channel: z.enum(["phone", "walk_in", "online", "referral"]).optional(),
  bookingNotes: z.string().trim().max(2000).optional().nullable(),
});

export async function bookAppointment(input: unknown) {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  // Clients no longer book for themselves — the desk books on their
  // behalf, so this is staff-only and mirrors the RLS policy.
  const profile = await requireStaffProfile();

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
      channel: v.channel ?? "phone",
      booking_notes: v.bookingNotes || null,
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

  // Confirm on WhatsApp (with email alongside). Deliberately awaited but
  // never allowed to fail the booking: the session IS booked either way,
  // and the desk is told separately whether the message got out.
  const notified = await notifyAppointmentEvent({
    appointmentId: data.id as string,
    event: "booked",
  });

  revalidatePath("/schedule");
  revalidatePath("/my");
  revalidatePath("/payments");
  revalidatePath("/book");
  return {
    ok: true as const,
    data: {
      id: data.id as string,
      whatsapp: notified.whatsapp,
      notifyNote: notified.note ?? null,
    },
  };
}

/** Start the billed timer and flip the session to in-progress. */
export async function startSession(appointmentId: string) {
  const profile = await requireStaffProfile();
  if (!profileIsClinical(profile)) {
    return fail("Only a counsellor can start a session.");
  }
  const supabase = await createClient();

  const { data: appt, error: apptError } = await supabase
    .from("appointments")
    .select(
      `id, counsellor_id, status, starts_at,
       counsellor:profiles!appointments_counsellor_id_fkey (full_name, timezone)`,
    )
    .eq("id", appointmentId)
    .single();

  if (apptError) return fail(describeDbError(apptError.message, apptError.code));
  if (!profileIsAdmin(profile) && appt.counsellor_id !== profile.id) {
    return fail("Only the assigned counsellor can start this session.");
  }

  const counsellor = (Array.isArray(appt.counsellor) ? appt.counsellor[0] : appt.counsellor) as
    | { full_name: string; timezone: string }
    | null;

  // The ASSIGNED counsellor's attendance is what matters — they deliver
  // the session, whoever happens to press the button.
  const { data: openShift } = await supabase
    .from("staff_shifts")
    .select("id")
    .eq("staff_id", appt.counsellor_id)
    .is("checked_out_at", null)
    .maybeSingle();

  const allowed = canStartSession({
    status: appt.status as string,
    startsAt: appt.starts_at as string,
    counsellorTimezone: counsellor?.timezone ?? "Asia/Kolkata",
    counsellorOnShift: Boolean(openShift),
    counsellorName: counsellor?.full_name,
    startedBySelf: appt.counsellor_id === profile.id,
  });

  if (!allowed.ok) return fail(allowed.reason);

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
  if (!profileIsClinical(profile)) {
    return fail("Only a counsellor can end a session.");
  }
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
  const profile = await requireStaffProfile();

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

  const notified = await notifyAppointmentEvent({
    appointmentId,
    event: "cancelled",
    reason: reason.trim() || null,
  });

  revalidatePath("/schedule");
  revalidatePath("/my");
  revalidatePath(`/appointments/${appointmentId}`);
  return {
    ok: true as const,
    data: { whatsapp: notified.whatsapp, notifyNote: notified.note ?? null },
  };
}

/**
 * Move a session to a new time.
 *
 * ARCHITECTURE.md rule 7 (MUST MATCH): this does NOT edit the original
 * row's date/time. It creates a new appointment and marks the original
 * 'moved', pointing at its successor — so the fact that the earlier slot
 * was booked, and then moved, survives in the record.
 *
 * Order matters. The original is cancelled FIRST, because the overlap
 * exclusion constraint covers only live bookings; cancelling frees the
 * old slot so a session can be nudged half an hour without colliding
 * with its own former self.
 */
export async function rescheduleAppointment(
  appointmentId: string,
  startsAtIso: string,
  durationMinutes: number,
  reason?: string,
) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: original, error: readError } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .maybeSingle();

  if (readError) return fail(describeDbError(readError.message, readError.code));
  if (!original) return fail("Session not found.");

  if (original.reschedule_status === "moved") {
    return fail("This session was already moved. Open the new one instead.");
  }
  if (original.status === "completed") {
    return fail("A completed session cannot be moved.");
  }

  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  // 1. Free the old slot.
  const { error: cancelError } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason?.trim() || "Rescheduled",
    })
    .eq("id", appointmentId);

  if (cancelError) return fail(describeDbError(cancelError.message, cancelError.code));

  // 2. Book the replacement, carrying the booking's details forward.
  const { data: created, error: insertError } = await supabase
    .from("appointments")
    .insert({
      counsellor_id: original.counsellor_id,
      client_id: original.client_id,
      service_id: original.service_id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "scheduled",
      title: original.title,
      location: original.location,
      meeting_url: original.meeting_url,
      client_notes: original.client_notes,
      channel: original.channel,
      booking_notes: original.booking_notes,
      price_cents: original.price_cents,
      currency: original.currency,
      booked_by: profile.id,
      rescheduled_from_id: appointmentId,
    })
    .select("id")
    .single();

  if (insertError) {
    // Put the original back rather than stranding the client with a
    // cancelled session and no replacement.
    await supabase
      .from("appointments")
      .update({
        status: original.status,
        cancelled_by: original.cancelled_by,
        cancelled_at: original.cancelled_at,
        cancel_reason: original.cancel_reason,
      })
      .eq("id", appointmentId);

    return fail(describeDbError(insertError.message, insertError.code));
  }

  // 3. Link the original to its successor.
  await supabase
    .from("appointments")
    .update({ reschedule_status: "moved", rescheduled_to_id: created.id })
    .eq("id", appointmentId);

  // 4. The money follows the session. Moving the invoice rather than
  //    raising a second one keeps any advance already taken attached to
  //    the booking it was collected for, and leaves no stray bill
  //    against a session that never happened.
  await supabase
    .from("invoices")
    .update({ appointment_id: created.id })
    .eq("appointment_id", appointmentId);

  const notified = await notifyAppointmentEvent({
    appointmentId: created.id as string,
    event: "rescheduled",
  });

  revalidatePath("/schedule");
  revalidatePath("/my");
  revalidatePath("/payments");
  revalidatePath(`/appointments/${appointmentId}`);
  revalidatePath(`/appointments/${created.id}`);

  return {
    ok: true as const,
    data: {
      id: created.id as string,
      whatsapp: notified.whatsapp,
      notifyNote: notified.note ?? null,
    },
  };
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

/**
 * Session notes are clinical records: they live in their own table so
 * reception staff, who must read appointment rows to run the diary,
 * cannot read them.
 */
export async function saveSessionNote(appointmentId: string, body: string) {
  const profile = await requireStaffProfile();
  if (!profileIsClinical(profile)) {
    return fail("Only the treating counsellor can write session notes.");
  }

  const supabase = await createClient();

  const { data: appt } = await supabase
    .from("appointments")
    .select("counsellor_id")
    .eq("id", appointmentId)
    .single();

  if (!appt) return fail("Session not found.");
  if (!profileIsAdmin(profile) && appt.counsellor_id !== profile.id) {
    return fail("Only the treating counsellor can write these notes.");
  }

  const { error } = await supabase.from("session_notes").upsert(
    {
      appointment_id: appointmentId,
      counsellor_id: appt.counsellor_id,
      body,
    },
    { onConflict: "appointment_id" },
  );

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

/**
 * Resend the confirmation by hand. Reception needs this when a client
 * gives a corrected number after the booking, or when Twilio was down
 * at the moment the session was booked.
 */
export async function resendAppointmentConfirmation(appointmentId: string) {
  await requireStaffProfile();

  const supabase = await createClient();
  const { data: appt } = await supabase
    .from("appointments")
    .select("id, status")
    .eq("id", appointmentId)
    .maybeSingle();

  if (!appt) return fail("Session not found.");

  const result = await notifyAppointmentEvent({
    appointmentId,
    event: appt.status === "cancelled" ? "cancelled" : "booked",
    // The counsellor is standing right there — only the client needs it.
    skipCounsellor: true,
  });

  if (!result.delivered) {
    return fail(
      result.note
        ? `Nothing was sent — ${result.note}`
        : "Nothing was sent. Check the client has a phone number or email on file.",
    );
  }

  revalidatePath(`/appointments/${appointmentId}`);
  return {
    ok: true as const,
    data: { whatsapp: result.whatsapp },
  };
}
