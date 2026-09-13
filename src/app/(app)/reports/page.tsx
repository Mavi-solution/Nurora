import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, Stat, fieldClass } from "@/components/ui";
import { isAdmin, requireStaff } from "@/lib/auth";
import { milestoneProgress } from "@/lib/business/milestones";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ from?: string; to?: string }>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Aggregate numbers per counsellor.
 *
 * "Completed" uses the five-milestone rule from business/milestones.ts,
 * NOT merely a completed session — the same definition the schedule
 * shows, so the two can never disagree. Revenue counts invoices marked
 * paid rather than prices booked, so it reflects money actually taken.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  if (!isAdmin(profile)) redirect("/schedule");

  const params = await searchParams;
  const now = new Date();

  // The WHOLE current month, not month-start to today. A clinic books
  // ahead, so a window that stops at today hides everything scheduled
  // for the rest of the month and reads as "no data" when the diary is
  // in fact full.
  const from = params.from && DATE.test(params.from)
    ? params.from
    : key(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = params.to && DATE.test(params.to)
    ? params.to
    : key(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const supabase = await createClient();
  const [{ data: appts }, { data: invoices }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        `id, status, counsellor_id, price_cents, message_sent_at, call_made_at,
         nubill_at, persona_at,
         counsellor:profiles!appointments_counsellor_id_fkey (full_name)`,
      )
      .gte("starts_at", `${from}T00:00:00.000Z`)
      .lte("starts_at", `${to}T23:59:59.999Z`),
    supabase
      .from("invoices")
      .select("counsellor_id, amount_cents, status, paid_at")
      .gte("issued_at", `${from}T00:00:00.000Z`)
      .lte("issued_at", `${to}T23:59:59.999Z`),
  ]);

  type Row = {
    name: string;
    booked: number;
    completed: number;
    cancelled: number;
    noShow: number;
    revenue: number;
  };

  const byCounsellor = new Map<string, Row>();
  const row = (id: string, name: string): Row => {
    const existing = byCounsellor.get(id);
    if (existing) return existing;
    const fresh = { name, booked: 0, completed: 0, cancelled: 0, noShow: 0, revenue: 0 };
    byCounsellor.set(id, fresh);
    return fresh;
  };

  for (const a of appts ?? []) {
    const c = Array.isArray(a.counsellor) ? a.counsellor[0] : a.counsellor;
    const r = row(a.counsellor_id as string, c?.full_name ?? "Unknown");

    if (a.status === "cancelled") r.cancelled += 1;
    else if (a.status === "no_show") r.noShow += 1;
    else {
      r.booked += 1;
      // The five-milestone rule, not just a finished session.
      if (milestoneProgress(a as never).allDone) r.completed += 1;
    }
  }

  for (const inv of invoices ?? []) {
    if (inv.status !== "paid") continue;
    const r = byCounsellor.get(inv.counsellor_id as string);
    if (r) r.revenue += (inv.amount_cents as number) ?? 0;
  }

  const rows = [...byCounsellor.values()].sort((a, b) => b.booked - a.booked);
  const totals = rows.reduce(
    (t, r) => ({
      booked: t.booked + r.booked,
      completed: t.completed + r.completed,
      cancelled: t.cancelled + r.cancelled,
      revenue: t.revenue + r.revenue,
    }),
    { booked: 0, completed: 0, cancelled: 0, revenue: 0 },
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-[13px] text-muted mt-0.5">
          {from} to {to}. &ldquo;Completed&rdquo; means all five milestones
          done, not merely that the session ran.
        </p>
      </div>

      {/* A plain GET form: no client JS needed to change the window. */}
      <form action="/reports" className="flex flex-wrap items-end gap-3 mb-5">
        <label className="text-[12px] text-muted">
          From
          <input type="date" name="from" defaultValue={from} className={`${fieldClass} mt-1`} />
        </label>
        <label className="text-[12px] text-muted">
          To
          <input type="date" name="to" defaultValue={to} className={`${fieldClass} mt-1`} />
        </label>
        <button
          type="submit"
          className="h-10 px-5 rounded-full border border-[var(--border-strong)] bg-card text-sm font-medium hover:bg-card-muted transition-colors"
        >
          Apply
        </button>
      </form>

      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Booked" value={String(totals.booked)} />
        <Stat
          label="Completed"
          value={String(totals.completed)}
          sub={totals.booked ? `${Math.round((totals.completed / totals.booked) * 100)}% of booked` : undefined}
        />
        <Stat label="Cancelled" value={String(totals.cancelled)} />
        <Stat label="Revenue" value={formatMoney(totals.revenue)} sub="invoices marked paid" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="By counsellor" />
        {rows.length === 0 ? (
          <EmptyState title="Nothing in this window" description="No appointments in the period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 font-medium">Counsellor</th>
                  <th className="px-3 py-2.5 font-medium text-right">Booked</th>
                  <th className="px-3 py-2.5 font-medium text-right">Completed</th>
                  <th className="px-3 py-2.5 font-medium text-right">Cancelled</th>
                  <th className="px-3 py-2.5 font-medium text-right">No-show</th>
                  <th className="px-5 py-2.5 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-3 font-medium">{r.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.booked}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.completed}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{r.cancelled}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{r.noShow}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">
                      {formatMoney(r.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
