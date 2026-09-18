"use client";

import { useRouter } from "next/navigation";
import { ValidatedField } from "@/components/validated-field";
import { validators } from "@/lib/validation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { PhoneField } from "@/components/phone-field";
import { TimezoneSelect } from "@/components/timezone-select";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { createCounsellor } from "@/lib/actions/counsellors";
import { LANGUAGES, PRACTICE_CURRENCY, PRACTICE_CURRENCY_LABEL } from "@/lib/options";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { Specialism } from "@/lib/types";

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
  const [timezone, setTimezone] = useState(defaultTimezone || DEFAULT_TIMEZONE);
  const [sessionFee, setSessionFee] = useState("2000");
  const [duration, setDuration] = useState(60);
  const [languages, setLanguages] = useState<string[]>(["English"]);
  const [preferredLanguage, setPreferredLanguage] = useState("English");
  const [specialismIds, setSpecialismIds] = useState<string[]>([]);
  const [password, setPassword] = useState(() => suggestPassword());

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  /*
   * Turning a language off must not leave it as the preferred one.
   * Handled here rather than only on the server so the dropdown below
   * never offers a language the chips no longer show.
   */
  function toggleLanguage(value: string) {
    const next = languages.includes(value)
      ? languages.filter((l) => l !== value)
      : [...languages, value];
    setLanguages(next);
    if (!next.includes(preferredLanguage)) setPreferredLanguage(next[0] ?? "");
  }

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setHeadline("");
    setSessionFee("2000");
    setDuration(60);
    setTimezone(defaultTimezone || DEFAULT_TIMEZONE);
    setLanguages(["English"]);
    setPreferredLanguage("English");
    setSpecialismIds([]);
    setPassword(suggestPassword());
    setError(null);
  }

  function submit() {
    setError(null);

    if (specialismIds.length === 0) {
      return setError("Pick at least one specialism — the desk books on it.");
    }
    // The booking desk filters on language, so a counsellor with none
    // recorded is invisible to every language-filtered search.
    if (languages.length === 0) {
      return setError(
        "Pick at least one language — callers are matched to counsellors on it.",
      );
    }

    startTransition(async () => {
      const result = await createCounsellor({
        fullName,
        email,
        phone,
        headline,
        timezone,
        languages,
        preferredLanguage,
        specialismIds,
        sessionFee: Number(sessionFee || 0),
        durationMinutes: duration,
        currency: PRACTICE_CURRENCY,
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
            <ValidatedField
              label="Email"
              required
              type="email"
              inputMode="email"
              hint="They sign in with this."
              value={email}
              onChange={setEmail}
              validate={validators.email({ required: true })}
            />
            <PhoneField label="Phone" value={phone} onChange={setPhone} />
            <TimezoneSelect value={timezone} onChange={setTimezone} />
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

          {/* Its own labelled section. The chips were previously headed
              only "Can hold sessions in", which QA read straight past —
              hence "add language section while creating councillor
              account" for a control that was already on the form. */}
          <div>
            <span className="block text-[13px] font-medium mb-1.5 is-required">
              Languages
            </span>
            <p className="text-[12px] text-faint mb-2">
              Sessions they can hold. The booking desk filters on this, so
              leaving it empty hides them from a language-matched search.
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1">
              {LANGUAGES.map((l) => {
                const on = languages.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggleLanguage(l)}
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

            {languages.length > 1 && (
              <div className="mt-3">
                <Field
                  label="Preferred language"
                  hint="Which of those they would rather work in. Shown first to the desk."
                >
                  <select
                    value={preferredLanguage}
                    onChange={(e) => setPreferredLanguage(e.target.value)}
                    aria-label="Preferred language"
                    className={fieldClass}
                  >
                    {languages.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Currency" hint="The practice bills in rupees.">
              <p
                className={`${fieldClass} bg-card-muted text-muted flex items-center`}
                aria-readonly="true"
              >
                {PRACTICE_CURRENCY_LABEL}
              </p>
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
