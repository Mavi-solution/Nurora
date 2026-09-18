"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMonthWeeks, weekOffQuotaForMonth } from "@/lib/business/weekoff";
import { createClient } from "@/lib/supabase/server";
import { dateKeyInTimeZone } from "@/lib/time";
import type { Holiday, Leave, LeaveKind, WeekOff } from "@/lib/types";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const dateSchema = z.string().regex(DATE_KEY, "Use a YYYY-MM-DD date.");

function monthOf(dateKey: string): { year: number; month: number } {
  const [year, month] = dateKey.split("-").map(Number);
  return { year, month };
}

/* ------------------------------------------------------------ week-offs */

/**
 * Book a week-off, refusing once the month's computed allowance is used.
 *
 * The quota is NOT a stored number — it is however many Saturday-bounded
 * rows the month has, which is 4 in some months and 5 in others. See
 * weekoff.ts; getting this wrong is the mistake the handoff calls out.
 */
export async function addWeekOff(input: {
  onDate: string;
  staffId?: string;
  note?: string;
}) {
  const profile = await requireStaffProfile();

  const parsed = z
    .object({
      onDate: dateSchema,
      staffId: z.string().uuid().optional(),
      note: z.string().trim().max(200).optional(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { onDate, note } = parsed.data;
  const staffId = parsed.data.staffId ?? profile.id;

  if (staffId !== profile.id && !profileIsAdmin(profile)) {
    return fail("Only an admin can set someone else's week-off.");
  }

  /*
   * A day that has gone cannot be taken off. The calendar already stops
   * offering it, but the rule belongs here too: the month's allowance is
   * finite, and letting someone spend it retroactively on a day they
   * actually worked makes the tally meaningless.
   *
   * Admins keep the ability, because correcting last month's record on
   * someone's behalf is a real thing a practice manager has to do.
   */
  const todayKey = dateKeyInTimeZone(new Date(), profile.timezone);
  if (onDate < todayKey && !profileIsAdmin(profile)) {
    return fail(
      `${onDate} has already gone. Week-offs can only be booked for today or later — ask an admin to log it if it needs correcting.`,
    );
  }

  const supabase = await createClient();
  const { year, month } = monthOf(onDate);

  // Count what is already taken that month, so the quota is checked
  // against real rows rather than a cached tally.
  const taken = await weekOffsInMonth(supabase, staffId, year, month);
  const quota = weekOffQuotaForMonth(year, month);

  if (taken.some((w) => w.on_date === onDate)) {
    return fail("That day is already marked as a week-off.");
  }

  if (taken.length >= quota) {
    return fail(
      `${monthName(year, month)} allows ${quota} week-offs and ${taken.length} are already taken. Log this as leave instead.`,
    );
  }

  // One per row: two week-offs inside the same Saturday-bounded row would
  // spend the month's allowance faster than it accrues.
  const weeks = getMonthWeeks(year, month);
  const day = Number(onDate.slice(8, 10));
  const rowIndex = weeks.findIndex((w) => day >= w.startDay && day <= w.endDay);

  const clashes = taken.find((w) => {
    const d = Number(w.on_date.slice(8, 10));
    return d >= weeks[rowIndex].startDay && d <= weeks[rowIndex].endDay;
  });

  if (clashes) {
    return fail(
      `That week already has a week-off on ${clashes.on_date}. Only one per week.`,
    );
  }

  const { error } = await supabase.from("week_offs").insert({
    staff_id: staffId,
    on_date: onDate,
    note: note || null,
    created_by: profile.id,
  });

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/leave");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function removeWeekOff(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("week_offs").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/leave");
  revalidatePath("/schedule");
  return { ok: true as const };
}

/* --------------------------------------------------------------- leave */

export async function logLeave(input: {
  onDate: string;
  kind?: LeaveKind;
  reason?: string;
  staffId?: string;
}) {
  const profile = await requireStaffProfile();

  const parsed = z
    .object({
      onDate: dateSchema,
      kind: z.enum(["planned", "sick", "unpaid", "auto"]).optional(),
      reason: z.string().trim().max(300).optional(),
      staffId: z.string().uuid().optional(),
    })
    .safeParse(input);

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { onDate, reason } = parsed.data;
  const staffId = parsed.data.staffId ?? profile.id;

  if (staffId !== profile.id && !profileIsAdmin(profile)) {
    return fail("Only an admin can log leave for someone else.");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("leaves").insert({
    staff_id: staffId,
    on_date: onDate,
    kind: parsed.data.kind ?? "planned",
    reason: reason || null,
    created_by: profile.id,
    // An admin logging leave for someone has effectively approved it.
    approved_by: profileIsAdmin(profile) ? profile.id : null,
    approved_at: profileIsAdmin(profile) ? new Date().toISOString() : null,
  });

  if (error) {
    if (error.code === "23505") {
      return fail("That day is already logged as leave.");
    }
    return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/leave");
  revalidatePath("/schedule");
  return { ok: true as const };
}

/** Admin-only: approve a leave request. */
export async function approveLeave(id: string) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) return fail("Only an admin can approve leave.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("leaves")
    .update({ approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/leave");
  return { ok: true as const };
}

export async function removeLeave(id: string) {
  await requireStaffProfile();
  const supabase = await createClient();

  const { error } = await supabase.from("leaves").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/leave");
  revalidatePath("/schedule");
  return { ok: true as const };
}

/* ------------------------------------------------------------ holidays */

export async function addHoliday(onDate: string, name: string) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) {
    return fail("Only an admin can add an org-wide holiday.");
  }

  const parsed = z
    .object({ onDate: dateSchema, name: z.string().trim().min(1).max(120) })
    .safeParse({ onDate, name });

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert({
    on_date: parsed.data.onDate,
    name: parsed.data.name,
    created_by: profile.id,
  });

  if (error) {
    if (error.code === "23505") return fail("That date is already a holiday.");
    return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/leave");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function removeHoliday(id: string) {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) {
    return fail("Only an admin can remove a holiday.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/leave");
  revalidatePath("/schedule");
  return { ok: true as const };
}

/* -------------------------------------------------------------- reads */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function weekOffsInMonth(
  supabase: ServerClient,
  staffId: string,
  year: number,
  month: number,
): Promise<WeekOff[]> {
  const { start, end } = monthBounds(year, month);
  const { data } = await supabase
    .from("week_offs")
    .select("*")
    .eq("staff_id", staffId)
    .gte("on_date", start)
    .lte("on_date", end)
    .order("on_date");

  return (data ?? []) as WeekOff[];
}

/** Everything one person's month looks like, for the Leave screen. */
export async function monthOffSummary(
  staffId: string,
  year: number,
  month: number,
): Promise<{
  quota: number;
  weekOffs: WeekOff[];
  leaves: Leave[];
  holidays: Holiday[];
}> {
  await requireStaffProfile();
  const supabase = await createClient();
  const { start, end } = monthBounds(year, month);

  const [weekOffs, { data: leaves }, { data: holidays }] = await Promise.all([
    weekOffsInMonth(supabase, staffId, year, month),
    supabase
      .from("leaves")
      .select("*")
      .eq("staff_id", staffId)
      .gte("on_date", start)
      .lte("on_date", end)
      .order("on_date"),
    supabase
      .from("holidays")
      .select("*")
      .gte("on_date", start)
      .lte("on_date", end)
      .order("on_date"),
  ]);

  return {
    quota: weekOffQuotaForMonth(year, month),
    weekOffs,
    leaves: (leaves ?? []) as Leave[],
    holidays: (holidays ?? []) as Holiday[],
  };
}

function monthBounds(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${last}` };
}

function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
