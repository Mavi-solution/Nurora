import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { TeamMessage } from "@/lib/types";
import { TeamChannel } from "./team-channel";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { profile } = await requireStaff();
  const supabase = await createClient();

  const { data } = await supabase
    .from("team_messages")
    .select("*, author:profiles(id, full_name, avatar_url, role)")
    .order("created_at", { ascending: false })
    .limit(100);

  const messages = ((data ?? []) as TeamMessage[]).reverse();

  return <TeamChannel profile={profile} initialMessages={messages} />;
}
