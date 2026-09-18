"use client";

import { useRouter } from "next/navigation";
import { ValidatedField } from "@/components/validated-field";
import { validators } from "@/lib/validation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { PhoneField } from "@/components/phone-field";
import { describeCounsellor } from "@/components/counsellor-select";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { createClientRecord } from "@/lib/actions/clients";
import { GENDERS, LANGUAGES, withCurrent } from "@/lib/options";
import type { CounsellorSummary } from "@/lib/types";

export function NewClientButton({
  counsellors,
}: {
  counsellors: CounsellorSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [counsellorId, setCounsellorId] = useState("");
  const [gender, setGender] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createClientRecord({
        fullName,
        age: age ? Number(age) : null,
        phone,
        email,
        counsellorId: counsellorId || null,
        gender,
        preferredLanguage,
        notes,
      });

      if (!result.ok) return setError(result.error);

      setOpen(false);
      setFullName("");
      setAge("");
      setPhone("");
      setEmail("");
      setGender("");
      setPreferredLanguage("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add client</Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a client"
        width="28rem"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Add client"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Full name" required>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={fieldClass}
              placeholder="Ravi Kumar"
              autoFocus
            />
          </Field>

          <Field label="Age">
            <input
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className={fieldClass}
              placeholder="36"
            />
          </Field>

          <PhoneField
            label="Phone"
            hint="For reminders."
            value={phone}
            onChange={setPhone}
          />

          <ValidatedField
                      label="Email"
                      hint="Reminders go here three days before each session."
                      type="email"
                      inputMode="email"
                      value={email}
                      onChange={setEmail}
                      validate={validators.email()}
                    />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender">
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className={fieldClass}
              >
                <option value="">Select gender</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            {/* Recorded here rather than only at the booking desk: it is
                a property of the client, and the desk matches on it when
                choosing who can see them. */}
            <Field label="Preferred language">
              <select
                value={preferredLanguage}
                onChange={(e) => setPreferredLanguage(e.target.value)}
                className={fieldClass}
              >
                <option value="">No preference</option>
                {withCurrent(LANGUAGES, preferredLanguage).map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Primary counsellor">
            <select
              value={counsellorId}
              onChange={(e) => setCounsellorId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Not assigned</option>
              {counsellors.map((c) => (
                <option key={c.id} value={c.id}>
                  {describeCounsellor(c)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${fieldClass} resize-y`}
              placeholder="Referral source, context, anything the team should know."
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
