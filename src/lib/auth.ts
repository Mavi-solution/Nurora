import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile, UserRole } from "./types";

export type Session = {
  userId: string;
  profile: Profile;
};

/**
 * Current profile, or null when signed out.
 *
 * Deduplicated per request with React's cache(). The layout calls this
 * to render the nav, and then every page calls it again through
 * requireStaff() — each call was an auth.getUser() round trip to the
 * Auth server plus a profiles select, so every page paid for two.
 * They share one render pass, so one lookup now serves both.
 *
 * Not a cross-request cache: the identity here is the caller's own, and
 * caching it beyond the request would hand one user another's session.
 */
export const getSession = cache(async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return { userId: user.id, profile: profile as Profile };
});

/** Session or bounce to sign-in / onboarding. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.onboarded) redirect("/onboarding");
  return session;
}

/** Staff-only pages. Clients get sent to their own portal. */
export async function requireStaff(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.role === "client") redirect("/my");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!isAdmin(session.profile)) redirect("/schedule");
  return session;
}

/**
 * Admin is a flag rather than a role, so one person can run sessions as a
 * counsellor and still administer the practice. The legacy `admin` role
 * keeps working for back-office accounts.
 */
export function isAdmin(profile: Pick<Profile, "role" | "is_admin">): boolean {
  return profile.is_admin || profile.role === "admin";
}

export function isStaff(profile: Pick<Profile, "role" | "is_admin">): boolean {
  return (
    profile.role === "counsellor" ||
    profile.role === "admin" ||
    profile.role === "support" ||
    profile.is_admin
  );
}

/** Reception / booking desk. Runs the diary, never reads clinical notes. */
export function isSupport(profile: Pick<Profile, "role">): boolean {
  return profile.role === "support";
}

/** Clinicians — the only people who may read or write session notes. */
export function isClinical(profile: Pick<Profile, "role" | "is_admin">): boolean {
  return profile.role === "counsellor" || profile.role === "admin" || profile.is_admin;
}

/** May add counsellors, manage the diary, and maintain client records. */
export function canManagePractice(
  profile: Pick<Profile, "role" | "is_admin">,
): boolean {
  return profile.role === "admin" || profile.role === "support" || profile.is_admin;
}

/**
 * Roles that can hold counselling sessions, and therefore appear in the
 * roster, get a lane on the schedule, and are bookable.
 *
 * Deliberately BOTH 'counsellor' and the legacy 'admin' role: admin is
 * meant to be a flag rather than a role, so a practising counsellor who
 * is given the admin role must not silently drop out of the practice.
 * 'support' (reception) and 'client' are excluded — they never counsel.
 *
 * Every query that lists counsellors uses this. Filtering on
 * role = 'counsellor' by hand is what made a promoted counsellor vanish
 * from nine screens at once.
 */
export const CLINICIAN_ROLES: UserRole[] = ["counsellor", "admin"];

/** Absolute origin, used in emails and OAuth redirects. */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
