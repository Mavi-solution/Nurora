import { monthOffSummary } from "@/lib/actions/leave";
import { isAdmin, requireStaff } from "@/lib/auth";
import { getMonthWeeks } from "@/lib/business/weekoff";
import { createClient } from "@/lib/supabase/server";
import type { CounsellorSummary } from "@/lib/types";
import { LeaveBoard } from "./leave-board";

export const metadata = { title: "Week-offs & Leave" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ month?: string; staff?: string }>;

const MONTH_KEY = /^\d{4}-\d{2}$/;

export default async function LeavePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const admin = isAdmin(profile);

  const now = new Date();
  const monthKey =
    params.month && MONTH_KEY.test(params.month)
      ? params.month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [year, month] = monthKey.split("-").map(Number);

  // Only an admin may look at someone else's month.
  const staffId = admin && params.staff ? params.staff : profile.id;

  const supabase = await createClient();
  const { data: staffRows } = admin
    ? await supabase
        .from("profiles")
        .select(
          "id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency, languages",
        )
        .or("role.in.(counsellor,admin,support),is_admin.eq.true")
        .eq("is_active", true)
        .order("full_name")
    : { data: [] };

  const summary = await monthOffSummary(staffId, year, month);

  return (
    <LeaveBoard
      profile={profile}
      isAdmin={admin}
      staff={(staffRows ?? []) as CounsellorSummary[]}
      staffId={staffId}
      monthKey={monthKey}
      year={year}
      month={month}
      weeks={getMonthWeeks(year, month)}
      {...summary}
    />
  );
}
