"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requirePracticeManager,
} from "./shared";

const counsellorSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the counsellor's name.").max(120),
  email: z.string().trim().email("A valid email is needed so they can sign in."),
  phone: z.string().trim().max(24).optional(),
  headline: z.string().trim().max(160).optional(),
  bio: z.string().trim().max(2000).optional(),
  timezone: z.string().trim().min(1).max(64),
  languages: z.array(z.string().trim().min(1).max(40)).max(12),
  specialismIds: z.array(z.string().uuid()).max(20),
  sessionFee: z.coerce.number().min(0).max(1_000_000),
  durationMinutes: z.coerce.number().int().min(10).max(480),
  currency: z.string().trim().length(3),
  temporaryPassword: z
    .string()
    .min(8, "The temporary password needs at least 8 characters.")
    .max(72),
});

/**
 * Adds a counsellor to the practice.
 *
 * The desk needs to be able to set someone up before they have ever
 * logged in, so this creates the auth account for them (service role)
 * with a temporary password to hand over. They can change it under
 * Settings once they sign in.
 */
export async function createCounsellor(input: unknown) {
  const parsed = counsellorSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  await requirePracticeManager();
  const v = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail(
      "SUPABASE_SERVICE_ROLE_KEY is not configured, so new counsellor logins cannot be created.",
    );
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: v.email,
    password: v.temporaryPassword,
    // The desk vouches for the address; no confirmation round-trip.
    email_confirm: true,
    user_metadata: { full_name: v.fullName, role: "counsellor" },
  });

  if (createError) {
    const m = createError.message.toLowerCase();
    if (m.includes("already been registered") || m.includes("already exists")) {
      return fail(
        "Someone already has an account with that email. Change their role to counsellor from Settings → People instead.",
      );
    }
    return fail(createError.message);
  }

  const userId = created.user?.id;
  if (!userId) return fail("The account was created but no id came back.");

  // handle_new_user() has made the profile; fill in the practice detail.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: v.fullName,
      role: "counsellor",
      phone: v.phone || null,
      headline: v.headline || null,
      bio: v.bio || null,
      timezone: v.timezone,
      languages: v.languages,
      currency: v.currency.toUpperCase(),
      default_session_fee_cents: Math.round(v.sessionFee * 100),
      default_duration_minutes: v.durationMinutes,
      hourly_rate_cents: Math.round((v.sessionFee * 100 * 60) / v.durationMinutes),
      is_active: true,
      // They still choose their own timezone/name on first sign-in if they want.
      onboarded: true,
    })
    .eq("id", userId);

  if (profileError) {
    return fail(describeDbError(profileError.message, profileError.code));
  }

  if (v.specialismIds.length > 0) {
    await admin.from("counsellor_specialisms").insert(
      v.specialismIds.map((specialism_id) => ({
        counsellor_id: userId,
        specialism_id,
      })),
    );
  }

  revalidatePath("/counsellors");
  revalidatePath("/schedule");
  revalidatePath("/book");
  return { ok: true as const, data: { id: userId } };
}

const updateSchema = counsellorSchema
  .omit({ email: true, temporaryPassword: true })
  .partial();

export async function updateCounsellor(counsellorId: string, input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const profile = await requirePracticeManager();
  const v = parsed.data;
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (v.fullName !== undefined) patch.full_name = v.fullName;
  if (v.phone !== undefined) patch.phone = v.phone || null;
  if (v.headline !== undefined) patch.headline = v.headline || null;
  if (v.bio !== undefined) patch.bio = v.bio || null;
  if (v.timezone !== undefined) patch.timezone = v.timezone;
  if (v.languages !== undefined) patch.languages = v.languages;
  if (v.currency !== undefined) patch.currency = v.currency.toUpperCase();
  if (v.sessionFee !== undefined) {
    patch.default_session_fee_cents = Math.round(v.sessionFee * 100);
  }
  if (v.durationMinutes !== undefined) {
    patch.default_duration_minutes = v.durationMinutes;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", counsellorId);
    if (error) return fail(describeDbError(error.message, error.code));
  }

  if (v.specialismIds !== undefined) {
    const result = await setCounsellorSpecialisms(counsellorId, v.specialismIds);
    if (!result.ok) return result;
  }

  revalidatePath("/counsellors");
  revalidatePath(`/counsellors/${counsellorId}`);
  revalidatePath("/book");
  // Deliberately unused beyond the permission check, but keeps the intent clear.
  void profile;
  return { ok: true as const };
}

/** Replaces the whole specialism set — simplest way to keep UI and DB in step. */
export async function setCounsellorSpecialisms(
  counsellorId: string,
  specialismIds: string[],
) {
  await requirePracticeManager();
  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("counsellor_specialisms")
    .delete()
    .eq("counsellor_id", counsellorId);

  if (clearError) return fail(describeDbError(clearError.message, clearError.code));

  if (specialismIds.length > 0) {
    const { error } = await supabase.from("counsellor_specialisms").insert(
      specialismIds.map((specialism_id) => ({
        counsellor_id: counsellorId,
        specialism_id,
      })),
    );
    if (error) return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/counsellors");
  revalidatePath("/book");
  return { ok: true as const };
}

export async function setCounsellorActive(counsellorId: string, isActive: boolean) {
  await requirePracticeManager();
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", counsellorId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/counsellors");
  revalidatePath("/schedule");
  return { ok: true as const };
}

/** Admin-only: hand a counsellor a new temporary password. */
export async function resetCounsellorPassword(
  counsellorId: string,
  temporaryPassword: string,
) {
  const profile = await requirePracticeManager();
  if (!profileIsAdmin(profile)) return fail("Only an admin can reset a password.");
  if (temporaryPassword.length < 8) {
    return fail("The temporary password needs at least 8 characters.");
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const { error } = await admin.auth.admin.updateUserById(counsellorId, {
    password: temporaryPassword,
  });

  if (error) return fail(error.message);
  return { ok: true as const };
}
