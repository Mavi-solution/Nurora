"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toE164 } from "@/lib/notify/phone";
import { sendWhatsApp, whatsappConfigured } from "@/lib/notify/sms";
import { createClient } from "@/lib/supabase/server";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------ Google Reviews */

export async function logReview(input: {
  clientName: string;
  counsellorId?: string | null;
  rating?: number | null;
  body?: string | null;
  reviewUrl?: string | null;
  reviewedOn?: string;
}) {
  const profile = await requireStaffProfile();

  const parsed = z
    .object({
      clientName: z.string().trim().min(2).max(120),
      counsellorId: z.string().uuid().nullable().optional(),
      rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
      body: z.string().trim().max(2000).nullable().optional(),
      reviewUrl: z.string().trim().max(500).nullable().optional(),
      reviewedOn: z.string().regex(DATE).optional(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("reviews").insert({
    client_name: v.clientName,
    counsellor_id: v.counsellorId || null,
    rating: v.rating ?? null,
    body: v.body || null,
    review_url: v.reviewUrl || null,
    reviewed_on: v.reviewedOn ?? new Date().toISOString().slice(0, 10),
    logged_by: profile.id,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/reviews");
  return { ok: true as const };
}

export async function deleteReview(id: string) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) return fail("Only an admin can remove a review.");

  const supabase = await createClient();
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/reviews");
  return { ok: true as const };
}

/* ---------------------------------------------------------- Follow-ups */

export async function createFollowUp(input: {
  clientId?: string | null;
  counsellorId?: string | null;
  what: string;
  dueOn?: string;
}) {
  const profile = await requireStaffProfile();

  const parsed = z
    .object({
      clientId: z.string().uuid().nullable().optional(),
      counsellorId: z.string().uuid().nullable().optional(),
      what: z.string().trim().min(3).max(500),
      dueOn: z.string().regex(DATE).optional(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("follow_ups").insert({
    client_id: v.clientId || null,
    counsellor_id: v.counsellorId || profile.id,
    what: v.what,
    due_on: v.dueOn ?? new Date().toISOString().slice(0, 10),
    created_by: profile.id,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}

/**
 * Prepare the WhatsApp hand-off for a follow-up.
 *
 * The guide is firm that ticking one off actually opens WhatsApp —
 * "you can't fake-complete it without sending something". So the only
 * route to completing normally goes through here, which requires a
 * usable number; completing without that is possible but is recorded as
 * 'manual' so the difference stays visible.
 */
export async function prepareFollowUpMessage(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("follow_ups")
    .select("id, what, client:clients (full_name, phone)")
    .eq("id", id)
    .maybeSingle();

  if (!data) return fail("That follow-up no longer exists.");

  const client = Array.isArray(data.client) ? data.client[0] : data.client;
  if (!client) return fail("This follow-up has no client attached.");

  const phone = toE164((client as { phone: string | null }).phone);
  if (!phone) return fail("No usable phone number on the client record.");

  const name = (client as { full_name: string }).full_name.trim().split(/\s+/)[0];
  const text = `Hello ${name}, ${data.what as string}`;

  return {
    ok: true as const,
    data: {
      href: `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`,
      text,
      to: phone,
      canSendAutomatically: whatsappConfigured(),
    },
  };
}

/**
 * Send a follow-up from the app and close it in one step.
 *
 * Unlike the booking confirmation, a follow-up is free text, so there
 * is no approved template it can travel under. Meta only accepts
 * free-form business messages inside a 24-hour window after the client
 * last wrote, so this will be refused for a client who has not been in
 * touch recently — the refusal is reported and the manual link stays
 * there, which is the way through for an older conversation.
 */
export async function sendFollowUpNow(id: string) {
  await requireStaffProfile();

  const prepared = await prepareFollowUpMessage(id);
  if (!prepared.ok) return prepared;

  if (!whatsappConfigured()) {
    return fail(
      "WhatsApp is not configured on this deployment. Use the link to send it by hand.",
    );
  }

  const result = await sendWhatsApp(prepared.data.to, prepared.data.text);

  if (!result.ok) {
    return fail(
      `WhatsApp refused it: ${result.error ?? "unknown error"}. ` +
        "A free-text message only reaches a client who wrote in the last " +
        "24 hours — send it by hand with the link instead.",
    );
  }

  return completeFollowUp(id, "whatsapp");
}

export async function completeFollowUp(id: string, via: "whatsapp" | "manual") {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("follow_ups")
    .update({ completed_at: new Date().toISOString(), completed_via: via })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}

export async function reopenFollowUp(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("follow_ups")
    .update({ completed_at: null, completed_via: null })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}

export async function deleteFollowUp(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("follow_ups").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}

/* -------------------------------------------------------- Commitments */

export async function createCommitment(input: {
  title: string;
  detail?: string | null;
  dueOn?: string | null;
  ownerId?: string | null;
}) {
  const profile = await requireStaffProfile();

  const parsed = z
    .object({
      title: z.string().trim().min(3).max(200),
      detail: z.string().trim().max(2000).nullable().optional(),
      dueOn: z.string().regex(DATE).nullable().optional(),
      ownerId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  // Only an admin may put a commitment on someone else's list.
  const owner =
    v.ownerId && profileIsAdmin(profile) ? v.ownerId : profile.id;

  const supabase = await createClient();
  const { error } = await supabase.from("commitments").insert({
    owner_id: owner,
    title: v.title,
    detail: v.detail || null,
    due_on: v.dueOn || null,
    created_by: profile.id,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}

export async function toggleCommitment(id: string, done: boolean) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("commitments")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}

export async function deleteCommitment(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("commitments").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/follow-ups");
  return { ok: true as const };
}
