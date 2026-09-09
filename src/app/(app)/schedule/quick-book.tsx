"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { bookAppointment } from "@/lib/actions/appointments";
import { createClientRecord } from "@/lib/actions/clients";
import { formatMoney } from "@/lib/format";
import type { ClientSummary, CounsellorSummary } from "@/lib/types";
import type { Slot } from "@/lib/time";

export function QuickBookDialog({
  open,
  onClose,
  counsellors,
  clients,
  defaultCounsellorId,
  defaultStartsAt,
  dateKey,
  tz,
  currency,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  counsellors: CounsellorSummary[];
  clients: ClientSummary[];
  defaultCounsellorId?: string;
  defaultStartsAt?: string;
  dateKey: string;
  tz: string;
  currency: string;
  onBooked: () => void;
}) {
  const [counsellorId, setCounsellorId] = useState(
    defaultCounsellorId ?? counsellors[0]?.id ?? "",
  );
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientAge, setNewClientAge] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [date, setDate] = useState(dateKey);
  const [startsAt, setStartsAt] = useState(defaultStartsAt ?? "");
  const [duration, setDuration] = useState(60);
  const [fee, setFee] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counsellor = counsellors.find((c) => c.id === counsellorId);
  const creatingClient = clientId === "__new__";

  // Reset to whatever the caller asked for each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setCounsellorId(defaultCounsellorId ?? counsellors[0]?.id ?? "");
    setStartsAt(defaultStartsAt ?? "");
    setDate(dateKey);
    setError(null);
    setClientId("");
    setNewClientName("");
    setNewClientAge("");
    setNewClientPhone("");
  }, [open, defaultCounsellorId, defaultStartsAt, dateKey, counsellors]);

  // Default the duration and fee from the chosen counsellor.
  useEffect(() => {
    if (!counsellor) return;
    setDuration(counsellor.default_duration_minutes || 60);
    setFee(String((counsellor.default_session_fee_cents || 0) / 100));
  }, [counsellor]);

  // Load open slots whenever counsellor, date or duration changes.
  useEffect(() => {
    if (!open || !counsellorId) return;

    let cancelled = false;
    setLoadingSlots(true);

    fetch(
      `/api/slots?counsellor=${counsellorId}&date=${date}&duration=${duration}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, counsellorId, date, duration]);

  function submit() {
    setError(null);

    if (!counsellorId) return setError("Pick a counsellor.");
    if (!startsAt) return setError("Pick a time slot.");
    if (!creatingClient && !clientId) return setError("Pick a client.");
    if (creatingClient && newClientName.trim().length < 2) {
      return setError("Enter the new client's name.");
    }

    startTransition(async () => {
      let resolvedClientId = clientId;

      if (creatingClient) {
        const created = await createClientRecord({
          fullName: newClientName,
          age: newClientAge ? Number(newClientAge) : null,
          phone: newClientPhone,
          counsellorId,
        });
        if (!created.ok) return setError(created.error);
        resolvedClientId = created.data.id;
      }

      const result = await bookAppointment({
        counsellorId,
        clientId: resolvedClientId,
        startsAt,
        durationMinutes: duration,
        priceCents: Math.round(Number(fee || 0) * 100),
      });

      if (!result.ok) setError(result.error);
      else onBooked();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Quick book"
      width="30rem"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={submit} disabled={pending}>
            {pending ? "Booking…" : "Confirm booking"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Counsellor" required>
          <select
            value={counsellorId}
            onChange={(e) => {
              setCounsellorId(e.target.value);
              setStartsAt("");
            }}
            className={fieldClass}
          >
            {counsellors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Client" required>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={fieldClass}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
                {c.age ? ` · ${c.age}` : ""}
              </option>
            ))}
            <option value="__new__">+ New client…</option>
          </select>
        </Field>

        {creatingClient && (
          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-card-muted border border-hairline">
            <div className="col-span-2">
              <Field label="Full name" required>
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className={fieldClass}
                  placeholder="Ravi Kumar"
                  autoFocus
                />
              </Field>
            </div>
            <Field label="Age">
              <input
                type="number"
                min={0}
                max={120}
                value={newClientAge}
                onChange={(e) => setNewClientAge(e.target.value)}
                className={fieldClass}
                placeholder="36"
              />
            </Field>
            <Field label="Phone">
              <input
                value={newClientPhone}
                onChange={(e) => setNewClientPhone(e.target.value)}
                className={fieldClass}
                placeholder="+91…"
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setStartsAt("");
              }}
              className={fieldClass}
            />
          </Field>
          <Field label="Duration">
            <select
              value={duration}
              onChange={(e) => {
                setDuration(Number(e.target.value));
                setStartsAt("");
              }}
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

        <div>
          <span className="block text-[13px] font-medium mb-1.5">
            Available slots <span className="text-red-500">*</span>
          </span>

          {loadingSlots ? (
            <p className="text-[13px] text-muted py-3">Checking availability…</p>
          ) : slots.length === 0 ? (
            <p className="text-[13px] text-muted py-3">
              No open slots that day. Try another date, or widen the
              counsellor&apos;s availability.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
              {slots.map((slot) => {
                const selected = slot.startsAt === startsAt;
                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    onClick={() => setStartsAt(slot.startsAt)}
                    className={`h-9 rounded-lg border text-[13px] tabular-nums transition-colors ${
                      selected
                        ? "bg-brand-600 border-brand-600 text-white font-medium"
                        : "border-hairline bg-card hover:bg-card-muted text-muted"
                    }`}
                  >
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: tz,
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

        <Field label={`Session fee (${currency})`} hint="Shown on the start-session confirmation and billed to the invoice.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className={fieldClass}
          />
        </Field>

        {fee !== "" && Number(fee) > 0 && (
          <p className="text-[12px] text-muted">
            Invoice will be raised for{" "}
            <strong>{formatMoney(Math.round(Number(fee) * 100), currency)}</strong>.
          </p>
        )}
      </div>
    </Dialog>
  );
}
