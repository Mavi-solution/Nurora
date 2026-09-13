import { Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { isAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ from?: string; to?: string }>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The check-in/out log. An admin sees everyone; a counsellor sees only
 * their own — enforced by RLS on staff_shifts, not by this query, so
 * the page cannot leak someone else's attendance by accident.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const admin = isAdmin(profile);

  const now = new Date();
  const from = params.from && DATE.test(params.from)
    ? params.from
    : key(new Date(now.getTime() - 29 * 86400000));
  const to = params.to && DATE.test(params.to) ? params.to : key(now);

  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_shifts")
    .select("*, staff:profiles(id, full_name)")
    .gte("checked_in_at", `${from}T00:00:00.000Z`)
    .lte("checked_in_at", `${to}T23:59:59.999Z`)
    .order("checked_in_at", { ascending: false })
    .limit(500);

  const shifts = data ?? [];
  const totalMinutes = shifts.reduce(
    (sum, s) => sum + ((s.duration_minutes as number) ?? 0),
    0,
  );
  const open = shifts.filter((s) => !s.checked_out_at).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="text-[13px] text-muted mt-0.5">
          {admin ? "Everyone's" : "Your"} daily check-in and check-out log.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Shifts" value={String(shifts.length)} sub={`${from} to ${to}`} />
        <Stat
          label="Hours logged"
          value={`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`}
        />
        <Stat label="Currently in" value={String(open)} sub="not checked out" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Shift log"
          description="Check in and out from the toggle at the top of the Schedule."
        />
        {shifts.length === 0 ? (
          <EmptyState title="No shifts in this window" description="Nobody has checked in." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-[0.08em] text-faint">
                  {admin && <th className="px-5 py-2.5 font-medium">Who</th>}
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">In</th>
                  <th className="px-3 py-2.5 font-medium">Out</th>
                  <th className="px-5 py-2.5 font-medium text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => {
                  const inAt = new Date(s.checked_in_at as string);
                  const outAt = s.checked_out_at ? new Date(s.checked_out_at as string) : null;
                  const mins = s.duration_minutes as number | null;
                  const staff = Array.isArray(s.staff) ? s.staff[0] : s.staff;
                  return (
                    <tr key={s.id as string} className="border-b border-hairline last:border-0">
                      {admin && (
                        <td className="px-5 py-3 font-medium">
                          {staff?.full_name ?? "—"}
                        </td>
                      )}
                      <td className="px-5 py-3">
                        {inAt.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-muted">
                        {inAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-muted">
                        {outAt
                          ? outAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : <span className="text-emerald-700 dark:text-emerald-300">still in</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[12px] text-faint mt-3">
        GPS geofencing is not yet wired up — check-in is not location-verified.
      </p>
    </div>
  );
}
