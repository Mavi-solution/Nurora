import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClientSummary, Commitment, FollowUp } from "@/lib/types";
import { FollowUpBoard } from "./follow-up-board";

export const metadata = { title: "Follow-up & Commitments" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ tab?: string }>;

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const tab = params.tab === "commitments" ? "commitments" : "follow-up";

  const supabase = await createClient();
  const [{ data: followUps }, { data: commitments }, { data: clients }] =
    await Promise.all([
      supabase
        .from("follow_ups")
        .select("*, client:clients (id, full_name, phone)")
        .order("completed_at", { ascending: true, nullsFirst: true })
        .order("due_on")
        .limit(300),
      // RLS keeps this to your own plus, for an admin, everyone's.
      supabase
        .from("commitments")
        .select("*")
        .order("done_at", { ascending: true, nullsFirst: true })
        .order("due_on", { nullsFirst: false })
        .limit(300),
      supabase
        .from("clients")
        .select("id, full_name, age, email, phone, user_id, preferred_language, presenting_concern, counsellor_id")
        .eq("is_active", true)
        .order("full_name"),
    ]);

  return (
    <FollowUpBoard
      tab={tab}
      profileId={profile.id}
      followUps={(followUps ?? []) as (FollowUp & {
        client: { id: string; full_name: string; phone: string | null } | null;
      })[]}
      commitments={(commitments ?? []) as Commitment[]}
      clients={(clients ?? []) as ClientSummary[]}
    />
  );
}
