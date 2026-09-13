import { getClinicSettings, getCounsellors } from "@/lib/data/reference";
import { CLINICIAN_ROLES, isAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CounsellorSummary, Review } from "@/lib/types";
import { ReviewBoard } from "./review-board";

export const metadata = { title: "Google Reviews" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ month?: string }>;
const MONTH = /^\d{4}-\d{2}$/;

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;

  const now = new Date();
  const monthKey =
    params.month && MONTH.test(params.month)
      ? params.month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  const supabase = await createClient();
  const [{ data: reviews }, counsellors, settings] = await Promise.all([
    supabase
      .from("reviews")
      .select("*")
      .gte("reviewed_on", from)
      .lte("reviewed_on", to)
      .order("reviewed_on", { ascending: false }),
    getCounsellors(),
    getClinicSettings(),
  ]);

  return (
    <ReviewBoard
      reviews={(reviews ?? []) as Review[]}
      counsellors={counsellors}
      monthKey={monthKey}
      target={settings?.review_monthly_target ?? 0}
      isAdmin={isAdmin(profile)}
    />
  );
}
