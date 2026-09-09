import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { getSession } from "@/lib/auth";

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect(session.profile.onboarded ? "/dashboard" : "/onboarding");

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="h-16 flex items-center px-6 lg:px-10">
        <span className="font-display text-xl font-semibold tracking-tight">
          Nurora
        </span>
        <div className="flex-1" />
        <Link
          href="/login"
          className="text-sm font-medium text-muted hover:text-body transition-colors"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex items-center">
        <div className="mx-auto max-w-5xl px-6 lg:px-10 py-16 w-full">
          <div className="max-w-2xl">
            <p className="text-[26px] sm:text-[34px] leading-[1.2] text-faint font-display">
              Always believe something wonderful
            </p>
            <h1 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold font-display mt-1">
              is about to happen.
            </h1>

            <p className="mt-7 text-[16px] text-muted leading-relaxed max-w-xl">
              Nurora is the console your counselling practice runs on — the
              day&apos;s schedule at a glance, a timer on every session, an
              invoice behind every timer, and reminders that reach both sides
              three days ahead.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/login" size="lg">
                Open the schedule
              </ButtonLink>
              <ButtonLink href="/login" size="lg" variant="secondary">
                Sign in with Google
              </ButtonLink>
            </div>
          </div>

          <div className="mt-16 grid sm:grid-cols-3 gap-4">
            {[
              {
                title: "One board, every counsellor",
                body: "Each counsellor gets a lane with their bookings and open slots. Book into a gap in two taps.",
              },
              {
                title: "Time that becomes money",
                body: "Start and end a session timer. The tracked minutes land on the invoice automatically.",
              },
              {
                title: "Reminders, three days out",
                body: "Email, SMS and WhatsApp go to the counsellor and the client, exactly once per session.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-hairline bg-card p-5 shadow-card"
              >
                <h2 className="font-semibold text-[15px]">{f.title}</h2>
                <p className="text-[13px] text-muted mt-2 leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="px-6 lg:px-10 py-6 text-[12px] text-faint border-t border-hairline">
        Nurora · counselling scheduling, time tracking and payments
      </footer>
    </div>
  );
}
