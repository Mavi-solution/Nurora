import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, InvoiceBadge, Pill, StatusBadge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatDuration, formatMoney, formatTimeRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Appointment, Client, Invoice, Profile, TimeEntry } from "@/lib/types";
import { AppointmentActions } from "./actions-panel";

export const dynamic = "force-dynamic";

export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireSession();
  const supabase = await createClient();

  const { data: appointment } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!appointment) notFound();
  const appt = appointment as Appointment;

  const [{ data: client }, { data: counsellor }, { data: entries }, { data: invoice }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", appt.client_id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", appt.counsellor_id).maybeSingle(),
      supabase
        .from("time_entries")
        .select("*")
        .eq("appointment_id", id)
        .order("started_at", { ascending: false }),
      supabase.from("invoices").select("*").eq("appointment_id", id).maybeSingle(),
    ]);

  const timeEntries = (entries ?? []) as TimeEntry[];
  const tracked = timeEntries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
  const running = timeEntries.find((e) => e.ended_at === null) ?? null;
  const tz = profile.timezone;
  const staff = profile.role !== "client";

  const scheduledMinutes = Math.round(
    (new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60_000,
  );

  return (
    <div className="max-w-3xl">
      <Link
        href={staff ? "/schedule" : "/my"}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-body transition-colors mb-5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Back to schedule
      </Link>

      <div className="flex flex-wrap items-start gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {(client as Client | null)?.full_name ?? "Session"}
          </h1>
          <p className="text-[14px] text-muted mt-1">
            {formatDateTime(appt.starts_at, tz)} ·{" "}
            {formatTimeRange(appt.starts_at, appt.ends_at, tz)}
          </p>
        </div>
        <div className="flex-1" />
        <StatusBadge status={appt.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Session" />
            <dl className="px-5 py-4 space-y-3 text-[14px]">
              <Row label="Counsellor" value={(counsellor as Profile | null)?.full_name ?? "—"} />
              <Row label="Client" value={(client as Client | null)?.full_name ?? "—"} />
              {(client as Client | null)?.age != null && (
                <Row label="Age" value={String((client as Client).age)} />
              )}
              <Row label="Scheduled" value={formatDuration(scheduledMinutes)} />
              <Row
                label="Tracked"
                value={
                  tracked > 0 ? formatDuration(tracked) : running ? "Running now" : "Not tracked"
                }
              />
              <Row label="Fee" value={formatMoney(appt.price_cents, appt.currency)} />
              {appt.location && <Row label="Location" value={appt.location} />}
              {appt.meeting_url && (
                <div className="flex gap-4">
                  <dt className="text-muted w-28 shrink-0">Meeting</dt>
                  <dd className="min-w-0">
                    <a
                      href={appt.meeting_url}
                      className="text-brand-700 dark:text-brand-300 hover:underline break-all"
                    >
                      {appt.meeting_url}
                    </a>
                  </dd>
                </div>
              )}
              {appt.cancel_reason && (
                <Row label="Cancelled" value={appt.cancel_reason} />
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Time entries"
              description={
                timeEntries.length === 0
                  ? "Nothing logged yet."
                  : `${timeEntries.length} entr${timeEntries.length === 1 ? "y" : "ies"} · ${formatDuration(tracked)} total`
              }
            />
            {timeEntries.length > 0 && (
              <ul className="divide-y divide-[var(--border)]">
                {timeEntries.map((entry) => (
                  <li key={entry.id} className="px-5 py-3 flex items-center gap-3 text-[13px]">
                    <span className="text-muted tabular-nums flex-1">
                      {formatDateTime(entry.started_at, tz)}
                      {entry.ended_at && ` → ${formatTimeRange(entry.started_at, entry.ended_at, tz).split("–")[1].trim()}`}
                    </span>
                    <Pill>{entry.source}</Pill>
                    <span className="tabular-nums font-medium w-16 text-right">
                      {entry.ended_at ? formatDuration(entry.duration_minutes ?? 0) : "running"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(appt.client_notes || appt.counsellor_notes) && (
            <Card>
              <CardHeader title="Notes" />
              <div className="px-5 py-4 space-y-4 text-[14px]">
                {appt.client_notes && (
                  <div>
                    <p className="text-[12px] text-faint uppercase tracking-wider mb-1">
                      From the client
                    </p>
                    <p className="whitespace-pre-wrap leading-relaxed">{appt.client_notes}</p>
                  </div>
                )}
                {appt.counsellor_notes && staff && (
                  <div>
                    <p className="text-[12px] text-faint uppercase tracking-wider mb-1">
                      Counsellor notes
                    </p>
                    <p className="whitespace-pre-wrap leading-relaxed">{appt.counsellor_notes}</p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {invoice && (
            <Card>
              <CardHeader title="Invoice" />
              <div className="px-5 py-4 space-y-3 text-[14px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">{(invoice as Invoice).number}</span>
                  <InvoiceBadge status={(invoice as Invoice).status} />
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-muted text-[13px]">Amount</span>
                  <span className="font-display text-xl font-semibold tabular-nums">
                    {formatMoney((invoice as Invoice).amount_cents, (invoice as Invoice).currency)}
                  </span>
                </div>
                {(invoice as Invoice).billed_minutes != null && (
                  <p className="text-[12px] text-muted">
                    Billed against {formatDuration((invoice as Invoice).billed_minutes ?? 0)} tracked.
                  </p>
                )}
                {staff && (
                  <Link
                    href="/payments"
                    className="block text-[13px] text-brand-700 dark:text-brand-300 hover:underline pt-1"
                  >
                    Manage in Payments →
                  </Link>
                )}
              </div>
            </Card>
          )}

          <AppointmentActions
            appointmentId={appt.id}
            status={appt.status}
            running={running}
            isStaff={staff}
            canRun={profile.role === "admin" || profile.id === appt.counsellor_id}
            counsellorNotes={appt.counsellor_notes ?? ""}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <dt className="text-muted w-28 shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
