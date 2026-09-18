"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { REF_TAG } from "@/lib/data/reference";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CounsellorPermissions, PermissionKey } from "@/lib/types";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

async function requireAdmin() {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) throw new Error("Admin access required");
  return profile;
}

/* ------------------------------------------------------ clinic settings */

const rupees = z.coerce.number().min(0).max(10_000_000);

const settingsSchema = z.object({
  practiceName: z.string().trim().min(1).max(120),

  advanceTierThreshold: rupees,
  advanceAtOrBelow: rupees,
  advanceAbove: rupees,
  fullPaymentModes: z.array(z.string()).max(5),

  /** 0 = Sunday. At least one day, or the practice never opens. */
  openWeekdays: z
    .array(z.coerce.number().int().min(0).max(6))
    .min(1, "The clinic has to open on at least one day.")
    .max(7),

  includedMinutes: z.coerce.number().int().min(5).max(480),
  graceMinutes: z.coerce.number().int().min(0).max(240),
  extensionBlockMinutes: z.coerce.number().int().min(1).max(240),
  extensionBlockPrice: rupees,
  graceMode: z.enum(["gate", "deduct"]),

  clinicLatitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  clinicLongitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  checkInRadiusM: z.coerce.number().int().min(10).max(5000),
  checkOutRadiusM: z.coerce.number().int().min(10).max(50000),
  geofenceEnforced: z.boolean(),

  confirmationTemplate: z.string().trim().max(4000).nullable().optional(),
  signinQuote: z.string().trim().max(400).nullable().optional(),
  designerCreditUrl: z.string().trim().max(400).nullable().optional(),

  nulancerIndividual: rupees,
  nulancerCouple: rupees,
  reviewMonthlyTarget: z.coerce.number().int().min(0).max(1000),
});

export async function updateClinicSettings(input: unknown) {
  let profile;
  try {
    profile = await requireAdmin();
  } catch {
    return fail("Only an admin can change clinic settings.");
  }

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  // Rule 5: the two radii are deliberately different. Refusing to let
  // check-out be tighter than check-in keeps that intent from being
  // reversed by a typo.
  if (v.checkOutRadiusM < v.checkInRadiusM) {
    return fail(
      "Check-out radius must be at least the check-in radius — leaving is checked more leniently than arriving.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic_settings")
    .update({
      practice_name: v.practiceName,
      advance_tier_threshold_cents: Math.round(v.advanceTierThreshold * 100),
      advance_at_or_below_cents: Math.round(v.advanceAtOrBelow * 100),
      advance_above_cents: Math.round(v.advanceAbove * 100),
      full_payment_modes: v.fullPaymentModes,
      open_weekdays: [...new Set(v.openWeekdays)].sort((a, b) => a - b),
      included_minutes: v.includedMinutes,
      grace_minutes: v.graceMinutes,
      extension_block_minutes: v.extensionBlockMinutes,
      extension_block_cents: Math.round(v.extensionBlockPrice * 100),
      grace_mode: v.graceMode,
      clinic_latitude: v.clinicLatitude ?? null,
      clinic_longitude: v.clinicLongitude ?? null,
      check_in_radius_m: v.checkInRadiusM,
      check_out_radius_m: v.checkOutRadiusM,
      geofence_enforced: v.geofenceEnforced,
      confirmation_template: v.confirmationTemplate || null,
      signin_quote: v.signinQuote || null,
      designer_credit_url: v.designerCreditUrl || null,
      nulancer_individual_cents: Math.round(v.nulancerIndividual * 100),
      nulancer_couple_cents: Math.round(v.nulancerCouple * 100),
      review_monthly_target: v.reviewMonthlyTarget,
      updated_by: profile.id,
    })
    .eq("id", true);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidateTag(REF_TAG.clinicSettings);
  revalidatePath("/clinic-settings");
  revalidatePath("/schedule");
  revalidatePath("/book");
  // Opening days change what the weekly editor will accept, and which
  // days the calendars paint as shut.
  revalidatePath("/availability");
  revalidatePath("/leave");
  return { ok: true as const };
}

/* -------------------------------------------------------- permissions */

export async function setCounsellorPermission(
  counsellorId: string,
  key: PermissionKey,
  value: boolean,
) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change permissions.");
  }

  const supabase = await createClient();

  // Upsert: an absent row means everything is on, so the first switch
  // flipped has to create the row with the rest left true.
  const { error } = await supabase
    .from("counsellor_permissions")
    .upsert({ counsellor_id: counsellorId, [key]: value }, { onConflict: "counsellor_id" });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath(`/counsellors/${counsellorId}`);
  return { ok: true as const };
}

/** Everything on unless a row says otherwise. */
export async function loadPermissions(
  counsellorId: string,
): Promise<CounsellorPermissions> {
  await requireStaffProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("counsellor_permissions")
    .select("*")
    .eq("counsellor_id", counsellorId)
    .maybeSingle();

  return (
    (data as CounsellorPermissions) ?? {
      counsellor_id: counsellorId,
      attendance: true,
      nubills: true,
      persona: true,
      bric: true,
      reviews: true,
      follow_ups: true,
      my_summary: true,
      week_offs: true,
      updated_at: new Date().toISOString(),
    }
  );
}

/* ---------------------------------------------------- NuLancer + perks */

export async function setNulancer(
  counsellorId: string,
  input: { isNulancer: boolean; individual?: number; couple?: number },
) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change NuLancer status.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      is_nulancer: input.isNulancer,
      nulancer_individual_cents:
        input.individual != null ? Math.round(input.individual * 100) : null,
      nulancer_couple_cents:
        input.couple != null ? Math.round(input.couple * 100) : null,
    })
    .eq("id", counsellorId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidateTag(REF_TAG.counsellors);
  revalidatePath(`/counsellors/${counsellorId}`);
  revalidatePath("/nulancers");
  return { ok: true as const };
}

export async function grantBenefit(input: {
  counsellorId: string;
  name: string;
  detail?: string | null;
  value?: number | null;
  expiresOn?: string | null;
}) {
  let profile;
  try {
    profile = await requireAdmin();
  } catch {
    return fail("Only an admin can grant benefits.");
  }

  const parsed = z
    .object({
      counsellorId: z.string().uuid(),
      name: z.string().trim().min(2).max(120),
      detail: z.string().trim().max(1000).nullable().optional(),
      value: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("benefits").insert({
    counsellor_id: v.counsellorId,
    name: v.name,
    detail: v.detail || null,
    value_cents: v.value != null ? Math.round(v.value * 100) : null,
    expires_on: v.expiresOn || null,
    granted_by: profile.id,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/nulancers");
  revalidatePath(`/counsellors/${v.counsellorId}`);
  return { ok: true as const };
}

export async function revokeBenefit(id: string) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can revoke a benefit.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("benefits").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/nulancers");
  return { ok: true as const };
}
