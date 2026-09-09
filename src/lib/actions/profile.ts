"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentProfile, describeDbError, fail } from "./shared";

const onboardingSchema = z.object({
  fullName: z.string().trim().min(2, "Please enter your name").max(120),
  role: z.enum(["counsellor", "client"]),
  timezone: z.string().trim().min(1),
  phone: z.string().trim().max(24).optional(),
});

export async function completeOnboarding(formData: FormData) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  const parsed = onboardingSchema.safeParse({
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    timezone: formData.get("timezone"),
    phone: formData.get("phone") ?? "",
  });

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const v = parsed.data;
  const supabase = await createClient();

  // An admin always keeps a counsellor lane — onboarding never demotes.
  const role = profile.is_admin ? "counsellor" : v.role;

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: v.fullName,
      role,
      timezone: v.timezone,
      phone: v.phone || profile.phone,
      onboarded: true,
      default_duration_minutes: profile.default_duration_minutes || 60,
    })
    .eq("id", profile.id);

  if (error) return fail(describeDbError(error.message, error.code));

  // A brand-new counsellor gets a sensible Mon–Fri 9–6 week.
  if (role === "counsellor") {
    const { count } = await supabase
      .from("availability_rules")
      .select("id", { count: "exact", head: true })
      .eq("counsellor_id", profile.id);

    if (!count) {
      await supabase.from("availability_rules").insert(
        [1, 2, 3, 4, 5].map((weekday) => ({
          counsellor_id: profile.id,
          weekday,
          start_time: "09:00",
          end_time: "18:00",
        })),
      );
    }
  }

  revalidatePath("/", "layout");
  redirect(role === "client" ? "/my" : "/schedule");
}

const settingsSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  headline: z.string().trim().max(160).optional(),
  bio: z.string().trim().max(2000).optional(),
  timezone: z.string().trim().min(1),
  phone: z.string().trim().max(24).optional(),
  currency: z.string().trim().length(3),
  hourlyRate: z.coerce.number().min(0).max(1_000_000),
  sessionFee: z.coerce.number().min(0).max(1_000_000),
  durationMinutes: z.coerce.number().int().min(10).max(480),
  notifyEmail: z.coerce.boolean(),
  notifySms: z.coerce.boolean(),
  notifyWhatsapp: z.coerce.boolean(),
});

export async function updateSettings(formData: FormData) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  const parsed = settingsSchema.safeParse({
    fullName: formData.get("fullName"),
    headline: formData.get("headline") ?? "",
    bio: formData.get("bio") ?? "",
    timezone: formData.get("timezone"),
    phone: formData.get("phone") ?? "",
    currency: formData.get("currency"),
    hourlyRate: formData.get("hourlyRate") ?? 0,
    sessionFee: formData.get("sessionFee") ?? 0,
    durationMinutes: formData.get("durationMinutes") ?? 60,
    notifyEmail: formData.get("notifyEmail") === "on",
    notifySms: formData.get("notifySms") === "on",
    notifyWhatsapp: formData.get("notifyWhatsapp") === "on",
  });

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const v = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: v.fullName,
      headline: v.headline || null,
      bio: v.bio || null,
      timezone: v.timezone,
      phone: v.phone || null,
      currency: v.currency.toUpperCase(),
      // Money is entered in major units and stored in minor units.
      hourly_rate_cents: Math.round(v.hourlyRate * 100),
      default_session_fee_cents: Math.round(v.sessionFee * 100),
      default_duration_minutes: v.durationMinutes,
      notify_email: v.notifyEmail,
      notify_sms: v.notifySms,
      notify_whatsapp: v.notifyWhatsapp,
    })
    .eq("id", profile.id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Admin-only: change someone's role. */
export async function setUserRole(
  userId: string,
  role: "client" | "counsellor" | "admin",
) {
  const profile = await currentProfile();
  if (!profile || !(profile.is_admin || profile.role === "admin")) {
    return fail("Admin access required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/settings");
  revalidatePath("/schedule");
  return { ok: true as const };
}

/** Admin-only: grant or revoke admin rights. */
export async function setUserAdmin(userId: string, isAdmin: boolean) {
  const profile = await currentProfile();
  if (!profile || !(profile.is_admin || profile.role === "admin")) {
    return fail("Admin access required.");
  }

  if (userId === profile.id) {
    return fail("You cannot change your own admin rights.");
  }

  const supabase = await createClient();

  // Never leave the practice without an admin.
  if (!isAdmin) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .or("is_admin.eq.true,role.eq.admin");

    if ((count ?? 0) <= 1) {
      return fail("There must always be at least one admin.");
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ is_admin: isAdmin })
    .eq("id", userId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/settings");
  return { ok: true as const };
}
