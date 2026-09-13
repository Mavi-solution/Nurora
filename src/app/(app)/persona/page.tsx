import { requireStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/types";
import { PersonaList } from "./persona-list";

export const metadata = { title: "Persona" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; from?: string; to?: string }>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every client's intake form, searchable and exportable by date range.
 *
 * The Persona lives on the client record rather than in its own table —
 * it is the same information the booking desk captures, completed as
 * milestone 5. Searching by name or phone is what reception actually
 * does, so both are matched.
 */
export default async function PersonaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireStaff();
  const params = await searchParams;

  const now = new Date();
  const from = params.from && DATE.test(params.from)
    ? params.from
    : key(new Date(now.getTime() - 365 * 86400000));
  const to = params.to && DATE.test(params.to) ? params.to : key(now);
  const q = (params.q ?? "").trim();

  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("*")
    .gte("created_at", `${from}T00:00:00.000Z`)
    .lte("created_at", `${to}T23:59:59.999Z`)
    .order("created_at", { ascending: false })
    .limit(500);

  if (q) {
    // Reception searches by whichever they have to hand.
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data } = await query;

  return (
    <PersonaList
      clients={(data ?? []) as Client[]}
      q={q}
      from={from}
      to={to}
      canExport={isAdmin(profile)}
    />
  );
}
