"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import {
  logNubill,
  prepareClientMessage,
  savePersona,
  setMilestone,
} from "@/lib/actions/milestones";
import {
  milestoneProgress,
  type MilestoneKey,
  type MilestoneSource,
} from "@/lib/business/milestones";

/**
 * The five-step track under each appointment on the schedule.
 *
 * Step 3 has no toggle — it follows the session timer, so the track can
 * never claim a session ran when the timer says otherwise.
 */
export function MilestoneTrack({
  appointmentId,
  appointment,
  canEdit,
}: {
  appointmentId: string;
  appointment: MilestoneSource;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MilestoneKey | null>(null);
  const [nubillText, setNubillText] = useState("");
  const [concern, setConcern] = useState("");
  const [language, setLanguage] = useState("");
  const [waLink, setWaLink] = useState<{ href: string; text: string } | null>(null);

  const progress = milestoneProgress(appointment);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        setOpen(null);
        setNubillText("");
        setWaLink(null);
        router.refresh();
      }
    });
  }

  function onStepClick(key: MilestoneKey, done: boolean) {
    if (!canEdit) return;
    setError(null);

    if (key === "session") {
      setError("This step follows the session timer — use Start and End.");
      return;
    }
    if (done) {
      run(() => setMilestone(appointmentId, key as "message" | "call" | "nubill" | "persona", false));
      return;
    }

    // The three steps that need something more than a tick.
    if (key === "message") {
      startTransition(async () => {
        const result = await prepareClientMessage(appointmentId);
        if (!result.ok) setError(result.error);
        else {
          setWaLink({ href: result.data.href, text: result.data.text });
          setOpen("message");
        }
      });
      return;
    }
    if (key === "nubill" || key === "persona") {
      setOpen(key);
      return;
    }

    run(() => setMilestone(appointmentId, "call", true));
  }

  return (
    <div className="mt-2">
      {/* ------------------------------------------------- the track */}
      <div className="flex items-center" role="list" aria-label="Appointment milestones">
        {progress.steps.map((step, i) => (
          <div key={step.milestone.key} className="flex items-center" role="listitem">
            {i > 0 && (
              <span
                className={`h-px w-8 sm:w-12 ${
                  step.done ? "bg-brand-500" : "bg-[var(--border-strong)]"
                }`}
                aria-hidden
              />
            )}
            <button
              type="button"
              disabled={pending || !canEdit}
              onClick={() => onStepClick(step.milestone.key, step.done)}
              title={`${i + 1}. ${step.milestone.label} — ${step.milestone.hint}`}
              aria-label={`Step ${i + 1}: ${step.milestone.label}${step.done ? ", done" : ""}`}
              aria-pressed={step.done}
              className={`size-5 rounded-full grid place-items-center border transition-colors shrink-0 ${
                step.done
                  ? "bg-brand-600 border-brand-600 text-white"
                  : progress.currentStep === i + 1
                    ? "border-brand-500 bg-card text-brand-600 ring-2 ring-brand-500/20"
                    : "border-[var(--border-strong)] bg-card text-faint"
              } ${canEdit && !pending ? "hover:border-brand-500 cursor-pointer" : "cursor-default"}`}
            >
              {step.done ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              ) : (
                <StepIcon step={step.milestone.key} />
              )}
            </button>
          </div>
        ))}
      </div>

      <p
        className={`text-[11px] mt-1.5 ${
          progress.allDone
            ? "text-emerald-700 dark:text-emerald-300 font-medium"
            : "text-muted"
        }`}
      >
        {progress.allDone
          ? `All ${progress.total} steps done`
          : `Step ${progress.currentStep} of ${progress.total} · ${progress.currentLabel}`}
      </p>

      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}

      {/* ------------------------------------- 1. personalize message */}
      <Dialog
        open={open === "message" && waLink !== null}
        onClose={() => { setOpen(null); setWaLink(null); }}
        title="Send the confirmation"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(null); setWaLink(null); }}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => run(() => setMilestone(appointmentId, "message", true))}
            >
              Mark as sent
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted leading-relaxed">
            Open WhatsApp with this message prefilled, send it, then mark the
            step done. The automatic confirmation already went out at booking —
            this is your personal follow-up.
          </p>
          <pre className="text-[12px] whitespace-pre-wrap break-words bg-card-muted border border-hairline rounded-xl p-3 max-h-48 overflow-y-auto">
            {waLink?.text}
          </pre>
          {waLink && (
            <a
              href={waLink.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Open in WhatsApp
            </a>
          )}
        </div>
      </Dialog>

      {/* -------------------------------------------------- 4. NuBills */}
      <Dialog
        open={open === "nubill"}
        onClose={() => setOpen(null)}
        title="Log the billing text"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending || nubillText.trim().length < 4}
              onClick={() => run(() => logNubill(appointmentId, nubillText))}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted leading-relaxed">
            Paste the confirmation from wherever the payment came through. The
            raw text is what gets stored — anything picked out of it is only a
            convenience.
          </p>
          <textarea
            value={nubillText}
            onChange={(e) => setNubillText(e.target.value)}
            rows={6}
            placeholder="Paid ₹2,000 to Nurora · UPI Ref 402318778421"
            className={`${fieldClass} resize-y`}
          />
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Dialog>

      {/* -------------------------------------------------- 5. Persona */}
      <Dialog
        open={open === "persona"}
        onClose={() => setOpen(null)}
        title="Fill the Persona"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() =>
                run(() =>
                  savePersona(appointmentId, {
                    presentingConcern: concern || null,
                    preferredLanguage: language || null,
                  }),
                )
              }
            >
              Save Persona
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] text-muted leading-relaxed">
            Saved onto the client&apos;s record. Fields left blank keep whatever
            is already on file rather than clearing it.
          </p>
          <Field label="What they are seeking help with">
            <textarea
              value={concern}
              onChange={(e) => setConcern(e.target.value)}
              rows={4}
              className={`${fieldClass} resize-y`}
              placeholder="In the client's own words…"
            />
          </Field>
          <Field label="Preferred language">
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={fieldClass}
              placeholder="Tamil"
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function StepIcon({ step }: { step: MilestoneKey }) {
  const p = {
    width: 10,
    height: 10,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (step === "message") return <svg {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" /></svg>;
  if (step === "call") return <svg {...p}><path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z" /></svg>;
  if (step === "session") return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
  if (step === "nubill") return <svg {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></svg>;
  return <svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
}
