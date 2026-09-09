"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { createClientRecord } from "@/lib/actions/clients";
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
        notes,
      });

      if (!result.ok) return setError(result.error);

      setOpen(false);
      setFullName("");
      setAge("");
      setPhone("");
      setEmail("");
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

          <div className="grid grid-cols-2 gap-3">
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
            <Field label="Phone" hint="For reminders.">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={fieldClass}
                placeholder="+91…"
              />
            </Field>
          </div>

          <Field label="Email" hint="Reminders go here three days before each session.">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
              placeholder="ravi@example.com"
            />
          </Field>

          <Field label="Primary counsellor">
            <select
              value={counsellorId}
              onChange={(e) => setCounsellorId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Not assigned</option>
              {counsellors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
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
