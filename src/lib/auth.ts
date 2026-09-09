import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

export type Session = {
  userId: string;
  profile: Profile;
};

/** Current profile, or null when signed out. */
export async function getSession(): Promise<Session | null> {
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
}

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
  return profile.role === "counsellor" || profile.role === "admin" || profile.is_admin;
}

/** Absolute origin, used in emails and OAuth redirects. */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
