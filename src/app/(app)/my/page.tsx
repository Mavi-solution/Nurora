import Link from "next/link";
import { Card, CardHeader, EmptyState, InvoiceBadge, StatusBadge } from "@/components/ui";
import { ButtonLink } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatMoney, relativeDays } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Appointment, Invoice, Profile } from "@/lib/types";

export const metadata = { title: "My sessions" };
export const dynamic = "force-dynamic";

export default async function MySessionsPage() {
  const { profile, userId } = await requireSession();
  const supabase = await createClient();
  const tz = profile.timezone;

  const { data: clientRecord } = await supabase
    .from("clients")
    .select("id, full_name, counsellor_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!clientRecord) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-2xl font-semibold tracking-tight mb-6">
          My sessions
        </h1>
        <Card>
          <EmptyState
            title="No client record linked yet"
            description="Your practice links your account when they add you as a client with this email or phone number. Ask them to check the details on file."
          />
        </Card>
      </div>
    );
  }

  const { data: appointmentRows } = await supabase
    .from("appointments")
    .select("*")
    .eq("client_id", clientRecord.id)
    .order("starts_at", { ascending: true });

  const appointments = (appointmentRows ?? []) as Appointment[];
  const now = Date.now();
  const upcoming = appointments.filter(
    (a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled",
  );
  const past = appointments
    .filter((a) => new Date(a.starts_at).getTime() < now || a.status === "cancelled")
    .reverse();

  const counsellorIds = [...new Set(appointments.map((a) => a.counsellor_id))];
  const [{ data: counsellorRows }, { data: invoiceRows }] = await Promise.all([
    counsellorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", counsellorIds)
      : Promise.resolve({ data: [] }),
    supabase.from("invoices").select("*").eq("client_id", clientRecord.id),
  ]);

  const counsellorName = new Map(
    ((counsellorRows ?? []) as Pick<Profile, "id" | "full_name">[]).map((c) => [c.id, c.full_name]),
  );
  const invoiceByAppointment = new Map(
    ((invoiceRows ?? []) as Invoice[]).map((i) => [i.appointment_id, i]),
  );

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">My sessions</h1>
          <p className="text-[13px] text-muted mt-0.5">
            {upcoming.length} upcoming · times shown in {tz}
          </p>
        </div>
        <div className="flex-1" />
        <ButtonLink href="/my/book">Book a session</ButtonLink>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Upcoming" />
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nothing booked"
              description="Book a session and you'll get a reminder three days before."
              action={<ButtonLink href="/my/book">Book a session</ButtonLink>}
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {upcoming.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/appointments/${a.id}`}
                    className="flex items-center gap-3 px-5 py-4 hover:bg-card-muted transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">{formatDateTime(a.starts_at, tz)}</p>
                      <p className="text-[12px] text-muted mt-0.5">
                        {counsellorName.get(a.counsellor_id) ?? "Counsellor"} ·{" "}
                        {relativeDays(a.starts_at)}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card>
            <CardHeader title="Past sessions" />
            <ul className="divide-y divide-[var(--border)]">
              {past.slice(0, 20).map((a) => {
                const invoice = invoiceByAppointment.get(a.id);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/appointments/${a.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-card-muted transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] truncate">{formatDateTime(a.starts_at, tz)}</p>
                        <p className="text-[12px] text-muted">
                          {counsellorName.get(a.counsellor_id) ?? "Counsellor"} ·{" "}
                          {formatMoney(a.price_cents, a.currency)}
                        </p>
                      </div>
                      <StatusBadge status={a.status} />
                      {invoice && <InvoiceBadge status={invoice.status} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
