"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { REF_TAG } from "@/lib/data/reference";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { AppointmentTag, Service } from "@/lib/types";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

/**
 * The clinic price list. A service has ONE price — the advance owed is
 * derived from it by the tiered rule in business/billing.ts, never
 * stored per service. Do not add an advance column here.
 */

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().max(60).optional().nullable(),
  // Rupees on the wire, paise in the database — the UI talks in rupees.
  price: z.coerce.number().min(0).max(1_000_000),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
});

async function requireAdmin() {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) {
    throw new Error("Admin access required");
  }
  return profile;
}

export async function listServices(includeInactive = false): Promise<Service[]> {
  await requireStaffProfile();
  const supabase = await createClient();

  let query = supabase.from("services").select("*");
  if (!includeInactive) query = query.eq("is_active", true);

  const { data } = await query
    .order("sort_order")
    .order("name");

  return (data ?? []) as Service[];
}

export async function listAppointmentTags(
  includeInactive = false,
): Promise<AppointmentTag[]> {
  await requireStaffProfile();
  const supabase = await createClient();

  let query = supabase.from("appointment_tags").select("*");
  if (!includeInactive) query = query.eq("is_active", true);

  const { data } = await query.order("sort_order").order("label");
  return (data ?? []) as AppointmentTag[];
}

export async function createService(input: unknown) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change the price list.");
  }

  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const v = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.from("services").insert({
    name: v.name,
    category: v.category || null,
    price_cents: Math.round(v.price * 100),
    duration_minutes: v.durationMinutes,
    sort_order: v.sortOrder ?? 0,
    is_active: v.isActive ?? true,
  });

  if (error) {
    if (error.code === "23505") return fail("A service with that name already exists.");
    return fail(describeDbError(error.message, error.code));
  }

  revalidateTag(REF_TAG.services);
  revalidatePath("/services");
  revalidatePath("/schedule");
  revalidatePath("/book");
  return { ok: true as const };
}

export async function updateService(id: string, input: unknown) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change the price list.");
  }

  const parsed = serviceSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const v = parsed.data;
  const patch: Record<string, unknown> = {};

  if (v.name !== undefined) patch.name = v.name;
  if (v.category !== undefined) patch.category = v.category || null;
  if (v.price !== undefined) patch.price_cents = Math.round(v.price * 100);
  if (v.durationMinutes !== undefined) patch.duration_minutes = v.durationMinutes;
  if (v.sortOrder !== undefined) patch.sort_order = v.sortOrder;
  if (v.isActive !== undefined) patch.is_active = v.isActive;

  if (Object.keys(patch).length === 0) return fail("Nothing to change.");

  const supabase = await createClient();
  const { error } = await supabase.from("services").update(patch).eq("id", id);

  if (error) {
    if (error.code === "23505") return fail("A service with that name already exists.");
    return fail(describeDbError(error.message, error.code));
  }

  revalidateTag(REF_TAG.services);
  revalidatePath("/services");
  revalidatePath("/schedule");
  revalidatePath("/book");
  return { ok: true as const };
}

/**
 * Retire a service rather than deleting it when it has been booked.
 *
 * A hard delete would null the service off historical appointments (the
 * FK is ON DELETE SET NULL), silently rewriting what a past session was
 * for. Retiring keeps the history readable and just takes it off the
 * booking dropdown.
 */
export async function deleteService(id: string) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change the price list.");
  }

  const supabase = await createClient();

  const [{ count: apptCount }, { count: interestCount }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("service_id", id),
    supabase
      .from("interests")
      .select("id", { count: "exact", head: true })
      .eq("service_id", id),
  ]);

  const used = (apptCount ?? 0) + (interestCount ?? 0);

  if (used > 0) {
    const { error } = await supabase
      .from("services")
      .update({ is_active: false })
      .eq("id", id);

    if (error) return fail(describeDbError(error.message, error.code));

    revalidateTag(REF_TAG.services);
    revalidatePath("/services");
    return {
      ok: true as const,
      data: {
        retired: true,
        message: `Retired instead of deleted — it is on ${used} record${used === 1 ? "" : "s"}.`,
      },
    };
  }

  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidateTag(REF_TAG.services);
  revalidatePath("/services");
  return { ok: true as const, data: { retired: false, message: "Service deleted." } };
}

/* ----------------------------------------------------------------- tags */

export async function createTag(label: string, abbreviation: string) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change tags.");
  }

  const parsed = z
    .object({
      label: z.string().trim().min(2).max(60),
      abbreviation: z.string().trim().min(1).max(8),
    })
    .safeParse({ label, abbreviation });

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { error } = await supabase.from("appointment_tags").insert({
    label: parsed.data.label,
    abbreviation: parsed.data.abbreviation,
    sort_order: 999,
  });

  if (error) {
    if (error.code === "23505") return fail("That tag already exists.");
    return fail(describeDbError(error.message, error.code));
  }

  revalidateTag(REF_TAG.appointmentTags);
  revalidatePath("/services");
  return { ok: true as const };
}

/**
 * Tags are only ever retired, never removed. Appointments store tag ids
 * in an array, which cannot carry a foreign key — so a hard delete would
 * leave ids that resolve to nothing on historical bookings.
 */
export async function retireTag(id: string, isActive: boolean) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change tags.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointment_tags")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidateTag(REF_TAG.appointmentTags);
  revalidatePath("/services");
  return { ok: true as const };
}
