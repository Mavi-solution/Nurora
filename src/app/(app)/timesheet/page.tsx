import { Card, CardHeader, EmptyState, Pill, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Profile, StaffShift, TimeEntry } from "@/lib/types";

export const metadata = { title: "Timesheet" };
export const dynamic = "force-dynamic";

export default async function TimesheetPage() {
  const { profile } = await requireStaff();
  const supabase = await createClient();
  const tz = profile.timezone;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: shiftRows }, { data: entryRows }] = await Promise.all([
    supabase
      .from("staff_shifts")
      .select("*")
      .gte("checked_in_at", since)
      .order("checked_in_at", { ascending: false })
      .limit(100),
    supabase
      .from("time_entries")
      .select("*")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  const shifts = (shiftRows ?? []) as StaffShift[];
  const entries = (entryRows ?? []) as TimeEntry[];

  const staffIds = [...new Set(shifts.map((s) => s.staff_id))];
  const appointmentIds = [...new Set(entries.map((e) => e.appointment_id))];

  const [{ data: staffRows }, { data: appointmentRows }] = await Promise.all([
    staffIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [] }),
    appointmentIds.length
      ? supabase
          .from("appointments")
          .select("id, client_id, starts_at, clients(full_name)")
          .in("id", appointmentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const staffName = new Map(
    ((staffRows ?? []) as Pick<Profile, "id" | "full_name">[]).map((s) => [s.id, s.full_name]),
  );

  const clientName = new Map<string, string>();
  for (const row of (appointmentRows ?? []) as {
    id: string;
    clients: { full_name: string } | { full_name: string }[] | null;
  }[]) {
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    clientName.set(row.id, client?.full_name ?? "—");
  }

  const attendanceMinutes = shifts.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const billedMinutes = entries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
  const earned = Math.round((profile.hourly_rate_cents * billedMinutes) / 60);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Timesheet</h1>
        <p className="text-[13px] text-muted mt-0.5">Last 30 days.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <Stat
          label="On shift"
          value={formatDuration(attendanceMinutes)}
          sub={`${shifts.length} check-ins`}
        />
        <Stat
          label="Session time"
          value={formatDuration(billedMinutes)}
          sub={`${entries.length} entries`}
        />
        <Stat
          label="At your rate"
          value={formatMoney(earned, profile.currency)}
          sub={
            profile.hourly_rate_cents
              ? `${formatMoney(profile.hourly_rate_cents, profile.currency)}/hour`
              : "Set an hourly rate in Settings"
          }
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader title="Session time" description="Timers against appointments." />
          {entries.length === 0 ? (
            <EmptyState title="No time tracked yet" description="Start a session from the schedule." />
          ) : (
            <ul className="divide-y divide-[var(--border)] max-h-[28rem] overflow-y-auto">
              {entries.map((entry) => (
                <li key={entry.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium truncate">
                      {clientName.get(entry.appointment_id) ?? "Session"}
                    </p>
                    <p className="text-[12px] text-muted">
                      {formatDateTime(entry.started_at, tz)}
                    </p>
                  </div>
                  <Pill>{entry.source}</Pill>
                  <span className="tabular-nums text-[13px] font-medium w-14 text-right">
                    {entry.ended_at ? formatDuration(entry.duration_minutes ?? 0) : "running"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Attendance" description="Check-in and check-out." />
          {shifts.length === 0 ? (
            <EmptyState title="No check-ins yet" description="Use the toggle at the top of the schedule." />
          ) : (
            <ul className="divide-y divide-[var(--border)] max-h-[28rem] overflow-y-auto">
              {shifts.map((shift) => (
                <li key={shift.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium truncate">
                      {staffName.get(shift.staff_id) ?? "Staff"}
                    </p>
                    <p className="text-[12px] text-muted">
                      {formatDateTime(shift.checked_in_at, tz)}
                    </p>
                  </div>
                  <span className="tabular-nums text-[13px] font-medium w-16 text-right">
                    {shift.checked_out_at
                      ? formatDuration(shift.duration_minutes ?? 0)
                      : "on shift"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
