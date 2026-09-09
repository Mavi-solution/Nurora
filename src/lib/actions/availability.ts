"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { describeDbError, fail, profileIsAdmin, requireStaffProfile } from "./shared";

const ruleSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

/** Replace the whole weekly pattern in one shot — simplest thing that
 *  keeps the editor and the database in sync. */
export async function saveWeeklyAvailability(
  counsellorId: string,
  rules: unknown,
) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile) && counsellorId !== profile.id) {
    return fail("You can only edit your own availability.");
  }

  const parsed = z.array(ruleSchema).safeParse(rules);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  for (const r of parsed.data) {
    if (r.endTime <= r.startTime) {
      return fail("Each window must end after it starts.");
    }
  }

  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("counsellor_id", counsellorId);

  if (deleteError) return fail(describeDbError(deleteError.message, deleteError.code));

  if (parsed.data.length > 0) {
    const { error } = await supabase.from("availability_rules").insert(
      parsed.data.map((r) => ({
        counsellor_id: counsellorId,
        weekday: r.weekday,
        start_time: r.startTime,
        end_time: r.endTime,
      })),
    );
    if (error) return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/availability");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function addAvailabilityException(input: {
  counsellorId: string;
  onDate: string;
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string;
}) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile) && input.counsellorId !== profile.id) {
    return fail("You can only edit your own availability.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("availability_exceptions").insert({
    counsellor_id: input.counsellorId,
    on_date: input.onDate,
    is_available: input.isAvailable,
    start_time: input.startTime || null,
    end_time: input.endTime || null,
    reason: input.reason?.trim() || null,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/availability");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function removeAvailabilityException(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/availability");
  revalidatePath("/schedule");
  return { ok: true as const };
}
