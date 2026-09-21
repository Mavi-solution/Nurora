"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  PersonaFields,
  emptyPersonaDraft,
  type PersonaDraft,
} from "@/components/persona-fields";
import { Alert, Button, Card, CardHeader, Pill } from "@/components/ui";
import { savePersonaForClient } from "@/lib/actions/clients";
import { personaState } from "@/lib/business/persona";
import type { Client } from "@/lib/types";

/**
 * The Persona on the client's own record.
 *
 * The session milestone is where it is usually taken, mid-appointment.
 * This is the same form for everything else: a detail corrected over
 * the phone, an intake finished after the client has left, or simply
 * reading back what was recorded last time.
 */
export function PersonaCard({ client }: { client: Client }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PersonaDraft>(() => emptyPersonaDraft(client));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const state = personaState(client);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await savePersonaForClient(client.id, {
        background: draft.background || null,
        presentingConcern: draft.presentingConcern || null,
        referralSource: draft.referralSource || null,
        preferredLanguage: draft.preferredLanguage || null,
        address: draft.address || null,
        area: draft.area || null,
        education: draft.education || null,
        occupation: draft.occupation || null,
      });

      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Persona"
        description="Intake and assessment. Shared with the session milestone."
        action={
          state.complete ? (
            <Pill>Complete</Pill>
          ) : state.isFirstVisit ? (
            <Pill>First visit due</Pill>
          ) : (
            <Pill>Partly filled</Pill>
          )
        }
      />
      <div className="px-5 py-4 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Persona saved.</Alert>}

        <PersonaFields client={client} draft={draft} onChange={setDraft} />

        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save Persona"}
        </Button>
      </div>
    </Card>
  );
}
