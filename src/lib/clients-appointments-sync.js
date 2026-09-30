import { getSupabase } from "./supabase";

/*
 * Clients and appointments, shared across every device — the same
 * pattern counsellors-sync.js established. Two tables live here
 * together because they're wired into the app in lockstep: booking a
 * new client writes to both at once, and nothing about how they sync
 * needs to be different.
 */

function clientRowToApp(row) {
  return {
    id: row.id,
    name: row.name,
    age: row.age === "" ? "" : (Number(row.age) || row.age),
    phone: row.phone || "",
    email: row.email || "",
    notes: row.notes || "",
    category: row.category || "",
    mode: row.mode || "",
    gender: row.gender || "",
    whatsapp: row.whatsapp || "",
    parentName: row.parent_name || "",
    guardianName: row.guardian_name || "",
    persona: row.persona || undefined,
  };
}

function clientAppToRow(c) {
  return {
    id: c.id,
    name: c.name,
    age: c.age === "" || c.age == null ? "" : String(c.age),
    phone: c.phone || "",
    email: c.email || "",
    notes: c.notes || "",
    category: c.category || "",
    mode: c.mode || "",
    gender: c.gender || "",
    whatsapp: c.whatsapp || "",
    parent_name: c.parentName || "",
    guardian_name: c.guardianName || "",
    persona: c.persona || null,
    synced_at: new Date().toISOString(),
  };
}

function apptRowToApp(row) {
  return {
    id: row.id,
    date: row.date,
    counsellorId: row.counsellor_id,
    clientId: row.client_id,
    time: row.time,
    type: row.type || undefined,
    advance: Number(row.advance) || 0,
    chips: row.chips || [],
    tags: row.tags || [],
    status: row.status,
    note: row.note || "",
    category: row.category || "",
    mode: row.mode || "",
    attachmentType: row.attachment_type || null,
    attachmentNote: row.attachment_note || "",
    attachmentFileName: row.attachment_file_name || null,
    attachmentAudioData: row.attachment_audio_data || null,
    attachmentDurationSec: row.attachment_duration_sec || 0,
    attachmentExpiresAt: row.attachment_expires_at,
    paymentScreenshotName: row.payment_screenshot_name || null,
    milestone: row.milestone || 0,
    isFollowup: !!row.is_followup,
    messageSent: !!row.message_sent,
    messageSentAt: row.message_sent_at || undefined,
    callMade: !!row.call_made,
    billLogged: !!row.bill_logged,
    personaFilled: !!row.persona_filled,
    reviewedByCounsellor: !!row.reviewed_by_counsellor,
    cancelType: row.cancel_type || undefined,
    refundStatus: row.refund_status || undefined,
    cancelReason: row.cancel_reason || undefined,
    rescheduleStatus: row.reschedule_status || undefined,
    rescheduleReason: row.reschedule_reason || undefined,
    rescheduledFromId: row.rescheduled_from_id || undefined,
    rescheduledToId: row.rescheduled_to_id || undefined,
    createdAt: Number(row.created_at),
  };
}

function apptAppToRow(a) {
  return {
    id: a.id,
    date: a.date,
    counsellor_id: a.counsellorId || null,
    client_id: a.clientId || null,
    time: a.time,
    type: a.type || null,
    advance: Number(a.advance) || 0,
    chips: a.chips || [],
    tags: a.tags || [],
    status: a.status || "Scheduled",
    note: a.note || "",
    category: a.category || "",
    mode: a.mode || "",
    attachment_type: a.attachmentType || null,
    attachment_note: a.attachmentNote || "",
    attachment_file_name: a.attachmentFileName || null,
    attachment_audio_data: a.attachmentAudioData || null,
    attachment_duration_sec: a.attachmentDurationSec || 0,
    attachment_expires_at: a.attachmentExpiresAt || null,
    payment_screenshot_name: a.paymentScreenshotName || null,
    milestone: a.milestone || 0,
    is_followup: !!a.isFollowup,
    message_sent: !!a.messageSent,
    message_sent_at: a.messageSentAt || null,
    call_made: !!a.callMade,
    bill_logged: !!a.billLogged,
    persona_filled: !!a.personaFilled,
    reviewed_by_counsellor: !!a.reviewedByCounsellor,
    cancel_type: a.cancelType || null,
    refund_status: a.refundStatus || null,
    cancel_reason: a.cancelReason || null,
    reschedule_status: a.rescheduleStatus || null,
    reschedule_reason: a.rescheduleReason || null,
    rescheduled_from_id: a.rescheduledFromId || null,
    rescheduled_to_id: a.rescheduledToId || null,
    created_at: a.createdAt || Date.now(),
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

export const loadClients = () => loadTable("clients", clientRowToApp);
export const loadAppointments = () => loadTable("appointments", apptRowToApp);

export async function upsertClientRow(c) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("clients").upsert(clientAppToRow(c));
}
export async function upsertAppointmentRow(a) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("appointments").upsert(apptAppToRow(a));
}

/* Neither table is ever hard-deleted by the app today — a client stays
 * on file and an appointment is marked Cancelled rather than removed —
 * so there is no deleteClientRow / deleteAppointmentRow here. Adding
 * one is a five-minute change if that ever becomes untrue; adding it
 * now for a path nothing calls is just a way to introduce an untested
 * one. */

export async function seedClientsAndAppointmentsIfEmpty(localClients, localAppointments) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { count } = await supabase.from("clients").select("id", { count: "exact", head: true });
  if (count && count > 0) return false;
  let ok = true;
  if (localClients && localClients.length) {
    const { error } = await supabase.from("clients").insert(localClients.map(clientAppToRow));
    if (error) ok = false;
  }
  if (localAppointments && localAppointments.length) {
    // Clients first: appointments reference them, and a foreign key
    // pointing at a row that doesn't exist yet fails the whole insert.
    const { error } = await supabase.from("appointments").insert(localAppointments.map(apptAppToRow));
    if (error) ok = false;
  }
  return ok;
}

export function subscribeClients(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("clients-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, (payload) => {
      onChange(payload.eventType === "INSERT" ? "insert" : "update", clientRowToApp(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeAppointments(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("appointments-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, (payload) => {
      onChange(payload.eventType === "INSERT" ? "insert" : "update", apptRowToApp(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
