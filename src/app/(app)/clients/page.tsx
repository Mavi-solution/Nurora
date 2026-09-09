import Link from "next/link";
import { Avatar, Card, EmptyState, Pill } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client, CounsellorSummary } from "@/lib/types";
import { NewClientButton } from "./new-client";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireStaff();
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select("*")
    .eq("is_active", true)
    .order("full_name");

  if (q?.trim()) query = query.ilike("full_name", `%${q.trim()}%`);

  const [{ data: clients }, { data: counsellors }] = await Promise.all([
    query,
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency")
      .eq("role", "counsellor")
      .order("full_name"),
  ]);

  const list = (clients ?? []) as Client[];
  const counsellorList = (counsellors ?? []) as CounsellorSummary[];
  const nameById = new Map(counsellorList.map((c) => [c.id, c.full_name]));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-[13px] text-muted mt-0.5">
            {list.length} active {list.length === 1 ? "client" : "clients"}
          </p>
        </div>
        <div className="flex-1" />
        <form className="flex-1 sm:flex-none sm:w-64">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name…"
            aria-label="Search clients"
            className="w-full rounded-full border border-hairline bg-card px-4 py-2 text-[13px] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 focus:outline-none"
          />
        </form>
        <NewClientButton counsellors={counsellorList} />
      </div>

      <Card>
        {list.length === 0 ? (
          <EmptyState
            title={q ? "No matches" : "No clients yet"}
            description={
              q
                ? "Try a different name."
                : "Add a client here, or create one on the fly from Quick book."
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {list.map((client) => (
              <li key={client.id}>
                <Link
                  href={`/clients/${client.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-card-muted transition-colors"
                >
                  <Avatar name={client.full_name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[14px] truncate">{client.full_name}</p>
                    <p className="text-[12px] text-muted truncate">
                      {[client.phone, client.email].filter(Boolean).join(" · ") || "No contact details"}
                    </p>
                  </div>
                  {client.age != null && <Pill>{client.age} yrs</Pill>}
                  {client.counsellor_id && (
                    <span className="hidden sm:block text-[12px] text-muted">
                      {nameById.get(client.counsellor_id) ?? "—"}
                    </span>
                  )}
                  {client.user_id && <Pill>Has login</Pill>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
