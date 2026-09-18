"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { DictateButton, useDictation } from "@/components/dictation";
import { SessionTimer } from "@/components/session-timer";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import {
  addManualTime,
  cancelAppointment,
  endSession,
  resendAppointmentConfirmation,
  saveSessionNote,
  setAppointmentStatus,
  startSession,
} from "@/lib/actions/appointments";
import type { AppointmentStatus, TimeEntry } from "@/lib/types";
import { RescheduleDialog } from "./reschedule-dialog";

export function AppointmentActions({
  appointmentId,
  status,
  running,
  isStaff,
  canRun,
  isClinical,
  sessionNote,
  startCheck,
  counsellorId,
  durationMinutes,
  startsAt,
  timezone,
  rescheduledToId,
}: {
  appointmentId: string;
  status: AppointmentStatus;
  running: TimeEntry | null;
  isStaff: boolean;
  canRun: boolean;
  isClinical: boolean;
  sessionNote: string;
  /** Why the session cannot start yet, from business/session-start.ts. */
  startCheck: { ok: true } | { ok: false; reason: string };
  counsellorId: string;
  durationMinutes: number;
  startsAt: string;
  timezone: string;
  /** Set once this session has been superseded by its replacement. */
  rescheduledToId: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  /*
   * BRIC links straight here with ?reschedule=1, so the desk lands on
   * the dialog rather than on the page and then having to find the
   * button. Opened once, on arrival — reopening it every render would
   * make the dialog impossible to close.
   */
  const searchParams = useSearchParams();
  const wantsReschedule = searchParams.get("reschedule") === "1";
  const openedFromLink = useRef(false);

  useEffect(() => {
    if (!wantsReschedule || openedFromLink.current) return;
    openedFromLink.current = true;
    if (status !== "completed" && status !== "cancelled" && !rescheduledToId) {
      setRescheduleOpen(true);
    }
  }, [wantsReschedule, status, rescheduledToId]);
  const [reason, setReason] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [minutes, setMinutes] = useState("60");
  const [manualNote, setManualNote] = useState("");
  const [notes, setNotes] = useState(sessionNote);
  // After ending a session the notes are what's outstanding, so the card
  // asks for them instead of leaving the counsellor to find it.
  const [promptNotes, setPromptNotes] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const dictation = useDictation({
    onText: setNotes,
    baseline: () => notes,
    continuous: true,
  });

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
            <div className="rounded-xl border border-sage-200 bg-sage-50 px-4 py-3 dark:bg-sage-500/10 dark:border-sage-500/25">
              <p className="text-[12px] text-sage-800 dark:text-sage-300">
                Session running
              </p>
              <SessionTimer
                startedAt={running.started_at}
                className="block text-2xl text-sage-800 dark:text-sage-200 mt-0.5"
              />
            </div>
          )}

          {isClinical && !finished && (
            running ? (
              <Button
                className="w-full"
                disabled={!canRun || pending}
                onClick={() =>
                  run(() => {
                    setPromptNotes(true);
                    return endSession(appointmentId);
                  }, "Session ended and billed. Write up your notes below.")
                }
              >
                End session
              </Button>
            ) : (
              <>
                <Button
                  className="w-full"
                  disabled={!canRun || pending || !startCheck.ok}
                  title={startCheck.ok ? undefined : startCheck.reason}
                  onClick={() => run(() => startSession(appointmentId))}
                >
                  Start session
                </Button>
                {canRun && !startCheck.ok && (
                  <p className="text-[12px] text-blush-700 dark:text-blush-300 mt-2 leading-relaxed">
                    {startCheck.reason}
                  </p>
                )}
              </>
            )
          )}

          {isClinical && !finished && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() => setManualOpen(true)}
            >
              Log time manually
            </Button>
          )}

          {isStaff && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() =>
                run(
                  () => resendAppointmentConfirmation(appointmentId),
                  "Sent to the client on WhatsApp.",
                )
              }
            >
              Resend WhatsApp confirmation
            </Button>
          )}

          {/* Moving a session is a different act from cancelling it —
              the client keeps their booking and any advance follows it —
              so it gets its own button rather than living inside the
              cancel dialog. */}
          {isStaff && !finished && !rescheduledToId && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() => setRescheduleOpen(true)}
            >
              Reschedule
            </Button>
          )}

          {rescheduledToId && (
            <p className="text-[13px] text-muted text-center py-1">
              This session was moved.{" "}
              <a
                href={`/appointments/${rescheduledToId}`}
                className="text-brand-700 dark:text-brand-300 hover:underline"
              >
                Open the new one
              </a>
              .
            </p>
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

      {isClinical && (
        <Card>
          <CardHeader
            title="Session notes"
            description="Clinical record — only you and an admin can read this."
            action={
              dictation.supported ? (
                <DictateButton
                  listening={dictation.listening}
                  onClick={dictation.toggle}
                  label="Dictate"
                />
              ) : undefined
            }
          />
          <div className="px-5 py-4 space-y-3">
            {promptNotes && notes.trim() === "" && (
              <Alert tone="info">
                The session is billed. Write up what happened while it is fresh
                {dictation.supported ? " — or dictate it." : "."}
              </Alert>
            )}

            {dictation.error && <Alert tone="error">{dictation.error}</Alert>}

            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={promptNotes ? 8 : 5}
              className={`${fieldClass} resize-y ${
                dictation.listening ? "border-red-400 ring-4 ring-red-500/10" : ""
              }`}
              placeholder={
                dictation.listening
                  ? "Listening — speak now…"
                  : "Observations, follow-ups, plan for next time…"
              }
            />

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || notes === sessionNote}
                onClick={() =>
                  run(() => {
                    dictation.stop();
                    setPromptNotes(false);
                    return saveSessionNote(appointmentId, notes);
                  }, "Notes saved.")
                }
              >
                Save notes
              </Button>
              {dictation.listening && (
                <span className="text-[12px] text-muted">
                  Dictation keeps running between pauses — stop it when you are done.
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      <RescheduleDialog
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        appointmentId={appointmentId}
        counsellorId={counsellorId}
        durationMinutes={durationMinutes}
        currentStartsAt={startsAt}
        timezone={timezone}
        onDone={(message) => {
          setNotice(message);
          router.refresh();
        }}
      />

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
