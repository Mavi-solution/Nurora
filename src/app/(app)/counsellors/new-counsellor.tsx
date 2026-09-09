"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { createCounsellor } from "@/lib/actions/counsellors";
import { COMMON_TIMEZONES } from "@/lib/time";
import type { Specialism } from "@/lib/types";

const LANGUAGE_OPTIONS = [
  "English", "Tamil", "Hindi", "Telugu", "Malayalam", "Kannada",
  "Marathi", "Bengali", "Gujarati", "Punjabi", "Urdu",
];

export function NewCounsellorButton({
  specialisms,
  defaultTimezone,
}: {
  specialisms: Specialism[];
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [headline, setHeadline] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [sessionFee, setSessionFee] = useState("2000");
  const [duration, setDuration] = useState(60);
  const [currency, setCurrency] = useState("INR");
  const [languages, setLanguages] = useState<string[]>(["English"]);
  const [specialismIds, setSpecialismIds] = useState<string[]>([]);
  const [password, setPassword] = useState(() => suggestPassword());

  const timezones = COMMON_TIMEZONES.includes(defaultTimezone)
    ? COMMON_TIMEZONES
    : [defaultTimezone, ...COMMON_TIMEZONES];

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setHeadline("");
    setSessionFee("2000");
    setDuration(60);
    setLanguages(["English"]);
    setSpecialismIds([]);
    setPassword(suggestPassword());
    setError(null);
  }

  function submit() {
    setError(null);

    if (specialismIds.length === 0) {
      return setError("Pick at least one specialism — the desk books on it.");
    }

    startTransition(async () => {
      const result = await createCounsellor({
        fullName,
        email,
        phone,
        headline,
        timezone,
        languages,
        specialismIds,
        sessionFee: Number(sessionFee || 0),
        durationMinutes: duration,
        currency,
        temporaryPassword: password,
      });

      if (!result.ok) return setError(result.error);

      setCreated({ email: email.trim(), password });
      router.refresh();
    });
  }

  if (created) {
    return (
      <>
        <Button onClick={() => setOpen(true)}>Add counsellor</Button>
        <Dialog
          open
          onClose={() => {
            setCreated(null);
            setOpen(false);
            reset();
          }}
          title="Counsellor added"
          footer={
            <Button
              className="flex-1"
              onClick={() => {
                setCreated(null);
                setOpen(false);
                reset();
              }}
            >
              Done
            </Button>
          }
        >
          <Alert tone="success">
            Their account is ready. Hand these over — they can change the
            password under Settings once they sign in.
          </Alert>
          <div className="mt-4 rounded-xl border border-hairline bg-card-muted p-4 space-y-2 text-[14px]">
            <p>
              <span className="text-muted">Email</span>{" "}
              <strong className="break-all">{created.email}</strong>
            </p>
            <p>
              <span className="text-muted">Temporary password</span>{" "}
              <strong className="font-mono">{created.password}</strong>
            </p>
          </div>
          <p className="text-[13px] text-muted mt-4 leading-relaxed">
            Next: set their working hours so the booking desk can offer slots.
          </p>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add counsellor</Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a counsellor"
        width="34rem"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={submit} disabled={pending}>
              {pending ? "Creating…" : "Create counsellor"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Full name" required>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={fieldClass}
                placeholder="Anisha Raman"
                autoFocus
              />
            </Field>
            <Field label="Email" required hint="They sign in with this.">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
                placeholder="anisha@practice.com"
              />
            </Field>
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={fieldClass}
                placeholder="+91…"
              />
            </Field>
            <Field label="Timezone">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={fieldClass}
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Headline" hint="Shown next to their name.">
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className={fieldClass}
              placeholder="Clinical psychologist · CBT"
            />
          </Field>

          <div>
            <span className="block text-[13px] font-medium mb-1.5 is-required">
              Specialises in
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
              {specialisms.map((s) => {
                const on = specialismIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(specialismIds, s.id, setSpecialismIds)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                      on
                        ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-400/15 dark:text-brand-100"
                        : "border-hairline text-muted hover:bg-card-muted"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="block text-[13px] font-medium mb-1.5">
              Can hold sessions in
            </span>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((l) => {
                const on = languages.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggle(languages, l, setLanguages)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                      on
                        ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-400/15 dark:text-brand-100"
                        : "border-hairline text-muted hover:bg-card-muted"
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Currency">
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                maxLength={3}
                className={`${fieldClass} uppercase`}
              />
            </Field>
            <Field label="Session fee">
              <input
                type="number"
                min={0}
                step="0.01"
                value={sessionFee}
                onChange={(e) => setSessionFee(e.target.value)}
                className={fieldClass}
              />
            </Field>
            <Field label="Length">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className={fieldClass}
              >
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Temporary password"
            required
            hint="Hand this to them; they change it after signing in."
          >
            <div className="flex gap-2">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fieldClass} font-mono`}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPassword(suggestPassword())}
              >
                New
              </Button>
            </div>
          </Field>

          <p className="text-[12px] text-muted leading-relaxed">
            After creating them, set their working hours so the booking desk
            can offer their slots.
          </p>
        </div>
      </Dialog>
    </>
  );
}

/** Readable but random — it gets read down a phone line. */
function suggestPassword(): string {
  const words = ["calm", "grove", "river", "amber", "quiet", "cedar", "harbour", "willow"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}
