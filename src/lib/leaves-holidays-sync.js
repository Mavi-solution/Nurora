import { getSupabase } from "./supabase";

/*
 * Leaves and holidays, shared across every device. Unlike every table
 * before this one, both have a genuine delete path — removeLeave and
 * removeHoliday actually remove the record, not just flag it — so this
 * is the first of these sync modules that needs a real deleteRow.
 */

function leaveRowToApp(row) {
  return {
    id: row.id,
    counsellorId: row.counsellor_id,
    type: row.type,
    from: row.from_date,
    to: row.to_date,
    half: !!row.half,
    halfFrom: row.half_from || null,
    halfTill: row.half_till || null,
    units: Number(row.units) || 0,
    paidUnits: Number(row.paid_units) || 0,
    lopUnits: Number(row.lop_units) || 0,
    monthKey: row.month_key,
  };
}
function leaveAppToRow(l) {
  return {
    id: l.id,
    counsellor_id: l.counsellorId || null,
    type: l.type || "Leave",
    from_date: l.from,
    to_date: l.to,
    half: !!l.half,
    half_from: l.halfFrom || null,
    half_till: l.halfTill || null,
    units: l.units || 0,
    paid_units: l.paidUnits || 0,
    lop_units: l.lopUnits || 0,
    month_key: l.monthKey || null,
    synced_at: new Date().toISOString(),
  };
}

function holidayRowToApp(row) {
  return { id: row.id, date: row.date, type: row.type, label: row.label || row.type };
}
function holidayAppToRow(h) {
  return {
    id: h.id, date: h.date, type: h.type || "Holiday", label: h.label || null,
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

export const loadLeaves = () => loadTable("leaves", leaveRowToApp);
export const loadHolidays = () => loadTable("holidays", holidayRowToApp);

export async function upsertLeaveRow(l) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("leaves").upsert(leaveAppToRow(l));
}
export async function deleteLeaveRow(id) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("leaves").delete().eq("id", id);
}
export async function upsertHolidayRow(h) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("holidays").upsert(holidayAppToRow(h));
}
export async function deleteHolidayRow(id) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("holidays").delete().eq("id", id);
}

export async function seedLeavesAndHolidaysIfEmpty(localLeaves, localHolidays) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { count } = await supabase.from("leaves").select("id", { count: "exact", head: true });
  if (count && count > 0) return false;
  let ok = true;
  if (localLeaves && localLeaves.length) {
    const { error } = await supabase.from("leaves").insert(localLeaves.map(leaveAppToRow));
    if (error) ok = false;
  }
  if (localHolidays && localHolidays.length) {
    const { error } = await supabase.from("holidays").insert(localHolidays.map(holidayAppToRow));
    if (error) ok = false;
  }
  return ok;
}

export function subscribeLeaves(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("leaves-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "leaves" }, (payload) => {
      if (payload.eventType === "DELETE") onChange("delete", { id: payload.old.id });
      else onChange(payload.eventType === "INSERT" ? "insert" : "update", leaveRowToApp(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
export function subscribeHolidays(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("holidays-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "holidays" }, (payload) => {
      if (payload.eventType === "DELETE") onChange("delete", { id: payload.old.id });
      else onChange(payload.eventType === "INSERT" ? "insert" : "update", holidayRowToApp(payload.new));
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
