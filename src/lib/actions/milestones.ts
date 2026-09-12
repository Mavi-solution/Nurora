"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseNubill } from "@/lib/business/milestones";
import {
  confirmationDate,
  confirmationWhatsApp,
  greetingName,
} from "@/lib/notify/message-templates";
import { toE164 } from "@/lib/notify/phone";
import { createClient } from "@/lib/supabase/server";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

/** Only these four are manual — milestone 3 follows the session timer. */
const MANUAL = {
  message: "message_sent_at",
  call: "call_made_at",
  nubill: "nubill_at",
  persona: "persona_at",
} as const;

type ManualKey = keyof typeof MANUAL;

type OwnCtx =
  | { ok: false; error: string }
  | {
      ok: true;
      profile: Awaited<ReturnType<typeof requireStaffProfile>>;
      supabase: Awaited<ReturnType<typeof createClient>>;
      appt: { id: string; counsellor_id: string; status: string };
    };

async function ownsOrAdmin(appointmentId: string): Promise<OwnCtx> {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: appt } = await supabase
    .from("appointments")
    .select("id, counsellor_id, status")
    .eq("id", appointmentId)
    .maybeSingle();

  if (!appt) return { ok: false, error: "Session not found." };

  // Ownership rule from ARCHITECTURE.md §3: a counsellor edits only
  // their own appointments; admins edit anyone's. Read access to the
  // whole diary is separate and intentionally broad.
  if (!profileIsAdmin(profile) && appt.counsellor_id !== profile.id) {
    return { ok: false, error: "Only the assigned counsellor can update this." };
  }

  return {
    ok: true,
    profile,
    supabase,
    appt: appt as { id: string; counsellor_id: string; status: string },
  };
}

/** Tick or untick one of the four manual milestones. */
export async function setMilestone(
  appointmentId: string,
  key: ManualKey,
  done: boolean,
) {
  if (!(key in MANUAL)) return fail("Unknown milestone.");

  const ctx = await ownsOrAdmin(appointmentId);
  if (!ctx.ok) return fail(ctx.error);

  const { error } = await ctx.supabase
    .from("appointments")
    .update({ [MANUAL[key]]: done ? new Date().toISOString() : null })
    .eq("id", appointmentId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const };
}

/**
 * Milestone 1. Builds the personalised confirmation and hands back a
 * wa.me link for the desk to open.
 *
 * Deliberately a link rather than an API send: the handoff describes
 * this step as the counsellor personally sending the message, and the
 * automated confirmation already went out at booking. This is the
 * human follow-up, so it opens WhatsApp with the text prefilled and
 * only marks the step done once it has actually been opened.
 */
export async function prepareClientMessage(appointmentId: string) {
  const ctx = await ownsOrAdmin(appointmentId);
  if (!ctx.ok) return fail(ctx.error);

  const { data: appt } = await ctx.supabase
    .from("appointments")
    .select(
      `id, starts_at, title, location, meeting_url,
       client:clients!appointments_client_id_fkey (full_name, phone),
       counsellor:profiles!appointments_counsellor_id_fkey (full_name, timezone)`,
    )
    .eq("id", appointmentId)
    .maybeSingle();

  if (!appt) return fail("Session not found.");

  const client = (Array.isArray(appt.client) ? appt.client[0] : appt.client) as
    | { full_name: string; phone: string | null }
    | null;
  const counsellor = (Array.isArray(appt.counsellor) ? appt.counsellor[0] : appt.counsellor) as
    | { full_name: string; timezone: string }
    | null;

  if (!client) return fail("This session has no client record.");

  const phone = toE164(client.phone);
  if (!phone) {
    return fail("No usable phone number on the client record.");
  }

  const tz = counsellor?.timezone || "Asia/Kolkata";

  // The practice's approved confirmation copy — the same wording the
  // automated message uses, so the client cannot receive two different
  // versions of the same confirmation.
  const text = confirmationWhatsApp({
    name: greetingName(client.full_name),
    date: confirmationDate(appt.starts_at, tz),
  });

  return {
    ok: true as const,
    data: {
      // wa.me wants the number without a leading +.
      href: `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`,
      text,
      to: phone,
    },
  };
}

/** Milestone 4. Logs the pasted billing text and ticks the step. */
export async function logNubill(appointmentId: string, rawText: string) {
  const ctx = await ownsOrAdmin(appointmentId);
  if (!ctx.ok) return fail(ctx.error);

  const parsed = z.string().trim().min(4).max(4000).safeParse(rawText);
  if (!parsed.success) return fail("Paste the billing text first.");

  const extracted = parseNubill(parsed.data);

  const { error } = await ctx.supabase.from("nubills").insert({
    appointment_id: appointmentId,
    raw_text: parsed.data,
    parsed_name: extracted.name,
    parsed_amount_cents: extracted.amountCents,
    parsed_reference: extracted.reference,
    created_by: ctx.profile.id,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  await ctx.supabase
    .from("appointments")
    .update({ nubill_at: new Date().toISOString() })
    .eq("id", appointmentId);

  revalidatePath("/schedule");
  revalidatePath(`/appointments/${appointmentId}`);
  return { ok: true as const, data: extracted };
}

/**
 * Milestone 5. The intake form lives on the client record, so this
 * writes the assessment fields and ticks the step in one go.
 */
export async function savePersona(
  appointmentId: string,
  input: {
    presentingConcern?: string | null;
    preferredLanguage?: string | null;
    gender?: string | null;
    notes?: string | null;
  },
) {
  const ctx = await ownsOrAdmin(appointmentId);
  if (!ctx.ok) return fail(ctx.error);

  const { data: appt } = await ctx.supabase
    .from("appointments")
    .select("client_id")
    .eq("id", appointmentId)
    .maybeSingle();

  if (!appt?.client_id) return fail("This session has no client record.");

  const parsed = z
    .object({
      presentingConcern: z.string().trim().max(2000).optional().nullable(),
      preferredLanguage: z.string().trim().max(60).optional().nullable(),
      gender: z.string().trim().max(40).optional().nullable(),
      notes: z.string().trim().max(4000).optional().nullable(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  // COALESCE-style: never blank a field that is already on file just
  // because this visit's form did not re-ask for it.
  const patch: Record<string, unknown> = {};
  if (v.presentingConcern) patch.presenting_concern = v.presentingConcern;
  if (v.preferredLanguage) patch.preferred_language = v.preferredLanguage;
  if (v.gender) patch.gender = v.gender;
  if (v.notes) patch.notes = v.notes;

  if (Object.keys(patch).length > 0) {
    const { error } = await ctx.supabase
      .from("clients")
      .update(patch)
      .eq("id", appt.client_id);
    if (error) return fail(describeDbError(error.message, error.code));
  }

  const { error } = await ctx.supabase
    .from("appointments")
    .update({ persona_at: new Date().toISOString() })
    .eq("id", appointmentId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  revalidatePath(`/appointments/${appointmentId}`);
  revalidatePath(`/clients/${appt.client_id}`);
  return { ok: true as const };
}
