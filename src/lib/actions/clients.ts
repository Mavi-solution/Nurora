"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { describeDbError, fail, requireStaffProfile } from "./shared";

const clientSchema = z.object({
  fullName: z.string().trim().min(2, "Name is too short").max(120),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  phone: z.string().trim().max(24).optional(),
  counsellorId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional(),
  gender: z.string().trim().max(40).optional(),
  preferredLanguage: z.string().trim().max(40).optional(),
  presentingConcern: z.string().trim().max(2000).optional(),
  preferredSpecialismId: z.string().uuid().optional().nullable(),
});

export async function createClientRecord(input: unknown) {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const profile = await requireStaffProfile();
  const v = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clients")
    .insert({
      full_name: v.fullName,
      age: v.age ?? null,
      email: v.email || null,
      phone: v.phone || null,
      counsellor_id: v.counsellorId ?? (profile.role === "counsellor" ? profile.id : null),
      notes: v.notes || null,
      gender: v.gender || null,
      preferred_language: v.preferredLanguage || null,
      presenting_concern: v.presentingConcern || null,
      preferred_specialism_id: v.preferredSpecialismId ?? null,
      created_by: profile.id,
    })
    .select("id, full_name")
    .single();

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/clients");
  revalidatePath("/schedule");
  return { ok: true as const, data: { id: data.id as string, fullName: data.full_name as string } };
}

export async function updateClientRecord(clientId: string, input: unknown) {
  const parsed = clientSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  await requireStaffProfile();
  const v = parsed.data;
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (v.fullName !== undefined) patch.full_name = v.fullName;
  if (v.age !== undefined) patch.age = v.age;
  if (v.email !== undefined) patch.email = v.email || null;
  if (v.phone !== undefined) patch.phone = v.phone || null;
  if (v.counsellorId !== undefined) patch.counsellor_id = v.counsellorId;
  if (v.notes !== undefined) patch.notes = v.notes || null;
  if (v.gender !== undefined) patch.gender = v.gender || null;
  if (v.preferredLanguage !== undefined) {
    patch.preferred_language = v.preferredLanguage || null;
  }
  if (v.presentingConcern !== undefined) {
    patch.presenting_concern = v.presentingConcern || null;
  }
  if (v.preferredSpecialismId !== undefined) {
    patch.preferred_specialism_id = v.preferredSpecialismId;
  }

  const { error } = await supabase.from("clients").update(patch).eq("id", clientId);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/schedule");
  return { ok: true as const };
}

/** The inline age dropdown on each schedule row. */
export async function setClientAge(clientId: string, age: number | null) {
  await requireStaffProfile();

  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
    return fail("Age must be between 0 and 120.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ age }).eq("id", clientId);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function archiveClient(clientId: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("clients")
    .update({ is_active: false })
    .eq("id", clientId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/clients");
  return { ok: true as const };
}

/**
 * Caller lookup for the booking desk.
 *
 * Repeat callers give a phone number, so digits are matched loosely —
 * "+91 98765 43210", "9876543210" and "098765 43210" must all find the
 * same person, or the desk creates a duplicate on every call.
 */
export async function findClients(term: string) {
  await requireStaffProfile();

  const query = term.trim();
  if (query.length < 3) return { ok: true as const, data: [] };

  const supabase = await createClient();
  const digits = query.replace(/\D/g, "");

  const filters = [`full_name.ilike.%${query}%`];
  if (query.includes("@")) filters.push(`email.ilike.%${query}%`);
  // Match on the last 8 digits so country codes and leading zeros
  // do not stop a legitimate match.
  if (digits.length >= 6) filters.push(`phone.ilike.%${digits.slice(-8)}%`);

  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, full_name, age, email, phone, user_id, preferred_language, presenting_concern, counsellor_id",
    )
    .eq("is_active", true)
    .or(filters.join(","))
    .order("full_name")
    .limit(10);

  if (error) return fail(describeDbError(error.message, error.code));
  return { ok: true as const, data: data ?? [] };
}
