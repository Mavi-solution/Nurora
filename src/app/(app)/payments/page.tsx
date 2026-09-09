import { Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Appointment, Client, Invoice, InvoiceStatus, Profile } from "@/lib/types";
import { InvoiceTable } from "./invoice-table";
import { StatusFilter } from "./status-filter";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const STATUSES: InvoiceStatus[] = ["unpaid", "paid", "refunded", "waived", "draft"];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as InvoiceStatus)
    ? (params.status as InvoiceStatus)
    : "all";

  const supabase = await createClient();

  let query = supabase
    .from("invoices")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(200);

  if (status !== "all") query = query.eq("status", status);

  const { data: invoiceRows } = await query;
  const invoices = (invoiceRows ?? []) as Invoice[];

  // Totals are computed across everything, not just the current filter.
  const { data: allRows } = await supabase.from("invoices").select("amount_cents, status");
  const all = (allRows ?? []) as Pick<Invoice, "amount_cents" | "status">[];

  const sum = (s: InvoiceStatus) =>
    all.filter((i) => i.status === s).reduce((total, i) => total + i.amount_cents, 0);

  const appointmentIds = invoices.map((i) => i.appointment_id);
  const clientIds = [...new Set(invoices.map((i) => i.client_id))];
  const counsellorIds = [...new Set(invoices.map((i) => i.counsellor_id))];

  const [{ data: appointments }, { data: clients }, { data: counsellors }] =
    invoices.length > 0
      ? await Promise.all([
          supabase.from("appointments").select("id, starts_at, status").in("id", appointmentIds),
          supabase.from("clients").select("id, full_name").in("id", clientIds),
          supabase.from("profiles").select("id, full_name").in("id", counsellorIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const appointmentById = new Map(
    ((appointments ?? []) as Pick<Appointment, "id" | "starts_at" | "status">[]).map((a) => [a.id, a]),
  );
  const clientById = new Map(
    ((clients ?? []) as Pick<Client, "id" | "full_name">[]).map((c) => [c.id, c.full_name]),
  );
  const counsellorById = new Map(
    ((counsellors ?? []) as Pick<Profile, "id" | "full_name">[]).map((c) => [c.id, c.full_name]),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-[13px] text-muted mt-0.5">
          An invoice is raised with every booking and settled here by hand.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <Stat label="Outstanding" value={formatMoney(sum("unpaid"), profile.currency)} sub="Unpaid invoices" />
        <Stat label="Collected" value={formatMoney(sum("paid"), profile.currency)} sub="Marked paid" />
        <Stat
          label="Written off"
          value={formatMoney(sum("waived") + sum("refunded"), profile.currency)}
          sub="Waived or refunded"
        />
      </div>

      <Card>
        <CardHeader
          title="Invoices"
          description={`${invoices.length} shown${status !== "all" ? ` · ${status}` : ""}`}
          action={<StatusFilter value={status} options={STATUSES} />}
        />

        {invoices.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description="Invoices appear as soon as sessions are booked."
          />
        ) : (
          <InvoiceTable
            invoices={invoices.map((invoice) => ({
              invoice,
              clientName: clientById.get(invoice.client_id) ?? "—",
              counsellorName: counsellorById.get(invoice.counsellor_id) ?? "—",
              startsAt: appointmentById.get(invoice.appointment_id)?.starts_at ?? null,
            }))}
            timezone={profile.timezone}
          />
        )}
      </Card>
    </div>
  );
}
