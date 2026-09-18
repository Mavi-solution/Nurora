"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentProfile, describeDbError, fail } from "./shared";

/**
 * Clearing the bell.
 *
 * "Clear the appointment confirmation history in notifications bar" —
 * every booking, reminder and team message accumulated with no way to
 * remove any of it, so the bell became a wall of old confirmations that
 * nobody could see a new one in.
 *
 * Every function here is scoped to the signed-in user's own rows, which
 * is also exactly what the RLS delete policy allows (migration 0013).
 * The .eq() is not the security boundary — the policy is — but keeping
 * both means a mistake in one is caught by the other.
 */

export async function clearNotifications(opts?: { onlyRead?: boolean }) {
  const profile = await currentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();

  let query = supabase.from("notifications").delete().eq("user_id", profile.id);

  // Clearing only what has been read is the safe default for a bulk
  // action: an unread notification is something nobody has seen yet.
  if (opts?.onlyRead) query = query.not("read_at", "is", null);

  const { error } = await query;
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/notifications");
  return { ok: true as const };
}

/** Remove one notification. */
export async function dismissNotification(id: string) {
  const profile = await currentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("user_id", profile.id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/notifications");
  return { ok: true as const };
}

/** Mark everything read without removing it. */
export async function markAllNotificationsRead() {
  const profile = await currentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", profile.id)
    .is("read_at", null);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/notifications");
  return { ok: true as const };
}
