"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { DateField } from "@/components/date-field";
import { useMonthAvailability } from "@/components/use-month-availability";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { rescheduleAppointment } from "@/lib/actions/appointments";
import type { Slot } from "@/lib/time";

/**
 * Move a session to a new time.
 *
 * rescheduleAppointment() has existed since the reschedule history
 * migration, and nothing ever called it — which is the BRIC report
 * ("no buttons to move to the rescheduling section") seen from the
 * other end: the Reschedule tab could only ever be empty, because the
 * app had no way to move anything into it.
 *
 * The new time is chosen from the counsellor's real open slots, not
 * typed. A free-text time would let a session be moved onto a week-off,
 * onto a clinic holiday, or on top of another booking — and the desk
 * would only find out when two clients arrived at once.
 */
export function RescheduleDialog({
  open,
  onClose,
  appointmentId,
  counsellorId,
  durationMinutes,
  currentStartsAt,
  timezone,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  counsellorId: string;
  durationMinutes: number;
  currentStartsAt: string;
  timezone: string;
  onDone: (message: string) => void;
}) {
  const [date, setDate] = useState(() => currentStartsAt.slice(0, 10));
  const [startsAt, setStartsAt] = useState("");
  const [reason, setReason] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const availability = useMonthAvailability({
    enabled: open,
    counsellorId,
    durationMinutes,
  });

  useEffect(() => {
    if (!open) return;
    setDate(currentStartsAt.slice(0, 10));
    setStartsAt("");
    setReason("");
    setError(null);
  }, [open, currentStartsAt]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setStartsAt("");

    fetch(
      `/api/slots?counsellor=${counsellorId}&date=${date}&duration=${durationMinutes}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSlots(data.slots ?? []);
        setClosedReason(data.closedReason ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setClosedReason(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, counsellorId, date, durationMinutes]);

  function submit() {
    setError(null);
    if (!startsAt) return setError("Pick the new time.");

    startTransition(async () => {
      const result = await rescheduleAppointment(
        appointmentId,
        startsAt,
        durationMinutes,
        reason,
      );

      if (!result.ok) return setError(result.error);

      onDone(
        result.data.whatsapp
          ? "Moved, and the client has been told on WhatsApp."
          : "Moved. The client was NOT messaged — check their number.",
      );
      onClose();
    });
  }

  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="30rem"
      title="Move this session"
      footer={
        <>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={pending}
          >
            Keep it
          </Button>
          <Button className="flex-1" onClick={submit} disabled={pending || !startsAt}>
            {pending ? "Moving…" : "Move session"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <p className="text-[13px] text-muted leading-relaxed">
          Currently {time(currentStartsAt)} on {currentStartsAt.slice(0, 10)}.
          The original is kept and marked as moved, so it still shows under
          BRIC → Reschedule with a link to where it went. Any advance already
          taken follows the session.
        </p>

        <DateField
          label="New date"
          required
          value={date}
          onChange={setDate}
          dayStatus={availability.status}
          loadingStatus={availability.loading}
          onMonthChange={availability.onMonthChange}
        />

        <div>
          <span className="block text-[13px] font-medium mb-1.5 is-required">
            New time
          </span>
          {loading ? (
            <p className="text-[13px] text-muted py-2">Checking availability…</p>
          ) : slots.length === 0 ? (
            <p className="text-[13px] text-muted py-2">
              {closedReason
                ? `Not available on ${date} — ${closedReason}.`
                : `Nothing free on ${date}. Try another day.`}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto pr-1">
              {slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  onClick={() => setStartsAt(slot.startsAt)}
                  className={`h-9 rounded-lg border text-[13px] tabular-nums transition-colors ${
                    slot.startsAt === startsAt
                      ? "bg-brand-600 border-brand-600 text-white font-medium"
                      : "border-hairline bg-card hover:bg-card-muted text-muted"
                  }`}
                >
                  {time(slot.startsAt)}
                </button>
              ))}
            </div>
          )}
        </div>

        <Field label="Reason" hint="Kept on the original session's record.">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={fieldClass}
            placeholder="Client asked to move it"
          />
        </Field>
      </div>
    </Dialog>
  );
}
