import Link from "next/link";
import { Card, CardHeader, EmptyState, Pill, Stat } from "@/components/ui";
import { isAdmin, requireStaff } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Nubills" };
export const dynamic = "force-dynamic";

/**
 * The pasted-billing log. An admin sees every counsellor's; a counsellor
 * sees only their own — enforced by the RLS policy on nubills, which
 * joins back to the appointment's counsellor.
 *
 * The raw pasted text is the record. The parsed amount and reference
 * are advisory, shown alongside rather than instead of it, because the
 * parse is best-effort and must never be mistaken for the invoice.
 */
export default async function NubillsPage() {
  const { profile } = await requireStaff();
  const admin = isAdmin(profile);

  const supabase = await createClient();
  const { data } = await supabase
    .from("nubills")
    .select(
      `*, appointment:appointments (
         id, title, starts_at,
         client:clients!appointments_client_id_fkey (full_name),
         counsellor:profiles!appointments_counsellor_id_fkey (full_name)
       )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const bills = data ?? [];
  const total = bills.reduce(
    (sum, b) => sum + ((b.parsed_amount_cents as number) ?? 0),
    0,
  );
  const unparsed = bills.filter((b) => b.parsed_amount_cents === null).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Nubills</h1>
        <p className="text-[13px] text-muted mt-0.5">
          {admin ? "Every counsellor's" : "Your"} billing log — whatever was
          pasted in when a session was settled.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Entries" value={String(bills.length)} />
        <Stat label="Amount read" value={formatMoney(total)} sub="from parsed text" />
        <Stat label="Unparsed" value={String(unparsed)} sub="amount not recognised" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Billing entries"
          description="Logged as milestone 4 on an appointment."
        />
        {bills.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            description="Complete the NuBills step on a session to add one."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {bills.map((b) => {
              const appt = Array.isArray(b.appointment) ? b.appointment[0] : b.appointment;
              const client = appt && (Array.isArray(appt.client) ? appt.client[0] : appt.client);
              const counsellor = appt && (Array.isArray(appt.counsellor) ? appt.counsellor[0] : appt.counsellor);
              return (
                <li key={b.id as string} className="px-5 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">
                        {client?.full_name ?? "Unknown client"}
                        {admin && counsellor?.full_name && (
                          <span className="text-muted font-normal"> · {counsellor.full_name}</span>
                        )}
                      </p>
                      <pre className="mt-2 text-[12px] whitespace-pre-wrap break-words bg-card-muted border border-hairline rounded-xl px-3 py-2">
                        {b.raw_text as string}
                      </pre>
                      <p className="text-[12px] text-faint mt-1.5">
                        Logged {new Date(b.created_at as string).toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      {b.parsed_amount_cents != null ? (
                        <p className="text-[15px] font-semibold tabular-nums">
                          {formatMoney(b.parsed_amount_cents as number)}
                        </p>
                      ) : (
                        <Pill>amount not read</Pill>
                      )}
                      {b.parsed_reference != null && (
                        <p className="text-[11px] text-faint tabular-nums">
                          ref {b.parsed_reference as string}
                        </p>
                      )}
                      {appt && (
                        <Link
                          href={`/appointments/${appt.id}`}
                          className="block text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          Open session
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-[12px] text-faint mt-3">
        The pasted text is the record. Amounts and references picked out of it
        are a convenience and never change an invoice.
      </p>
    </div>
  );
}
