import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.onboarded) redirect("/dashboard");

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-md animate-in-up">
        <div className="mb-8">
          <span className="font-display text-xl font-semibold tracking-tight">
            Nurora
          </span>
          <h1 className="font-display text-2xl font-semibold mt-6">
            Let&apos;s set you up
          </h1>
          <p className="text-[14px] text-muted mt-1.5">
            A couple of details and your schedule is ready.
          </p>
        </div>

        <OnboardingForm profile={session.profile} />
      </div>
    </main>
  );
}
