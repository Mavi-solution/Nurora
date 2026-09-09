import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Postgres errors are terse; translate the ones users can actually hit. */
export function describeDbError(
  message: string,
  code?: string,
): string {
  if (code === "23P01" || message.includes("appointments_no_overlap")) {
    return "That slot overlaps another booking for this counsellor.";
  }
  if (code === "23505" && message.includes("time_entries_one_open_per_counsellor")) {
    return "This counsellor already has a session running. End it first.";
  }
  if (code === "23505" && message.includes("time_entries_one_open_per_appt")) {
    return "A timer is already running for this session.";
  }
  if (code === "23505" && message.includes("staff_shifts_one_open")) {
    return "You are already checked in.";
  }
  if (code === "42501" || message.includes("row-level security")) {
    return "You do not have permission to do that.";
  }
  return message;
}

/** The signed-in profile, or null. Server-action side of `getSession`. */
export async function currentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return (data as Profile) ?? null;
}

export async function requireStaffProfile(): Promise<Profile> {
  const profile = await currentProfile();
  if (!profile) throw new Error("Not signed in");
  if (profile.role === "client" && !profile.is_admin) {
    throw new Error("Staff access required");
  }
  return profile;
}

/** Admin is a flag, not only a role — see isAdmin() in lib/auth. */
export function profileIsAdmin(profile: Profile): boolean {
  return profile.is_admin || profile.role === "admin";
}

/** Admins and the support desk: may add counsellors and run the diary. */
export function profileCanManagePractice(profile: Profile): boolean {
  return profileIsAdmin(profile) || profile.role === "support";
}

/** Clinicians only — session notes and session timers. */
export function profileIsClinical(profile: Profile): boolean {
  return profileIsAdmin(profile) || profile.role === "counsellor";
}

export async function requirePracticeManager(): Promise<Profile> {
  const profile = await currentProfile();
  if (!profile) throw new Error("Not signed in");
  if (!profileCanManagePractice(profile)) {
    throw new Error("Admin or support access required");
  }
  return profile;
}
