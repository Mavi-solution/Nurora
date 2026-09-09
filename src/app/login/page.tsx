import Link from "next/link";
import { Suspense } from "react";
import LoginForm from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="min-h-dvh grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between aurora bg-surface-subtle p-12 border-r border-hairline">
        <Link href="/" className="font-display text-xl font-semibold tracking-tight">
          Nurora
        </Link>

        <div className="max-w-md">
          <h1 className="font-display text-4xl leading-[1.15] font-semibold">
            Care that runs on time.
          </h1>
          <p className="mt-5 text-[15px] text-muted leading-relaxed">
            Scheduling, session time tracking and payments in one place — with
            reminders that reach both the counsellor and the client three days
            before every appointment.
          </p>

          <ul className="mt-8 space-y-3 text-sm">
            {[
              "Availability rules that respect your timezone",
              "Start a timer, log the real session length",
              "Invoice per session, settled and tracked",
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
          Your session notes stay private to you and your client.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm animate-in-up">
          <Link
            href="/"
            className="lg:hidden font-display text-xl font-semibold tracking-tight block mb-8"
          >
            Nurora
          </Link>

          <h2 className="font-display text-2xl font-semibold">Welcome back</h2>
          <p className="text-[14px] text-muted mt-1.5">
            Sign in or create an account — it&apos;s the same step.
          </p>

          <div className="mt-8">
            <Suspense
              fallback={<div className="h-72 rounded-2xl bg-card-muted animate-pulse" />}
            >
              <LoginForm />
            </Suspense>
          </div>

          <p className="mt-8 text-[12px] text-faint leading-relaxed text-center">
            By continuing you agree to Nurora&apos;s terms and privacy policy.
          </p>
        </div>
      </div>
    </main>
  );
}
