import { isAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AvailabilityException, AvailabilityRule, CounsellorSummary } from "@/lib/types";
import { AvailabilityEditor } from "./availability-editor";

export const metadata = { title: "Availability" };
export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ counsellor?: string }>;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();

  const { data: counsellorRows } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency")
    .eq("role", "counsellor")
    .eq("is_active", true)
    .order("full_name");

  const counsellors = (counsellorRows ?? []) as CounsellorSummary[];

  // Counsellors edit their own week; admins can pick anyone's.
  const selectedId = isAdmin(profile)
    ? (params.counsellor ?? counsellors[0]?.id ?? profile.id)
    : profile.id;

  const [{ data: rules }, { data: exceptions }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("*")
      .eq("counsellor_id", selectedId)
      .order("weekday"),
    supabase
      .from("availability_exceptions")
      .select("*")
      .eq("counsellor_id", selectedId)
      .gte("on_date", new Date().toISOString().slice(0, 10))
      .order("on_date"),
  ]);

  return (
    <AvailabilityEditor
      canPickCounsellor={isAdmin(profile)}
      counsellors={counsellors}
      selectedId={selectedId}
      rules={(rules ?? []) as AvailabilityRule[]}
      exceptions={(exceptions ?? []) as AvailabilityException[]}
      timezone={
        counsellors.find((c) => c.id === selectedId)?.timezone ?? profile.timezone
      }
    />
  );
}
