"use server";

import { revalidatePath } from "next/cache";
import {
  loadClinicSettings,
  metresBetween,
} from "@/lib/business/clinic-settings";
import { createClient } from "@/lib/supabase/server";
import { describeDbError, fail, requireStaffProfile } from "./shared";

/** Where the browser says the person is, when it will say. */
export type Coords = { lat: number; lon: number } | null;

/**
 * "Tap to check in" — staff attendance, deliberately separate from the
 * per-session billed timers.
 *
 * Geofence, ARCHITECTURE.md rule 5: arriving is checked against a TIGHT
 * radius and leaving against a LENIENT one, because someone may step
 * out to a client's home before heading home. The two are not to be
 * unified — that asymmetry is the point.
 *
 * Only enforced when an admin has set the clinic's coordinates and
 * switched it on; otherwise location is ignored entirely so a clinic
 * that has not configured it is never locked out.
 */
export async function toggleCheckIn(coords?: Coords) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: open } = await supabase
    .from("staff_shifts")
    .select("id")
    .eq("staff_id", profile.id)
    .is("checked_out_at", null)
    .maybeSingle();

  const settings = await loadClinicSettings();
  const geofenced =
    settings?.geofence_enforced &&
    settings.clinic_latitude != null &&
    settings.clinic_longitude != null;

  if (geofenced) {
    if (!coords) {
      return fail(
        "Location is required to check in or out. Allow location access and try again.",
      );
    }

    const distance = metresBetween(coords, {
      lat: settings!.clinic_latitude!,
      lon: settings!.clinic_longitude!,
    });

    // Arriving: strict. Leaving: lenient.
    const limit = open
      ? settings!.check_out_radius_m
      : settings!.check_in_radius_m;

    if (distance > limit) {
      return fail(
        open
          ? `You are ${distance}m from the clinic; check-out allows ${limit}m.`
          : `You are ${distance}m from the clinic; check-in allows ${limit}m. Check in once you arrive.`,
      );
    }
  }

  if (open) {
    const { error } = await supabase
      .from("staff_shifts")
      .update({ checked_out_at: new Date().toISOString() })
      .eq("id", open.id);

    if (error) return fail(describeDbError(error.message, error.code));

    revalidatePath("/schedule");
    revalidatePath("/timesheet");
    return { ok: true as const, data: { checkedIn: false } };
  }

  const { error } = await supabase.from("staff_shifts").insert({
    staff_id: profile.id,
    checked_in_at: new Date().toISOString(),
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/schedule");
  revalidatePath("/timesheet");
  return { ok: true as const, data: { checkedIn: true } };
}
