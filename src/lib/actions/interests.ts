"use server";

import { revalidatePath } from "next/cache";
import { advanceRequirement } from "@/lib/business/billing";
import { bookingFormSchema } from "@/lib/business/booking-form";
import { billingSettingsFromClinic } from "@/lib/business/clinic-settings";
import { toE164 } from "@/lib/notify/phone";
import { createClient } from "@/lib/supabase/server";
import type { InterestRow } from "@/lib/types";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

const ATTACHMENT_DAYS = 30;



function attachmentExpiry(kind: string | undefined): string | null {
  if (!kind || kind === "none") return null;
  return new Date(Date.now() + ATTACHMENT_DAYS * 86_400_000).toISOString();
}

/**
 * Save the dialog.
 *
 * Prices are ALWAYS read from the services catalogue here, never taken
 * from the browser — otherwise the price on a booking is whatever the
 * client says it is.
 */
export async function saveBooking(input: unknown) {
  const profile = await requireStaffProfile();

  const parsed = bookingFormSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const v = parsed.data;
  const supabase = await createClient();

  if (v.clientType === "follow_up" && !v.clientId) {
    return fail("Pick the returning client.");
  }

  const { data: service } = await supabase
    .from("services")
    .select("id, name, price_cents, currency, duration_minutes, is_active")
    .eq("id", v.serviceId)
    .maybeSingle();

  if (!service) {
    return fail(
      "That service is no longer on the price list — it may have just been " +
        "changed. Reopen the dialog and pick it again.",
    );
  }
  if (!service.is_active) return fail(`${service.name} has been retired.`);

  const whatsapp = toE164(v.whatsapp ?? null);
  const tagIds = v.tagIds ?? [];

  /* ------------------------------------------------------- an interest */
  if (v.bookingStatus === "interest") {
    const { data, error } = await supabase
      .from("interests")
      .insert({
        client_id: v.clientType === "follow_up" ? v.clientId : null,
        client_type: v.clientType,
        full_name: v.fullName,
        gender: v.gender || null,
        age: v.age ?? null,
        whatsapp,
        service_id: service.id,
        counsellor_id: v.counsellorId,
        on_date: v.onDate,
        mode: v.mode,
        tag_ids: tagIds,
        attachment: v.attachment ?? "none",
        attachment_note: v.attachmentNote || null,
        attachment_path: v.attachmentPath || null,
        attachment_expires_at: attachmentExpiry(v.attachment),
        notes: v.notes || null,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) return fail(describeDbError(error.message, error.code));

    revalidatePath("/interests");
    revalidatePath("/schedule");
    return {
      ok: true as const,
      data: { kind: "interest" as const, id: data.id as string },
    };
  }

  /* --------------------------------------------------------- a booking */
  if (!v.startsAt) return fail("Pick a time slot to confirm the booking.");

  // A new caller becomes a client record; a follow-up reuses theirs.
  let clientId = v.clientId ?? null;

  if (v.clientType === "new" || !clientId) {
    const { data: created, error: clientError } = await supabase
      .from("clients")
      .insert({
        full_name: v.fullName,
        gender: v.gender || null,
        age: v.age ?? null,
        phone: whatsapp,
        counsellor_id: v.counsellorId,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (clientError) {
      return fail(describeDbError(clientError.message, clientError.code));
    }
    clientId = created.id as string;
  } else {
    // Keep the client's contact details current with what the desk took.
    await supabase
      .from("clients")
      .update({
        ...(whatsapp ? { phone: whatsapp } : {}),
        ...(v.gender ? { gender: v.gender } : {}),
        ...(v.age != null ? { age: v.age } : {}),
      })
      .eq("id", clientId);
  }

  const startsAt = new Date(v.startsAt);
  const endsAt = new Date(
    startsAt.getTime() + service.duration_minutes * 60_000,
  );

  // Tiers come from the clinic's settings row, editable by an admin,
  // rather than from environment variables needing a redeploy.
  const advanceCents = advanceRequirement(
    service.price_cents,
    v.mode,
    await billingSettingsFromClinic(),
  );

  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      counsellor_id: v.counsellorId,
      client_id: clientId,
      service_id: service.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: v.status ?? "scheduled",
      title: service.name,
      price_cents: service.price_cents,
      currency: service.currency,
      channel: v.mode === "offline_walk_in" ? "walk_in" : v.mode === "online" ? "online" : "phone",
      mode: v.mode,
      client_type: v.clientType,
      tag_ids: tagIds,
      attachment: v.attachment ?? "none",
      attachment_note: v.attachmentNote || null,
      attachment_path: v.attachmentPath || null,
      attachment_expires_at: attachmentExpiry(v.attachment),
      advance_cents: advanceCents,
      advance_paid_at: v.advancePaid ? new Date().toISOString() : null,
      booking_notes: v.notes || null,
      booked_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return fail(describeDbError(error.message, error.code));

  // Every booking raises an invoice, with the advance already credited.
  await supabase.from("invoices").insert({
    appointment_id: appointment.id,
    counsellor_id: v.counsellorId,
    client_id: clientId,
    amount_cents: service.price_cents,
    currency: service.currency,
    status: service.price_cents > 0 ? "unpaid" : "waived",
  });

  const { notifyAppointmentEvent } = await import("@/lib/notify/appointment");
  const notified = await notifyAppointmentEvent({
    appointmentId: appointment.id as string,
    event: "booked",
  });

  revalidatePath("/schedule");
  revalidatePath("/payments");
  revalidatePath("/interests");
  return {
    ok: true as const,
    data: {
      kind: "booked" as const,
      id: appointment.id as string,
      advanceCents,
      whatsapp: notified.whatsapp,
    },
  };
}

/* ------------------------------------------------------ interest admin */

export async function listInterests(
  status?: "scheduled" | "converted" | "dropped",
): Promise<InterestRow[]> {
  await requireStaffProfile();
  const supabase = await createClient();

  let query = supabase
    .from("interests")
    .select(
      // interests has TWO foreign keys to profiles (counsellor_id and
      // created_by), so the embed must name which one — an unqualified
      // profiles(...) is rejected as ambiguous (PGRST201).
      `*,
       service:services (id, name, price_cents, currency),
       counsellor:profiles!interests_counsellor_id_fkey (id, full_name, avatar_url)`,
    );

  if (status) query = query.eq("status", status);

  const { data } = await query.order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as InterestRow[];
}

/**
 * The lead paid — turn it into a real booking, which is the first point
 * at which a slot is actually held.
 */
export async function convertInterest(
  id: string,
  startsAtIso: string,
  opts?: { advancePaid?: boolean },
) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: interest } = await supabase
    .from("interests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!interest) return fail("That interest no longer exists.");
  if (interest.status === "converted") {
    return fail("This interest was already booked.");
  }
  if (!interest.service_id || !interest.counsellor_id) {
    return fail("Add a service and counsellor before booking this in.");
  }

  const result = await saveBooking({
    bookingStatus: "booked",
    clientType: interest.client_id ? "follow_up" : "new",
    clientId: interest.client_id,
    fullName: interest.full_name,
    gender: interest.gender,
    age: interest.age,
    whatsapp: interest.whatsapp,
    serviceId: interest.service_id,
    counsellorId: interest.counsellor_id,
    onDate: startsAtIso.slice(0, 10),
    startsAt: startsAtIso,
    mode: interest.mode,
    tagIds: interest.tag_ids ?? [],
    attachment: interest.attachment,
    attachmentNote: interest.attachment_note,
    notes: interest.notes,
    advancePaid: opts?.advancePaid ?? true,
  });

  if (!result.ok) return result;

  const { error } = await supabase
    .from("interests")
    .update({
      status: "converted",
      converted_appointment_id: result.data.id,
      converted_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/interests");
  revalidatePath("/schedule");
  return { ok: true as const, data: { appointmentId: result.data.id } };
}

export async function dropInterest(id: string, reason?: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("interests")
    .update({ status: "dropped", notes: reason?.trim() || null })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/interests");
  return { ok: true as const };
}

export async function deleteInterest(id: string) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) {
    return fail("Only an admin can delete a lead outright.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("interests").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/interests");
  return { ok: true as const };
}
