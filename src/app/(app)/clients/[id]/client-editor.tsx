"use client";

import { useRouter } from "next/navigation";
import { ValidatedField } from "@/components/validated-field";
import { validators } from "@/lib/validation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { PhoneField } from "@/components/phone-field";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import {
  archiveClient,
  restoreClient,
  updateClientRecord,
} from "@/lib/actions/clients";
import { GENDERS, LANGUAGES, withCurrent } from "@/lib/options";
import type { Client } from "@/lib/types";

export function ClientEditor({
  client,
  counsellors,
}: {
  client: Client;
  counsellors: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(client.full_name);
  const [age, setAge] = useState(client.age?.toString() ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [counsellorId, setCounsellorId] = useState(client.counsellor_id ?? "");
  const [gender, setGender] = useState(client.gender ?? "");
  const [preferredLanguage, setPreferredLanguage] = useState(
    client.preferred_language ?? "",
  );
  const [notes, setNotes] = useState(client.notes ?? "");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateClientRecord(client.id, {
        fullName,
        age: age ? Number(age) : null,
        phone,
        email,
        counsellorId: counsellorId || null,
        gender,
        preferredLanguage,
        notes,
      });

      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  /*
   * Archiving used to go through window.confirm(). That is why it was
   * reported as not working: the browser suppresses confirm() in a
   * number of contexts, and when it is suppressed it returns false, so
   * the button did precisely nothing and said nothing. A real dialog
   * both asks and reports.
   */
  function archive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveClient(client.id);
      setConfirmArchive(false);
      if (!result.ok) setError(result.error);
      else router.push("/clients?view=archived");
    });
  }

  function restore() {
    setError(null);
    startTransition(async () => {
      const result = await restoreClient(client.id);
      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader title="Client details" />
      <div className="px-5 py-4 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Saved.</Alert>}

        <Field label="Full name" required>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldClass} />
        </Field>

        <Field label="Age">
          <input
            type="number"
            min={0}
            max={120}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className={fieldClass}
          />
        </Field>

        <PhoneField
          label="Phone"
          hint="SMS and WhatsApp reminders go here."
          value={phone}
          onChange={setPhone}
        />

        <ValidatedField
                      label="Email"
                      hint="Email reminders go here."
                      type="email"
                      inputMode="email"
                      value={email}
                      onChange={setEmail}
                      validate={validators.email()}
                    />

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Gender">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={fieldClass}
            >
              <option value="">Not recorded</option>
              {withCurrent(GENDERS, gender).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Preferred language"
            hint="Used to match them to a counsellor who speaks it."
          >
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
                {c.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className={`${fieldClass} resize-y`}
          />
        </Field>

        <div className="flex gap-2 pt-1">
          <Button onClick={save} disabled={pending} className="flex-1">
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {client.is_active ? (
            <Button
              variant="ghost"
              onClick={() => setConfirmArchive(true)}
              disabled={pending}
              className="text-red-600"
            >
              Archive
            </Button>
          ) : (
            <Button variant="secondary" onClick={restore} disabled={pending}>
              {pending ? "Restoring…" : "Restore"}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${client.full_name}?`}
        footer={
          <>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmArchive(false)}
              disabled={pending}
            >
              Keep them
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={archive}
              disabled={pending}
            >
              {pending ? "Archiving…" : "Archive"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted leading-relaxed">
          They stop appearing in booking lists and search. Their history,
          invoices and notes are all kept, and you can restore them from the
          Archived tab on the Clients list at any time.
        </p>
      </Dialog>
    </Card>
  );
}
