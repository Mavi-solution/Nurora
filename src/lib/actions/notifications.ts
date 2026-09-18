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

/**
 * A delete that removed nothing, when there was something to remove.
 *
 * PostgREST reports a delete blocked by row-level security as a
 * success that affected zero rows — there is no error to surface. That
 * is exactly what a deployment missing migration 0013 does here: the
 * notifications_delete policy does not exist, every delete quietly
 * matches nothing, the list is optimistically emptied on screen, and
 * everything is back after a refresh. Saying so beats appearing to
 * work.
 */
const NOT_ALLOWED =
  "Nothing could be cleared. This deployment is missing migration " +
  "0013_clinic_open_days_and_notifications.sql, which grants permission " +
  "to delete your own notifications. Run it in the Supabase SQL editor.";

export async function clearNotifications(opts?: { onlyRead?: boolean }) {
  const profile = await currentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();

  // Clearing only what has been read is the safe default for a bulk
  // action: an unread notification is something nobody has seen yet.
  const countQuery = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id);

  const { count: before } = await (opts?.onlyRead
    ? countQuery.not("read_at", "is", null)
    : countQuery);

  let query = supabase.from("notifications").delete().eq("user_id", profile.id);
  if (opts?.onlyRead) query = query.not("read_at", "is", null);

  // Asking for the deleted rows back is what turns a silent refusal
  // into something reportable.
  const { data, error } = await query.select("id");
  if (error) return fail(describeDbError(error.message, error.code));

  if ((before ?? 0) > 0 && (data?.length ?? 0) === 0) return fail(NOT_ALLOWED);

  revalidatePath("/notifications");
  return { ok: true as const, data: { cleared: data?.length ?? 0 } };
}

/** Remove one notification. */
export async function dismissNotification(id: string) {
  const profile = await currentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("user_id", profile.id)
    .select("id");

  if (error) return fail(describeDbError(error.message, error.code));
  if (!data || data.length === 0) return fail(NOT_ALLOWED);

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
