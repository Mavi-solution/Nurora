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
