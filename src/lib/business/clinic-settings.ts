import { createClient } from "@/lib/supabase/server";
import type { ClinicSettings } from "@/lib/types";
import type { BillingSettings } from "./billing";

/**
 * The clinic's one settings row, and the billing rules derived from it.
 *
 * This replaces the environment variables that stood in while there was
 * no Settings screen. ARCHITECTURE.md rule 2 fixes the SHAPE of the
 * advance formula; these are the amounts, and they are now editable by
 * an admin rather than requiring a redeploy.
 */
export async function loadClinicSettings(): Promise<ClinicSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  return (data as ClinicSettings) ?? null;
}

/** Billing rules for business/billing.ts, read from the settings row. */
export async function billingSettingsFromClinic(): Promise<BillingSettings> {
  const s = await loadClinicSettings();

  return {
    fullPaymentModes: s?.full_payment_modes ?? ["online", "offline_walk_in"],
    advanceTierThresholdCents: s?.advance_tier_threshold_cents ?? 0,
    advanceAtOrBelowCents: s?.advance_at_or_below_cents ?? 0,
    advanceAboveCents: s?.advance_above_cents ?? 0,
    includedMinutes: s?.included_minutes ?? 60,
    graceMinutes: s?.grace_minutes ?? 0,
    extensionBlockMinutes: s?.extension_block_minutes ?? 15,
    extensionBlockCents: s?.extension_block_cents ?? 0,
    graceMode: s?.grace_mode ?? "gate",
  };
}

/**
 * Metres between two coordinates — the haversine formula.
 *
 * Used by the attendance geofence. Rule 5: check-in and check-out use
 * DIFFERENT radii on purpose, so this only measures; the comparison
 * belongs to the caller.
 */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
