import { monthOffSummary, practiceOffSummary } from "@/lib/actions/leave";
import { isAdmin, requireStaff } from "@/lib/auth";
import { getMonthWeeks } from "@/lib/business/weekoff";
import { createClient } from "@/lib/supabase/server";
import { dateKeyInTimeZone } from "@/lib/time";
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

  /*
   * An admin lands on EVERYONE, not on themselves.
   *
   * The screen used to default to the viewer's own calendar, so an
   * admin opened the practice's rota and saw their own empty month —
   * two counsellors could be away that week and nothing on screen said
   * so. Their own month is still one click away, and picking a name
   * still opens that person's calendar.
   */
  const staffId = admin ? (params.staff ?? null) : profile.id;

  const supabase = await createClient();
  const { data: staffRows } = admin
    ? await supabase
        .from("profiles")
        .select(
          "id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency, languages, preferred_language",
        )
        .or("role.in.(counsellor,admin,support),is_admin.eq.true")
        .eq("is_active", true)
        .order("full_name")
    : { data: [] };

  const todayKey = dateKeyInTimeZone(now, profile.timezone);

  // Everyone's month, for the admin overview. Only fetched when it is
  // actually being shown.
  const practice =
    admin && !staffId ? await practiceOffSummary(year, month) : null;

  const summary = await monthOffSummary(staffId ?? profile.id, year, month);

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
      todayKey={todayKey}
      practice={practice?.ok ? practice.data : null}
      {...summary}
    />
  );
}
