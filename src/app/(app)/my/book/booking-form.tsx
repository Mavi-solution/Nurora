"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert, Button, Card, Field, fieldClass } from "@/components/ui";
import { bookAppointment } from "@/lib/actions/appointments";
import { formatMoney } from "@/lib/format";
import type { Slot } from "@/lib/time";
import type { CounsellorSummary } from "@/lib/types";

export function ClientBookingForm({
  clientId,
  counsellors,
  preferredCounsellorId,
  timezone,
}: {
  clientId: string;
  counsellors: CounsellorSummary[];
  preferredCounsellorId?: string;
  timezone: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [counsellorId, setCounsellorId] = useState(
    preferredCounsellorId ?? counsellors[0]?.id ?? "",
  );
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counsellor = counsellors.find((c) => c.id === counsellorId);
  const duration = counsellor?.default_duration_minutes || 60;
  const fee = counsellor?.default_session_fee_cents ?? 0;

  useEffect(() => {
    if (!counsellorId) return;

    let cancelled = false;
    setLoading(true);
    setStartsAt("");

    fetch(`/api/slots?counsellor=${counsellorId}&date=${date}&duration=${duration}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [counsellorId, date, duration]);

  function submit() {
    setError(null);
    if (!startsAt) return setError("Pick a time.");

    startTransition(async () => {
      const result = await bookAppointment({
        counsellorId,
        clientId,
        startsAt,
        durationMinutes: duration,
        priceCents: fee,
        clientNotes: notes,
      });

      if (!result.ok) setError(result.error);
      else router.push(`/appointments/${result.data.id}`);
    });
  }

  if (counsellors.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-[14px] text-muted">
          No counsellors are taking bookings right now.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Counsellor" required>
        <select
          value={counsellorId}
          onChange={(e) => setCounsellorId(e.target.value)}
          className={fieldClass}
        >
          {counsellors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
              {c.headline ? ` — ${c.headline}` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date" required>
        <input
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={fieldClass}
        />
      </Field>

      <div>
        <span className="block text-[13px] font-medium mb-1.5">
          Available times <span className="text-red-500">*</span>
        </span>
        {loading ? (
          <p className="text-[13px] text-muted py-3">Checking availability…</p>
        ) : slots.length === 0 ? (
          <p className="text-[13px] text-muted py-3">
            Nothing open that day. Try another date.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {slots.map((slot) => {
              const selected = slot.startsAt === startsAt;
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  onClick={() => setStartsAt(slot.startsAt)}
                  className={`h-10 rounded-lg border text-[13px] tabular-nums transition-colors ${
                    selected
                      ? "bg-brand-600 border-brand-600 text-white font-medium"
                      : "border-hairline bg-card hover:bg-card-muted text-muted"
                  }`}
                >
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }).format(new Date(slot.startsAt))}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Field label="Anything to share beforehand?" hint="Optional — your counsellor sees this.">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`${fieldClass} resize-y`}
        />
      </Field>

      <div className="flex items-center justify-between pt-2 border-t border-hairline">
        <div>
          <p className="text-[13px] text-muted">
            {duration} minutes
            {fee > 0 && ` · ${formatMoney(fee, counsellor?.currency ?? "INR")}`}
          </p>
        </div>
        <Button onClick={submit} disabled={pending || !startsAt}>
          {pending ? "Booking…" : "Confirm booking"}
        </Button>
      </div>
    </Card>
  );
}
