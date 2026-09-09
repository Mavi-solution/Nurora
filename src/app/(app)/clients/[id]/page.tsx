import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Card, CardHeader, EmptyState, InvoiceBadge, Pill, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Appointment, Client, Invoice } from "@/lib/types";
import { ClientEditor } from "./client-editor";

export const dynamic = "force-dynamic";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireStaff();
  const supabase = await createClient();

  const { data: record } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!record) notFound();
  const client = record as Client;

  const [{ data: appointments }, { data: invoices }, { data: counsellors }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .eq("client_id", id)
        .order("starts_at", { ascending: false })
        .limit(50),
      supabase.from("invoices").select("*").eq("client_id", id),
      supabase
        .from("profiles")
        .select("id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency")
        .eq("role", "counsellor")
        .order("full_name"),
    ]);

  const sessions = (appointments ?? []) as Appointment[];
  const bills = (invoices ?? []) as Invoice[];
  const tz = profile.timezone;

  const completed = sessions.filter((s) => s.status === "completed").length;
  const outstanding = bills
    .filter((b) => b.status === "unpaid")
    .reduce((sum, b) => sum + b.amount_cents, 0);
  const paid = bills
    .filter((b) => b.status === "paid")
    .reduce((sum, b) => sum + b.amount_cents, 0);
  const invoiceByAppointment = new Map(bills.map((b) => [b.appointment_id, b]));

  return (
    <div className="max-w-4xl">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-body transition-colors mb-5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        All clients
      </Link>

      <div className="flex items-center gap-4 mb-6">
        <Avatar name={client.full_name} size={56} />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight truncate">
            {client.full_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {client.age != null && <Pill>{client.age} yrs</Pill>}
            {client.phone && <Pill>{client.phone}</Pill>}
            {client.email && <Pill>{client.email}</Pill>}
            {client.user_id && <Pill>Has login</Pill>}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <StatTile label="Sessions" value={String(sessions.length)} sub={`${completed} completed`} />
        <StatTile label="Paid" value={formatMoney(paid, profile.currency)} />
        <StatTile
          label="Outstanding"
          value={formatMoney(outstanding, profile.currency)}
          sub={outstanding > 0 ? "Awaiting payment" : "All settled"}
        />
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
        <Card>
          <CardHeader title="Session history" />
          {sessions.length === 0 ? (
            <EmptyState title="No sessions yet" description="Book one from the schedule board." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {sessions.map((session) => {
                const invoice = invoiceByAppointment.get(session.id);
                return (
                  <li key={session.id}>
                    <Link
                      href={`/appointments/${session.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-card-muted transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium truncate">
                          {formatDateTime(session.starts_at, tz)}
                        </p>
                        <p className="text-[12px] text-muted">
                          {formatDuration(
                            Math.round(
                              (new Date(session.ends_at).getTime() -
                                new Date(session.starts_at).getTime()) /
                                60_000,
                            ),
                          )}
                          {" · "}
                          {formatMoney(session.price_cents, session.currency)}
                        </p>
                      </div>
                      <StatusBadge status={session.status} />
                      {invoice && <InvoiceBadge status={invoice.status} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <ClientEditor
          client={client}
          counsellors={(counsellors ?? []).map((c) => ({
            id: c.id as string,
            full_name: c.full_name as string,
          }))}
        />
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[12px] uppercase tracking-[0.1em] text-faint font-medium">{label}</p>
      <p className="font-display text-xl font-semibold mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[12px] text-muted mt-0.5">{sub}</p>}
    </Card>
  );
}
