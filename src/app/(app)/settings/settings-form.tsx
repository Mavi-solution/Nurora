"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import { updateSettings } from "@/lib/actions/profile";
import { COMMON_TIMEZONES } from "@/lib/time";
import type { Profile } from "@/lib/types";

export function SettingsForm({ profile }: { profile: Profile }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const timezones = COMMON_TIMEZONES.includes(profile.timezone)
    ? COMMON_TIMEZONES
    : [profile.timezone, ...COMMON_TIMEZONES];

  const staff = profile.role !== "client";

  function onSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateSettings(formData);
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">Settings saved.</Alert>}

      <Card>
        <CardHeader title="Profile" />
        <div className="px-5 py-4 space-y-4">
          <Field label="Full name" required>
            <input name="fullName" defaultValue={profile.full_name} className={fieldClass} required />
          </Field>

          {staff && (
            <>
              <Field label="Headline" hint="A short line shown next to your name.">
                <input
                  name="headline"
                  defaultValue={profile.headline ?? ""}
                  className={fieldClass}
                  placeholder="Clinical psychologist · CBT"
                />
              </Field>
              <Field label="About">
                <textarea
                  name="bio"
                  defaultValue={profile.bio ?? ""}
                  rows={3}
                  className={`${fieldClass} resize-y`}
                />
              </Field>
            </>
          )}

          <Field label="Timezone" hint="All session times and reminders use this.">
            <select name="timezone" defaultValue={profile.timezone} className={fieldClass}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Phone" hint="Used for SMS and WhatsApp reminders.">
            <input
              name="phone"
              type="tel"
              defaultValue={profile.phone ?? ""}
              className={fieldClass}
              placeholder="+91 98765 43210"
            />
          </Field>
        </div>
      </Card>

      {staff && (
        <Card>
          <CardHeader title="Rates" description="Defaults applied when booking a session." />
          <div className="px-5 py-4 grid sm:grid-cols-3 gap-4">
            <Field label="Currency">
              <input
                name="currency"
                defaultValue={profile.currency}
                maxLength={3}
                className={`${fieldClass} uppercase`}
              />
            </Field>
            <Field label="Session fee" hint="Shown on the start dialog.">
              <input
                name="sessionFee"
                type="number"
                min={0}
                step="0.01"
                defaultValue={profile.default_session_fee_cents / 100}
                className={fieldClass}
              />
            </Field>
            <Field label="Hourly rate" hint="Used when rebilling by tracked time.">
              <input
                name="hourlyRate"
                type="number"
                min={0}
                step="0.01"
                defaultValue={profile.hourly_rate_cents / 100}
                className={fieldClass}
              />
            </Field>
            <Field label="Default duration">
              <select
                name="durationMinutes"
                defaultValue={profile.default_duration_minutes}
                className={fieldClass}
              >
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Reminders"
          description="Sent three days before every session, to you and to the other party."
        />
        <div className="px-5 py-4 space-y-3">
          <Toggle
            name="notifyEmail"
            label="Email"
            hint="Requires an email address on your account."
            defaultChecked={profile.notify_email}
          />
          <Toggle
            name="notifySms"
            label="SMS"
            hint="Requires a phone number and Twilio configured."
            defaultChecked={profile.notify_sms}
          />
          <Toggle
            name="notifyWhatsapp"
            label="WhatsApp"
            hint="Requires a phone number and a Twilio WhatsApp sender."
            defaultChecked={profile.notify_whatsapp}
          />
        </div>
      </Card>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded accent-[var(--color-brand-600)] cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block text-[12px] text-muted mt-0.5">{hint}</span>
      </span>
    </label>
  );
}
