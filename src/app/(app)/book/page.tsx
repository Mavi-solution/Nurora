import { redirect } from "next/navigation";
import { isStaff, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateKeyInTimeZone } from "@/lib/time";
import type { CounsellorSummary, Specialism } from "@/lib/types";
import { BookingDesk } from "./booking-desk";

export const metadata = { title: "Book a session" };
export const dynamic = "force-dynamic";

/**
 * The call desk. Clients ring in; whoever picks up captures their
 * details and books them against a counsellor's real availability.
 */
export default async function BookPage() {
  const { profile } = await requireSession();
  if (!isStaff(profile)) redirect("/my");

  const supabase = await createClient();

  const [{ data: specialisms }, { data: counsellors }, { data: languageRows }] =
    await Promise.all([
      supabase
        .from("specialisms")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("profiles")
        .select(
          "id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency, languages",
        )
        .eq("role", "counsellor")
        .eq("is_active", true)
        .order("full_name"),
      supabase.from("profiles").select("languages").eq("role", "counsellor"),
    ]);

  // The language filter offers only what someone here can actually speak.
  const languages = [
    ...new Set(
      (languageRows ?? []).flatMap((r) => (r.languages ?? []) as string[]),
    ),
  ].sort();

  return (
    <BookingDesk
      profile={profile}
      specialisms={(specialisms ?? []) as Specialism[]}
      counsellors={(counsellors ?? []) as CounsellorSummary[]}
      languages={languages}
      todayKey={dateKeyInTimeZone(new Date(), profile.timezone)}
    />
  );
}
