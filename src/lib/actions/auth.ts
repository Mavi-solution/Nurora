"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentProfile, describeDbError, fail } from "./shared";

const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password."),
  role: z.enum(["counsellor", "client"]),
  timezone: z.string().trim().min(1).max(64),
});

export type SignUpResult =
  | { ok: true; needsConfirmation: true }
  | { ok: true; needsConfirmation: false; redirectTo: string }
  | { ok: false; error: string };

/**
 * Password sign-up, done entirely on the server.
 *
 * Doing this client-side races the middleware: the moment signUp sets the
 * session cookie, a signed-in user on /signup gets redirected away, and
 * the follow-up profile write never lands. Here the session and the
 * profile are settled in one request, before anything navigates.
 */
export async function signUpWithPassword(input: unknown): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const v = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      // handle_new_user() reads these when it creates the profile row.
      data: { full_name: v.fullName, role: v.role },
    },
  });

  if (error) return fail(friendlySignUpError(error.message));

  // No session means the project requires email confirmation first. The
  // profile is finished by /onboarding once they confirm and sign in.
  if (!data.session) return { ok: true, needsConfirmation: true };

  const finished = await finishProfile(v.fullName, v.role, v.timezone);
  if (!finished.ok) return finished;

  revalidatePath("/", "layout");
  return {
    ok: true,
    needsConfirmation: false,
    redirectTo: finished.data.role === "client" ? "/my" : "/schedule",
  };
}

/**
 * Fills in the profile the trigger created. Never touches `is_admin`:
 * that is set by the trigger for the first account, or by an existing
 * admin — never by whoever is signing up.
 */
async function finishProfile(fullName: string, role: string, timezone: string) {
  const profile = await currentProfile();
  if (!profile) return fail("Sign-up succeeded but the session was lost. Try signing in.");

  const supabase = await createClient();

  // The first account is always a counsellor-admin; never downgrade it.
  const finalRole = profile.is_admin ? "counsellor" : role;

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      role: finalRole,
      timezone,
      onboarded: true,
    })
    .eq("id", profile.id);

  if (error) return fail(describeDbError(error.message, error.code));

  // A new counsellor gets a workable Mon-Fri week so their lane is usable
  // the moment they arrive.
  if (finalRole === "counsellor") {
    const { count } = await supabase
      .from("availability_rules")
      .select("id", { count: "exact", head: true })
      .eq("counsellor_id", profile.id);

    if (!count) {
      await supabase.from("availability_rules").insert(
        [1, 2, 3, 4, 5].map((weekday) => ({
          counsellor_id: profile.id,
          weekday,
          start_time: "09:00",
          end_time: "18:00",
        })),
      );
    }
  }

  return { ok: true as const, data: { role: finalRole } };
}

function friendlySignUpError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with that email already exists. Sign in instead.";
  }
  if (m.includes("password")) {
    return "Password too weak — use at least 8 characters.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message;
}
