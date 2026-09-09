"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { SessionTimer } from "@/components/session-timer";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import {
  addManualTime,
  cancelAppointment,
  endSession,
  saveCounsellorNotes,
  setAppointmentStatus,
  startSession,
} from "@/lib/actions/appointments";
import type { AppointmentStatus, TimeEntry } from "@/lib/types";

export function AppointmentActions({
  appointmentId,
  status,
  running,
  isStaff,
  canRun,
  counsellorNotes,
}: {
  appointmentId: string;
  status: AppointmentStatus;
  running: TimeEntry | null;
  isStaff: boolean;
  canRun: boolean;
  counsellorNotes: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [minutes, setMinutes] = useState("60");
  const [manualNote, setManualNote] = useState("");
  const [notes, setNotes] = useState(counsellorNotes);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        if (success) setNotice(success);
        router.refresh();
      }
    });
  }

  const finished = status === "completed" || status === "cancelled";

  return (
    <>
      <Card>
        <CardHeader title="Actions" />
        <div className="px-5 py-4 space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}

          {running && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10 dark:border-emerald-500/25">
              <p className="text-[12px] text-emerald-800 dark:text-emerald-300">
                Session running
              </p>
              <SessionTimer
                startedAt={running.started_at}
                className="block text-2xl text-emerald-800 dark:text-emerald-200 mt-0.5"
              />
            </div>
          )}

          {isStaff && !finished && (
            running ? (
              <Button
                className="w-full"
                disabled={!canRun || pending}
                onClick={() => run(() => endSession(appointmentId), "Session ended and billed.")}
              >
                End session
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={!canRun || pending}
                onClick={() => run(() => startSession(appointmentId))}
              >
                Start session
              </Button>
            )
          )}

          {isStaff && !finished && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() => setManualOpen(true)}
            >
              Log time manually
            </Button>
          )}

          {isStaff && !finished && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() =>
                run(() => setAppointmentStatus(appointmentId, "no_show"), "Marked as a no-show.")
              }
            >
              Mark no-show
            </Button>
          )}

          {!finished && (
            <Button
              variant="ghost"
              className="w-full text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              disabled={pending}
              onClick={() => setCancelOpen(true)}
            >
              Cancel session
            </Button>
          )}

          {finished && (
            <p className="text-[13px] text-muted text-center py-2">
              This session is {status === "cancelled" ? "cancelled" : "complete"}.
            </p>
          )}
        </div>
      </Card>

      {isStaff && (
        <Card>
          <CardHeader title="Counsellor notes" description="Private to the practice." />
          <div className="px-5 py-4 space-y-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className={`${fieldClass} resize-y`}
              placeholder="Observations, follow-ups, plan for next time…"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={pending || notes === counsellorNotes}
              onClick={() => run(() => saveCounsellorNotes(appointmentId, notes), "Notes saved.")}
            >
              Save notes
            </Button>
          </div>
        </Card>
      )}

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this session?"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={pending}
              onClick={() => {
                run(() => cancelAppointment(appointmentId, reason));
                setCancelOpen(false);
              }}
            >
              Cancel session
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted mb-4 leading-relaxed">
          The slot frees up immediately and any unpaid invoice is waived.
          Reminders for this session stop going out.
        </p>
        <Field label="Reason" hint="Shown on the session record.">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={fieldClass}
            placeholder="Client rescheduled"
            autoFocus
          />
        </Field>
      </Dialog>

      <Dialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Log time manually"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => {
                run(
                  () => addManualTime(appointmentId, Number(minutes), manualNote),
                  "Time logged.",
                );
                setManualOpen(false);
              }}
            >
              Log time
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Minutes" required>
            <input
              type="number"
              min={1}
              max={480}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className={fieldClass}
              autoFocus
            />
          </Field>
          <Field label="Note">
            <input
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              className={fieldClass}
              placeholder="Ran over by 15 minutes"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
