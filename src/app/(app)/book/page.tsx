import { redirect } from "next/navigation";
import { CLINICIAN_ROLES, isStaff, requireSession } from "@/lib/auth";
import { getCounsellors } from "@/lib/data/reference";
import { createClient } from "@/lib/supabase/server";
import { dateKeyInTimeZone } from "@/lib/time";
import type { Specialism } from "@/lib/types";
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

  // The roster comes from the shared reference loader so it arrives with
  // each counsellor's specialisms attached — the desk picks on those,
  // not on names.
  const [{ data: specialisms }, counsellors, { data: languageRows }] =
    await Promise.all([
      supabase
        .from("specialisms")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
      getCounsellors(),
      supabase.from("profiles").select("languages").in("role", CLINICIAN_ROLES),
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
      counsellors={counsellors}
      languages={languages}
      todayKey={dateKeyInTimeZone(new Date(), profile.timezone)}
    />
  );
}
