import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect(session.profile.onboarded ? "/dashboard" : "/onboarding");

  // Whoever signs up first runs the practice, so say so on the form.
  // This runs unauthenticated, and RLS hides `profiles` from anonymous
  // clients, so it goes through a SECURITY DEFINER function instead of a
  // direct count — otherwise everyone is told they are the first account.
  const supabase = await createClient();
  const { data: hasAdmin } = await supabase.rpc("practice_has_admin");
  const isFirstAccount = hasAdmin !== true;

  return (
    <main className="min-h-dvh grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between aurora bg-surface-subtle p-12 border-r border-hairline">
        <Link href="/" className="font-display text-xl font-semibold tracking-tight">
          Nurora
        </Link>

        <div className="max-w-md">
          <h1 className="font-display text-4xl leading-[1.15] font-semibold">
            Care that runs on time.
          </h1>
          <p className="mt-5 text-[15px] text-muted leading-relaxed">
            Set up your practice in under a minute. Your schedule, session
            timers, invoices and reminders are ready the moment you sign in.
          </p>

          <ul className="mt-8 space-y-3 text-sm">
            {[
              "A lane on the board for every counsellor",
              "Start a timer, bill the real session length",
              "Reminders three days out, to both sides",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-1 size-4 rounded-full bg-brand-600 text-white grid place-items-center text-[10px] shrink-0">
                  ✓
                </span>
                <span className="text-muted">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12px] text-faint">
          Session notes stay private to you and your client.
        </p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm animate-in-up">
          <Link
            href="/"
            className="lg:hidden font-display text-xl font-semibold tracking-tight block mb-8"
          >
            Nurora
          </Link>

          <h2 className="font-display text-2xl font-semibold">
            Create your account
          </h2>
          <p className="text-[14px] text-muted mt-1.5">
            {isFirstAccount
              ? "You're the first here, so this account runs the practice."
              : "A few details and you're in."}
          </p>

          <div className="mt-8">
            <Suspense
              fallback={<div className="h-96 rounded-2xl bg-card-muted animate-pulse" />}
            >
              <SignupForm isFirstAccount={isFirstAccount} />
            </Suspense>
          </div>

          <p className="mt-7 text-[13px] text-muted text-center">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-brand-700 dark:text-brand-300 font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
