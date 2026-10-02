import { getSupabase } from "./supabase";

/*
 * The counsellor roster, shared across every device.
 *
 * The rest of the app works in camelCase objects shaped exactly like
 * the ones `seed()` in nurora-app.jsx has always produced — slots,
 * weekOffDates, isNuLancer, accountStatus, and so on. Postgres speaks
 * snake_case. These two functions are the only place that translation
 * happens, so nothing else in the app needs to know the roster now
 * lives in a database rather than localStorage.
 *
 * `id` is kept as the app's own uid("c") string — see the migration's
 * comment for why — so a row round-trips through `rowToApp` and back
 * through `appToRow` without ever needing a second id.
 */
function rowToApp(row) {
  return {
    id: row.id,
    profileId: row.profile_id || null,
    email: row.email || "",
    name: row.name,
    role: row.role,
    workStart: row.work_start,
    workEnd: row.work_end,
    slots: row.slots || [],
    weekOffDates: row.week_off_dates || {},
    dayExceptions: row.day_exceptions || {},
    slotOverrides: row.slot_overrides || {},
    pin: row.pin,
    active: row.active,
    isNuLancer: row.is_nulancer,
    isOwner: row.is_owner,
    accountStatus: row.account_status,
    tpin: row.tpin,
    mpin: row.mpin,
    probationFrom: row.probation_from,
    probationTo: row.probation_to,
    personalPhone: row.personal_phone || "",
    bloodGroup: row.blood_group || "",
    aadharImage: row.aadhar_image || null,
    businessPhone: row.business_phone || "",
    dob: row.dob || "",
    dateOfJoining: row.date_of_joining || "",
    photo: row.photo || null,
    agreementSignedAt: row.agreement_signed_at,
    signatureDataUrl: row.signature_data_url,
    frontPageTextOverride: row.front_page_text_override,
    agreementAgreeTextOverride: row.agreement_agree_text_override,
    benefitsEnabled: row.benefits_enabled,
    benefits: row.benefits || [],
    permissions: row.permissions || {},
    workHoursEnabled: row.work_hours_enabled,
  };
}

function appToRow(c) {
  return {
    id: c.id,
    profile_id: c.profileId || null,
    email: c.email || null,
    name: c.name,
    role: c.role,
    work_start: c.workStart,
    work_end: c.workEnd,
    slots: c.slots || [],
    week_off_dates: c.weekOffDates || {},
    day_exceptions: c.dayExceptions || {},
    slot_overrides: c.slotOverrides || {},
    pin: c.pin || null,
    active: c.active !== false,
    is_nulancer: !!c.isNuLancer,
    is_owner: !!c.isOwner,
    account_status: c.accountStatus || "tpin",
    tpin: c.tpin || null,
    mpin: c.mpin || null,
    probation_from: c.probationFrom || null,
    probation_to: c.probationTo || null,
    personal_phone: c.personalPhone || "",
    blood_group: c.bloodGroup || "",
    aadhar_image: c.aadharImage || null,
    business_phone: c.businessPhone || "",
    dob: c.dob || "",
    date_of_joining: c.dateOfJoining || "",
    photo: c.photo || null,
    agreement_signed_at: c.agreementSignedAt || null,
    signature_data_url: c.signatureDataUrl || null,
    front_page_text_override: c.frontPageTextOverride || null,
    agreement_agree_text_override: c.agreementAgreeTextOverride || null,
    benefits_enabled: !!c.benefitsEnabled,
    benefits: c.benefits || [],
    permissions: c.permissions || {},
    work_hours_enabled: c.workHoursEnabled !== false,
    updated_at: new Date().toISOString(),
  };
}

/** Every counsellor, shared. Returns null when there is no backend
 * configured or the read fails — callers fall back to what they already
 * have rather than blanking the roster over a network hiccup. */
export async function loadCounsellors() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("counsellors").select("*");
  if (error) return null;
  return (data || []).map(rowToApp);
}

/** One counsellor by email, read straight from the shared table rather
 * than whatever this browser's local state happens to hold — the whole
 * point is that the answer must be the same on every device. */
export async function findCounsellorByEmail(email) {
  const supabase = getSupabase();
  if (!supabase || !email) return null;
  const { data, error } = await supabase
    .from("counsellors")
    .select("*")
    .ilike("email", email)
    .limit(1);
  if (error || !data || !data.length) return null;
  return rowToApp(data[0]);
}

export async function upsertCounsellorRow(c) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("counsellors").upsert(appToRow(c));
}

/** The moment a counsellor an admin already created signs in for the
 * first time: link this row to their account. Nothing else changes —
 * this exists only so RLS's "a counsellor may edit their own row" can
 * ever start matching, and so a second sign-in doesn't re-run the
 * email-based match every time (an admin renaming that email to give
 * to someone else later shouldn't silently reassign an already-linked
 * counsellor's row). */
export async function linkCounsellorToProfile(counsellorId, profileId) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("counsellors").update({ profile_id: profileId }).eq("id", counsellorId).is("profile_id", null);
}

export async function deleteCounsellorRow(id) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("counsellors").delete().eq("id", id);
}

/** Claims this project's one-ever shot at seeding a given table from
 * `seed_locks` (see the 0007 migration). The insert's primary key is
 * the whole mechanism: however many devices call this at once,
 * Postgres lets exactly one of them succeed, so only one ever goes on
 * to actually seed — everyone else sees their own insert rejected and
 * returns false. A plain "is the table empty" check used to guard this
 * instead, which isn't atomic: two devices could both see "empty"
 * before either had inserted anything, and both would seed, each with
 * its own randomly-generated local ids that don't collide with each
 * other — exactly how this project ended up with two of several
 * counsellors under different ids. */
async function claimSeedLock(key) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("seed_locks").insert({ key });
  return !error;
}

/** First run only: this browser's local roster becomes the shared one. */
export async function seedCounsellorsIfEmpty(localCounsellors) {
  if (!localCounsellors || !localCounsellors.length) return false;
  if (!(await claimSeedLock("counsellors"))) return false;
  const supabase = getSupabase();
  const { error } = await supabase.from("counsellors").insert(localCounsellors.map(appToRow));
  return !error;
}

/** Live updates from every other signed-in device. `onChange` receives
 * the app-shaped row and "insert" | "update" | "delete"; the caller
 * merges it into local state the same way a local edit already does. */
export function subscribeCounsellors(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("counsellors-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "counsellors" }, (payload) => {
      if (payload.eventType === "DELETE") {
        onChange("delete", { id: payload.old.id });
      } else {
        onChange(payload.eventType === "INSERT" ? "insert" : "update", rowToApp(payload.new));
      }
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
