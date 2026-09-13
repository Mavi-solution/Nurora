"use server";

import { isAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BricRow, BricTab } from "@/lib/types";

/**
 * BRIC — Booked / Reschedule / Interest / Cancelled.
 *
 * Not its own data: a filtered view over appointments and interests, as
 * the handoff describes. The four tabs are genuinely different slices,
 * not one query with a status filter:
 *
 *   Booked      live bookings
 *   Reschedule  the ORIGINAL of a moved session, which is why the
 *               reschedule history from migration 0006 matters — it is
 *               what lets this read "moved to <date>" rather than
 *               showing a bare cancellation
 *   Interest    leads who have not paid and hold no slot
 *   Cancelled   cancelled outright, EXCLUDING the moved ones so a
 *               reschedule is not double-counted as a cancellation
 *
 * Contact details are stripped for non-admins.
 */
export async function loadBric(
  tab: BricTab,
  range: { from: string; to: string },
): Promise<{ rows: BricRow[]; canSeeContacts: boolean }> {
  const { profile } = await requireStaff();
  const supabase = await createClient();
  const admin = isAdmin(profile);

  // Dates are day keys; widen to cover the whole closing day.
  const from = `${range.from}T00:00:00.000Z`;
  const to = `${range.to}T23:59:59.999Z`;

  if (tab === "interest") {
    const { data } = await supabase
      .from("interests")
      .select(
        `id, full_name, whatsapp, on_date, status, created_at, mode,
         service:services (name, price_cents),
         counsellor:profiles!interests_counsellor_id_fkey (full_name)`,
      )
      .eq("status", "scheduled")
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(500);

    return {
      canSeeContacts: admin,
      rows: (data ?? []).map((r) => ({
        id: r.id as string,
        client: r.full_name as string,
        phone: admin ? ((r.whatsapp as string) ?? null) : null,
        counsellor: one(r.counsellor)?.full_name ?? null,
        service: one(r.service)?.name ?? null,
        when: (r.on_date as string) ?? null,
        status: "Interest",
        detail: "Not paid — holds no slot",
        href: "/interests",
      })),
    };
  }

  let query = supabase
    .from("appointments")
    .select(
      `id, starts_at, status, title, cancel_reason, reschedule_status,
       rescheduled_to_id, created_at,
       client:clients!appointments_client_id_fkey (full_name, phone),
       counsellor:profiles!appointments_counsellor_id_fkey (full_name),
       service:services (name)`,
    )
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at", { ascending: false })
    .limit(500);

  if (tab === "booked") {
    query = query.in("status", ["scheduled", "in_progress", "completed"]);
  } else if (tab === "reschedule") {
    query = query.eq("reschedule_status", "moved");
  } else {
    // Cancelled outright. A moved session is a reschedule, not a
    // cancellation, even though its row is cancelled.
    query = query.eq("status", "cancelled").is("reschedule_status", null);
  }

  const { data } = await query;
  const rows = data ?? [];

  // For the reschedule tab, look up where each one went.
  const movedTo = new Map<string, string>();
  if (tab === "reschedule") {
    const ids = rows
      .map((r) => r.rescheduled_to_id as string | null)
      .filter((v): v is string => Boolean(v));

    if (ids.length > 0) {
      const { data: targets } = await supabase
        .from("appointments")
        .select("id, starts_at")
        .in("id", ids);
      for (const t of targets ?? []) {
        movedTo.set(t.id as string, t.starts_at as string);
      }
    }
  }

  return {
    canSeeContacts: admin,
    rows: rows.map((r) => ({
      id: r.id as string,
      client: one(r.client)?.full_name ?? "Unknown",
      phone: admin ? (one(r.client)?.phone ?? null) : null,
      counsellor: one(r.counsellor)?.full_name ?? null,
      service: one(r.service)?.name ?? (r.title as string) ?? null,
      when: r.starts_at as string,
      status:
        tab === "booked"
          ? statusLabel(r.status as string)
          : tab === "reschedule"
            ? "Rescheduled"
            : "Cancelled",
      detail:
        tab === "reschedule"
          ? movedTo.has(r.rescheduled_to_id as string)
            ? `Moved to ${new Date(movedTo.get(r.rescheduled_to_id as string)!).toLocaleString()}`
            : "Moved"
          : ((r.cancel_reason as string) ?? ""),
      href: `/appointments/${r.id}`,
    })),
  };
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function statusLabel(s: string): string {
  return s === "in_progress"
    ? "In session"
    : s.charAt(0).toUpperCase() + s.slice(1);
}
