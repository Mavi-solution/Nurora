"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeDbError, fail, requireStaffProfile } from "./shared";

/**
 * "Tap to check in" — staff attendance, deliberately separate from the
 * per-session billed timers.
 */
export async function toggleCheckIn() {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: open } = await supabase
    .from("staff_shifts")
    .select("id")
    .eq("staff_id", profile.id)
    .is("checked_out_at", null)
    .maybeSingle();

  if (open) {
    const { error } = await supabase
      .from("staff_shifts")
      .update({ checked_out_at: new Date().toISOString() })
      .eq("id", open.id);

    if (error) return fail(describeDbError(error.message, error.code));

    revalidatePath("/schedule");
    revalidatePath("/timesheet");
    return { ok: true as const, data: { checkedIn: false } };
  }

  const { error } = await supabase.from("staff_shifts").insert({
    staff_id: profile.id,
    checked_in_at: new Date().toISOString(),
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  revalidatePath("/timesheet");
  return { ok: true as const, data: { checkedIn: true } };
}
