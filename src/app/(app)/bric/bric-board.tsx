"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, EmptyState, Pill } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { BricRow, BricTab } from "@/lib/types";

const TABS: { value: BricTab; label: string; hint: string }[] = [
  { value: "booked", label: "Booked", hint: "Live bookings in the window." },
  {
    value: "reschedule",
    label: "Reschedule",
    hint: "Sessions that were moved. The original is kept, which is what lets this show where it went.",
  },
  {
    value: "interest",
    label: "Interest",
    hint: "Leads who have not paid. These hold no slot.",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    hint: "Cancelled outright. Moved sessions appear under Reschedule, not here.",
  },
];

/**
 * A fast four-tab read on appointment activity. Contact details are
 * stripped server-side for non-admins, so the counsellor view genuinely
 * cannot see phone numbers rather than merely hiding them.
 */
export function BricBoard({
  tab,
  rows,
  canSeeContacts,
  from,
  to,
}: {
  tab: BricTab;
  rows: BricRow[];
  canSeeContacts: boolean;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const active = TABS.find((t) => t.value === tab)!;

  function go(next: Partial<{ tab: string; from: string; to: string }>) {
    const s = new URLSearchParams({ tab, from, to, ...next });
    router.push(`/bric?${s}`);
  }

  function exportCsv() {
    const columns = [
      { key: "client", label: "Client" },
      ...(canSeeContacts ? [{ key: "phone", label: "Phone" }] : []),
      { key: "counsellor", label: "Counsellor" },
      { key: "service", label: "Service" },
      { key: "when", label: "When" },
      { key: "status", label: "Status" },
      { key: "detail", label: "Detail" },
    ];
    downloadCsv(`nurora-${tab}-${from}-to-${to}.csv`, toCsv(rows, columns));
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">BRIC</h1>
        <p className="text-[13px] text-muted mt-0.5">
          Booked · Reschedule · Interest · Cancelled — a fast read on activity.
          {!canSeeContacts && " Contact details are admin-only."}
        </p>
      </div>

      {/* A named landmark: rows now carry their own "Reschedule" link,
          so "the Reschedule link" is ambiguous without it. */}
      <nav aria-label="BRIC tabs" className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/bric?tab=${t.value}&from=${from}&to=${to}`}
            className={`h-9 px-4 grid place-items-center rounded-full border text-[13px] transition-colors ${
              tab === t.value
                ? "bg-brand-700 border-brand-700 text-white font-medium"
                : "border-hairline hover:bg-card-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="w-52">
          <DateField label="From" value={from} max={to} onChange={(v) => go({ from: v })} />
        </div>
        <div className="w-52">
          <DateField label="To" value={to} min={from} onChange={(v) => go({ to: v })} />
        </div>
        <div className="flex-1" />
        <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title={`${active.label} — ${rows.length}`}
          description={active.hint}
        />

        {rows.length === 0 ? (
          <EmptyState title="Nothing in this window" description="Widen the dates above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  {canSeeContacts && <th className="px-3 py-2.5 font-medium">Phone</th>}
                  <th className="px-3 py-2.5 font-medium">Counsellor</th>
                  <th className="px-3 py-2.5 font-medium">Service</th>
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-5 py-2.5 font-medium">Detail</th>
                  <th className="px-5 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-card-muted transition-colors">
                    <td className="px-5 py-3">
                      <Link href={r.href} className="font-medium hover:underline underline-offset-2">
                        {r.client}
                      </Link>
                    </td>
                    {canSeeContacts && (
                      <td className="px-3 py-3 text-muted tabular-nums">{r.phone ?? "—"}</td>
                    )}
                    <td className="px-3 py-3 text-muted">{r.counsellor ?? "—"}</td>
                    <td className="px-3 py-3 text-muted">{r.service ?? "—"}</td>
                    <td className="px-3 py-3 text-muted tabular-nums">
                      {r.when ? new Date(r.when).toLocaleString([], {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                      }) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <Pill>{r.status}</Pill>
                      {r.detail && <span className="ml-2 text-muted">{r.detail}</span>}
                    </td>
                    {/*
                      The route into rescheduling. The Reschedule tab
                      could only ever be empty before this, because
                      nothing anywhere in the app moved a session — so
                      the tab looked broken when it was the way in that
                      was missing.
                    */}
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {r.canReschedule ? (
                        <Link
                          href={`${r.href}?reschedule=1`}
                          className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          Reschedule
                        </Link>
                      ) : r.movedToId ? (
                        <Link
                          href={`/appointments/${r.movedToId}`}
                          className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          Open new session
                        </Link>
                      ) : (
                        <span className="text-[12px] text-faint">—</span>
                      )}
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
