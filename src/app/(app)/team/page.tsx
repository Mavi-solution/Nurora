import { requireStaff } from "@/lib/auth";
import { listStaffMates } from "@/lib/actions/team";
import { createClient } from "@/lib/supabase/server";
import type { DirectMessage, TeamMessage } from "@/lib/types";
import { TeamWorkspace } from "./team-workspace";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ with?: string }>;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();

  const mates = await listStaffMates();

  // ?with=<id> opens a private thread; without it you land on the
  // broadcast channel, which is what the desk watches all day.
  const activeId =
    params.with && mates.some((m) => m.id === params.with) ? params.with : null;

  const [{ data: channelRows }, thread] = await Promise.all([
    supabase
      .from("team_messages")
      .select("*, author:profiles(id, full_name, avatar_url, role)")
      .order("created_at", { ascending: false })
      .limit(100),
    activeId
      ? supabase
          .from("direct_messages")
          .select("*")
          // Both directions of the pair. RLS keeps this to your own
          // threads regardless, but being explicit keeps the query narrow.
          .or(
            `and(sender_id.eq.${profile.id},recipient_id.eq.${activeId}),` +
              `and(sender_id.eq.${activeId},recipient_id.eq.${profile.id})`,
          )
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as DirectMessage[] }),
  ]);

  const channelMessages = ((channelRows ?? []) as TeamMessage[]).reverse();
  const threadMessages = ((thread.data ?? []) as DirectMessage[]).reverse();

  return (
    <TeamWorkspace
      profile={profile}
      mates={mates}
      activeId={activeId}
      channelMessages={channelMessages}
      threadMessages={threadMessages}
    />
  );
}
