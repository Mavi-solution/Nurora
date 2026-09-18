import { unstable_cache } from "next/cache";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLINICIAN_ROLES } from "@/lib/auth";
import type {
  AppointmentTag,
  ClinicSettings,
  CounsellorSummary,
  Service,
  Specialism,
} from "@/lib/types";

/**
 * Reference data — the slow-changing lists every screen needs.
 *
 * These were re-queried on every render: the price list and tag labels
 * on each schedule date change, specialisms on three separate pages,
 * the counsellor roster on five. None of it changes between one click
 * and the next, so it is cached across requests and invalidated by the
 * few actions that actually edit it.
 *
 * WHAT MAY BE CACHED HERE IS A SECURITY QUESTION, not a performance one.
 * The cache is shared by every user, so only data whose row-level
 * security is identical for everyone can go in it. Verified against the
 * policies:
 *
 *   services, appointment_tags, specialisms,
 *   profiles, clinic_settings          SELECT USING (true)   -> safe
 *
 *   clients    USING (is_staff() OR user_id = auth.uid())    -> NOT safe
 *
 * `clients` is deliberately absent: a linked client user sees only their
 * own record, so a shared cache entry would hand them the whole list.
 * It stays a per-request query under the caller's own session.
 *
 * The cache callback runs outside the request, where cookies are not
 * available, so it reads through the service-role client. That bypasses
 * RLS — which is only equivalent to the user's own view BECAUSE the
 * policies above are unconditional. Anything conditional must not move
 * here without re-checking that.
 */

export const REF_TAG = {
  services: "ref:services",
  appointmentTags: "ref:appointment-tags",
  specialisms: "ref:specialisms",
  counsellors: "ref:counsellors",
  clinicSettings: "ref:clinic-settings",
} as const;

/**
 * A five-minute backstop; the tags below are what normally invalidate.
 * It exists for changes made OUT OF BAND — a migration, a restore, a
 * hand-edit in the SQL editor — which no revalidateTag call can know
 * about. Without it the cache can serve ids that no longer exist, and
 * the next booking fails with "that service is no longer on the price
 * list" while the dropdown still offers it.
 */
const MAX_AGE = 300;

/**
 * Caching is a production concern, and in development it actively gets
 * in the way: `supabase db reset` replaces every row while the cache
 * keeps serving the previous database's ids. Local work and the test
 * suites therefore always read live.
 */
const CACHE_ENABLED = process.env.NODE_ENV === "production";

const SERVICE_COLUMNS = "*";
const COUNSELLOR_COLUMNS =
  "id, full_name, avatar_url, headline, timezone, role, default_session_fee_cents, default_duration_minutes, currency, languages, preferred_language";

/* ------------------------------------------------------------ services */

const cachedServices = unstable_cache(
  async (): Promise<Service[]> => {
    const admin = createAdminClientOrNull();
    if (!admin) return [];
    const { data } = await admin
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("is_active", true)
      .order("sort_order")
      .order("name");
    return (data ?? []) as Service[];
  },
  ["ref-services"],
  { tags: [REF_TAG.services], revalidate: MAX_AGE },
);

export async function getServices(): Promise<Service[]> {
  if (!CACHE_ENABLED || !createAdminClientOrNull()) return uncachedServices();
  return cachedServices();
}

async function uncachedServices(): Promise<Service[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select(SERVICE_COLUMNS)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  return (data ?? []) as Service[];
}

/* ---------------------------------------------------- appointment tags */

const cachedTags = unstable_cache(
  async (): Promise<AppointmentTag[]> => {
    const admin = createAdminClientOrNull();
    if (!admin) return [];
    const { data } = await admin
      .from("appointment_tags")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("label");
    return (data ?? []) as AppointmentTag[];
  },
  ["ref-appointment-tags"],
  { tags: [REF_TAG.appointmentTags], revalidate: MAX_AGE },
);

export async function getAppointmentTags(): Promise<AppointmentTag[]> {
  if (!CACHE_ENABLED || !createAdminClientOrNull()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("appointment_tags")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("label");
    return (data ?? []) as AppointmentTag[];
  }
  return cachedTags();
}

/* -------------------------------------------------------- specialisms */

const cachedSpecialisms = unstable_cache(
  async (): Promise<Specialism[]> => {
    const admin = createAdminClientOrNull();
    if (!admin) return [];
    const { data } = await admin
      .from("specialisms")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    return (data ?? []) as Specialism[];
  },
  ["ref-specialisms"],
  { tags: [REF_TAG.specialisms], revalidate: MAX_AGE },
);

export async function getSpecialisms(): Promise<Specialism[]> {
  if (!CACHE_ENABLED || !createAdminClientOrNull()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("specialisms")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    return (data ?? []) as Specialism[];
  }
  return cachedSpecialisms();
}

/* -------------------------------------------------------- counsellors */

/*
 * The roster carries each counsellor's specialisms as plain names.
 *
 * PostgREST returns the join as a nested array of rows, so it is
 * flattened to strings here — once, where the list is built — rather
 * than at each of the five call sites. The shape a caller receives is
 * the same whether it came from the cache or a live read, which is the
 * whole point of routing both through one mapper.
 */
const COUNSELLOR_SELECT = `${COUNSELLOR_COLUMNS}, counsellor_specialisms (specialisms (name))`;

type CounsellorJoinRow = Omit<CounsellorSummary, "specialisms"> & {
  counsellor_specialisms?: { specialisms: { name: string } | null }[] | null;
};

function withSpecialisms(rows: unknown): CounsellorSummary[] {
  return ((rows ?? []) as CounsellorJoinRow[]).map((row) => {
    const { counsellor_specialisms, ...rest } = row;
    return {
      ...rest,
      specialisms: (counsellor_specialisms ?? [])
        .map((j) => j.specialisms?.name)
        .filter((n): n is string => Boolean(n))
        .sort((a, b) => a.localeCompare(b)),
    };
  });
}

const cachedCounsellors = unstable_cache(
  async (): Promise<CounsellorSummary[]> => {
    const admin = createAdminClientOrNull();
    if (!admin) return [];
    const { data } = await admin
      .from("profiles")
      .select(COUNSELLOR_SELECT)
      .in("role", CLINICIAN_ROLES)
      .eq("is_active", true)
      .order("full_name");
    return withSpecialisms(data);
  },
  ["ref-counsellors"],
  { tags: [REF_TAG.counsellors], revalidate: MAX_AGE },
);

export async function getCounsellors(): Promise<CounsellorSummary[]> {
  if (!CACHE_ENABLED || !createAdminClientOrNull()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select(COUNSELLOR_SELECT)
      .in("role", CLINICIAN_ROLES)
      .eq("is_active", true)
      .order("full_name");
    return withSpecialisms(data);
  }
  return cachedCounsellors();
}

/* ----------------------------------------------------- clinic settings */

const cachedClinicSettings = unstable_cache(
  async (): Promise<ClinicSettings | null> => {
    const admin = createAdminClientOrNull();
    if (!admin) return null;
    const { data } = await admin
      .from("clinic_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    return (data as ClinicSettings) ?? null;
  },
  ["ref-clinic-settings"],
  { tags: [REF_TAG.clinicSettings], revalidate: MAX_AGE },
);

export async function getClinicSettings(): Promise<ClinicSettings | null> {
  if (!CACHE_ENABLED || !createAdminClientOrNull()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("clinic_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    return (data as ClinicSettings) ?? null;
  }
  return cachedClinicSettings();
}
