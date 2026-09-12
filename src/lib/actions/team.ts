"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { DirectMessage, StaffMate } from "@/lib/types";
import { describeDbError, fail, requireStaffProfile } from "./shared";

const MAX_LENGTH = 2000;

/* ------------------------------------------------- the shared channel */

export async function postTeamMessage(body: string) {
  const profile = await requireStaffProfile();

  const text = body.trim();
  if (!text) return fail("Message is empty.");
  if (text.length > MAX_LENGTH) {
    return fail(`Message is too long (${MAX_LENGTH} characters max).`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_messages")
    .insert({ author_id: profile.id, body: text });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/team");
  return { ok: true as const };
}

export async function deleteTeamMessage(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("team_messages").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/team");
  return { ok: true as const };
}

/* ------------------------------------------------------ direct messages */

/**
 * A private message to one colleague — another counsellor, the booking
 * desk, or an admin. RLS vets both ends (staff only, sender must be
 * you), so this is a thin wrapper; the checks here exist to return a
 * readable error rather than a raw policy violation.
 */
export async function sendDirectMessage(recipientId: string, body: string) {
  const profile = await requireStaffProfile();

  const text = body.trim();
  if (!text) return fail("Message is empty.");
  if (text.length > MAX_LENGTH) {
    return fail(`Message is too long (${MAX_LENGTH} characters max).`);
  }
  if (recipientId === profile.id) {
    return fail("You cannot message yourself.");
  }

  const supabase = await createClient();

  const { data: recipient } = await supabase
    .from("profiles")
    .select("id, role, is_admin, is_active")
    .eq("id", recipientId)
    .maybeSingle();

  if (!recipient) return fail("That colleague no longer exists.");

  const recipientIsStaff =
    recipient.is_admin ||
    ["counsellor", "admin", "support"].includes(recipient.role as string);
  if (!recipientIsStaff) {
    return fail("You can only message colleagues, not clients.");
  }

  const { data, error } = await supabase
    .from("direct_messages")
    .insert({ sender_id: profile.id, recipient_id: recipientId, body: text })
    .select("*")
    .single();

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/team");
  return { ok: true as const, data: data as DirectMessage };
}

/** Clear the unread badge for one thread. */
export async function markThreadRead(otherId: string) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("sender_id", otherId)
    .eq("recipient_id", profile.id)
    .is("read_at", null);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/team");
  return { ok: true as const };
}

export async function deleteDirectMessage(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("direct_messages").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/team");
  return { ok: true as const };
}

/**
 * Everyone you can message, newest conversation first, with unread
 * counts. Used by the /team sidebar and by the schedule composer's
 * recipient picker.
 */
export async function listStaffMates(): Promise<StaffMate[]> {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const [{ data: people }, { data: messages }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, role, is_admin")
      .neq("id", profile.id)
      .eq("is_active", true)
      .or("role.in.(counsellor,admin,support),is_admin.eq.true")
      .order("full_name"),
    // RLS already limits this to threads you are part of.
    supabase
      .from("direct_messages")
      .select("sender_id, recipient_id, body, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const unread = new Map<string, number>();
  const last = new Map<string, { body: string; at: string }>();

  for (const m of (messages ?? []) as DirectMessage[]) {
    const other = m.sender_id === profile.id ? m.recipient_id : m.sender_id;

    // The list is newest-first, so the first hit per person is the latest.
    if (!last.has(other)) last.set(other, { body: m.body, at: m.created_at });

    if (m.recipient_id === profile.id && !m.read_at) {
      unread.set(other, (unread.get(other) ?? 0) + 1);
    }
  }

  const mates = ((people ?? []) as Array<
    Pick<StaffMate, "id" | "full_name" | "avatar_url" | "role" | "is_admin">
  >).map((p) => ({
    ...p,
    unread: unread.get(p.id) ?? 0,
    lastMessage: last.get(p.id)?.body ?? null,
    lastMessageAt: last.get(p.id)?.at ?? null,
  }));

  // Active conversations float to the top; everyone else stays A–Z.
  return mates.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) {
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    }
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.full_name.localeCompare(b.full_name);
  });
}
