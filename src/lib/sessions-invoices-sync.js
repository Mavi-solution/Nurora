import { getSupabase } from "./supabase";

/*
 * Sessions and invoices, shared across every device — same pattern as
 * clients-appointments-sync.js. Kept together for the same reason
 * those two are: `endSession` creates one invoice and stamps its id
 * onto one session in the same local update, and sessions.invoice_id
 * is a foreign key — see the migration's comment for the ordering
 * this forces.
 */

function invoiceRowToApp(row) {
  return {
    id: row.id,
    number: row.number,
    date: row.date,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    counsellorId: row.counsellor_id,
    sessionDate: row.session_date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSec: row.duration_sec,
    base: Number(row.base) || 0,
    additional: Number(row.additional) || 0,
    gst: Number(row.gst) || 0,
    total: Number(row.total) || 0,
    extraMinutes: Number(row.extra_minutes) || 0,
    advance: Number(row.advance) || 0,
    paymentStatus: row.payment_status,
    createdAt: Number(row.created_at),
  };
}
function invoiceAppToRow(i) {
  return {
    id: i.id,
    number: i.number || null,
    date: i.date,
    appointment_id: i.appointmentId || null,
    client_id: i.clientId || null,
    counsellor_id: i.counsellorId || null,
    session_date: i.sessionDate || null,
    started_at: i.startedAt || null,
    ended_at: i.endedAt || null,
    duration_sec: i.durationSec || 0,
    base: i.base || 0,
    additional: i.additional || 0,
    gst: i.gst || 0,
    total: i.total || 0,
    extra_minutes: i.extraMinutes || 0,
    advance: i.advance || 0,
    payment_status: i.paymentStatus || "Pending",
    created_at: i.createdAt || Date.now(),
    synced_at: new Date().toISOString(),
  };
}

function sessionRowToApp(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    counsellorId: row.counsellor_id,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at != null ? Number(row.ended_at) : null,
    durationSec: row.duration_sec || 0,
    invoiceId: row.invoice_id,
  };
}
function sessionAppToRow(s) {
  return {
    id: s.id,
    appointment_id: s.appointmentId || null,
    counsellor_id: s.counsellorId || null,
    started_at: s.startedAt,
    ended_at: s.endedAt || null,
    duration_sec: s.durationSec || 0,
    invoice_id: s.invoiceId || null,
    synced_at: new Date().toISOString(),
  };
}

async function loadTable(table, rowToApp) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select("*");
  if (error) return null;
  return (data || []).map(rowToApp);
}

export const loadInvoices = () => loadTable("invoices", invoiceRowToApp);
export const loadSessions = () => loadTable("sessions", sessionRowToApp);

export async function upsertInvoiceRow(i) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("invoices").upsert(invoiceAppToRow(i));
}
export async function upsertSessionRow(s) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("sessions").upsert(sessionAppToRow(s));
}

/* Neither is ever hard-deleted by the app — a session and its invoice
 * are permanent record of what happened, never removed. */

/** See counsellors-sync.js's claimSeedLock for why this exists: an
 * "is the table empty" check isn't atomic, and two devices racing it
 * both seed their own, differently-id'd copy of the same local data. */
async function claimSeedLock(key) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("seed_locks").insert({ key });
  return !error;
}

export async function seedSessionsAndInvoicesIfEmpty(localInvoices, localSessions) {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!(await claimSeedLock("sessions_invoices"))) return false;
  let ok = true;
  // Invoices first: sessions.invoice_id references them.
  if (localInvoices && localInvoices.length) {
    const { error } = await supabase.from("invoices").insert(localInvoices.map(invoiceAppToRow));
    if (error) ok = false;
  }
  if (localSessions && localSessions.length) {
    const { error } = await supabase.from("sessions").insert(localSessions.map(sessionAppToRow));
    if (error) ok = false;
  }
  return ok;
}

export function subscribeInvoices(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("invoices-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, (payload) => {
      onChange(payload.eventType === "INSERT" ? "insert" : "update", invoiceRowToApp(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
export function subscribeSessions(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("sessions-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, (payload) => {
      onChange(payload.eventType === "INSERT" ? "insert" : "update", sessionRowToApp(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
