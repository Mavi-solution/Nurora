"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClinicSettings } from "@/lib/data/reference";
import { createClient } from "@/lib/supabase/server";
import { WEEKDAYS } from "@/lib/time";
import { describeDbError, fail, profileIsAdmin, requireStaffProfile } from "./shared";

const ruleSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

/** Replace the whole weekly pattern in one shot — simplest thing that
 *  keeps the editor and the database in sync. */
export async function saveWeeklyAvailability(
  counsellorId: string,
  rules: unknown,
) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile) && counsellorId !== profile.id) {
    return fail("You can only edit your own availability.");
  }

  const parsed = z.array(ruleSchema).safeParse(rules);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  for (const r of parsed.data) {
    if (r.endTime <= r.startTime) {
      return fail("Each window must end after it starts.");
    }
  }

  /*
   * Overlapping windows on one day were accepted and then quietly
   * merged by generateSlots, so the editor could hold "09:00-18:00"
   * three times over and look, to the person filling it in, as though
   * nothing had happened when they clicked Add. Rejecting the overlap
   * here means the editor never has to guess what a duplicate meant.
   *
   * Times are "HH:MM", which compares correctly as a string, so no
   * parsing is needed to sort or to test containment.
   */
  const byWeekday = new Map<number, { startTime: string; endTime: string }[]>();
  for (const r of parsed.data) {
    const list = byWeekday.get(r.weekday) ?? [];
    list.push(r);
    byWeekday.set(r.weekday, list);
  }

  for (const [weekday, list] of byWeekday) {
    const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        return fail(
          `${WEEKDAYS[weekday]} has two windows that overlap ` +
            `(${sorted[i - 1].startTime}–${sorted[i - 1].endTime} and ` +
            `${sorted[i].startTime}–${sorted[i].endTime}). ` +
            "Merge them into one, or move the second one later.",
        );
      }
    }
  }

  // Hours on a day the clinic does not open would never produce a
  // bookable slot, so they are refused rather than silently ignored.
  const settings = await getClinicSettings();
  const openWeekdays = settings?.open_weekdays;
  if (Array.isArray(openWeekdays) && openWeekdays.length > 0) {
    const closed = [...byWeekday.keys()].find((w) => !openWeekdays.includes(w));
    if (closed !== undefined) {
      return fail(
        `The clinic is closed on ${WEEKDAYS[closed]}s, so hours cannot be set ` +
          "on it. An admin can change the opening days under Clinic settings.",
      );
    }
  }

  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("counsellor_id", counsellorId);

  if (deleteError) return fail(describeDbError(deleteError.message, deleteError.code));

  if (parsed.data.length > 0) {
    const { error } = await supabase.from("availability_rules").insert(
      parsed.data.map((r) => ({
        counsellor_id: counsellorId,
        weekday: r.weekday,
        start_time: r.startTime,
        end_time: r.endTime,
      })),
    );
    if (error) return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/availability");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function addAvailabilityException(input: {
  counsellorId: string;
  onDate: string;
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string;
}) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile) && input.counsellorId !== profile.id) {
    return fail("You can only edit your own availability.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("availability_exceptions").insert({
    counsellor_id: input.counsellorId,
    on_date: input.onDate,
    is_available: input.isAvailable,
    start_time: input.startTime || null,
    end_time: input.endTime || null,
    reason: input.reason?.trim() || null,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/availability");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function removeAvailabilityException(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/availability");
  revalidatePath("/schedule");
  return { ok: true as const };
}
