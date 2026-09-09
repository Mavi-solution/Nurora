"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import { archiveClient, updateClientRecord } from "@/lib/actions/clients";
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
  const [notes, setNotes] = useState(client.notes ?? "");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
        notes,
      });

      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  function archive() {
    if (!confirm(`Archive ${client.full_name}? They stop appearing in booking lists.`)) return;
    startTransition(async () => {
      const result = await archiveClient(client.id);
      if (!result.ok) setError(result.error);
      else router.push("/clients");
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

        <Field label="Phone" hint="SMS and WhatsApp reminders go here.">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
        </Field>

        <Field label="Email" hint="Email reminders go here.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
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
            rows={4}
            className={`${fieldClass} resize-y`}
          />
        </Field>

        <div className="flex gap-2 pt-1">
          <Button onClick={save} disabled={pending} className="flex-1">
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={archive} disabled={pending} className="text-red-600">
            Archive
          </Button>
        </div>
      </div>
    </Card>
  );
}
