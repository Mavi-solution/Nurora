"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeDbError, fail, requireStaffProfile } from "./shared";

export async function postTeamMessage(body: string) {
  const profile = await requireStaffProfile();

  const text = body.trim();
  if (!text) return fail("Message is empty.");
  if (text.length > 2000) return fail("Message is too long (2000 characters max).");

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
