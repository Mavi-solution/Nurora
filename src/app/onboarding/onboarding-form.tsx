"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, Field, fieldClass } from "@/components/ui";
import { completeOnboarding } from "@/lib/actions/profile";
import { COMMON_TIMEZONES } from "@/lib/time";
import type { Profile } from "@/lib/types";

export function OnboardingForm({ profile }: { profile: Profile }) {
  const [role, setRole] = useState<"counsellor" | "client">(
    profile.role === "client" && !profile.is_admin ? "client" : "counsellor",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Pre-select the browser's timezone when we can detect it.
  const detected =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : profile.timezone;

  const timezones = COMMON_TIMEZONES.includes(detected)
    ? COMMON_TIMEZONES
    : [detected, ...COMMON_TIMEZONES];

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await completeOnboarding(formData);
      // A successful onboarding redirects, so anything returned is an error.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <Card className="p-6">
      <form action={onSubmit} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {profile.is_admin && (
          <Alert tone="info">
            You&apos;re the first account here, so you have admin access.
          </Alert>
        )}

        <Field label="Your name" required>
          <input
            name="fullName"
            required
            defaultValue={profile.full_name}
            className={fieldClass}
            placeholder="Anisha"
            autoFocus
          />
        </Field>

        {!profile.is_admin && (
          <div>
            <span className="block text-[13px] font-medium mb-1.5">
              How will you use Nurora?
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "counsellor", label: "I'm a counsellor", hint: "Run sessions" },
                  { value: "client", label: "I'm a client", hint: "Book sessions" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRole(option.value)}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${
                    role === option.value
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-400/10 ring-4 ring-brand-500/10"
                      : "border-hairline hover:bg-card-muted"
                  }`}
                >
                  <span className="block text-[13px] font-medium">
                    {option.label}
                  </span>
                  <span className="block text-[12px] text-muted mt-0.5">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
            <input type="hidden" name="role" value={role} />
          </div>
        )}
        {profile.is_admin && <input type="hidden" name="role" value="counsellor" />}

        <Field label="Timezone" hint="Session times and reminders use this.">
          <select name="timezone" defaultValue={detected} className={fieldClass}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Phone" hint="Used for SMS and WhatsApp reminders. Optional.">
          <input
            name="phone"
            type="tel"
            defaultValue={profile.phone ?? ""}
            className={fieldClass}
            placeholder="+91 98765 43210"
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Setting up…" : "Continue"}
        </Button>
      </form>
    </Card>
  );
}
