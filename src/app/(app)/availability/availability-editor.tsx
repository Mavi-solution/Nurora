"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass, Pill } from "@/components/ui";
import {
  addAvailabilityException,
  removeAvailabilityException,
  saveWeeklyAvailability,
} from "@/lib/actions/availability";
import { WEEKDAYS } from "@/lib/time";
import type { AvailabilityException, AvailabilityRule, CounsellorSummary } from "@/lib/types";

type DraftRule = { weekday: number; startTime: string; endTime: string };

export function AvailabilityEditor({
  canPickCounsellor,
  counsellors,
  selectedId,
  rules,
  exceptions,
  timezone,
}: {
  canPickCounsellor: boolean;
  counsellors: CounsellorSummary[];
  selectedId: string;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  timezone: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftRule[]>(() =>
    rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time.slice(0, 5),
      endTime: r.end_time.slice(0, 5),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Exception form
  const [exDate, setExDate] = useState("");
  const [exReason, setExReason] = useState("");


  function addWindow(weekday: number) {
    setDraft((d) => [...d, { weekday, startTime: "09:00", endTime: "18:00" }]);
    setSaved(false);
  }

  function updateWindow(index: number, patch: Partial<DraftRule>) {
    setDraft((d) => d.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(false);
  }

  function removeWindow(index: number) {
    setDraft((d) => d.filter((_, i) => i !== index));
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveWeeklyAvailability(selectedId, draft);
      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  function blockDate() {
    if (!exDate) return setError("Pick a date to block.");
    setError(null);
    startTransition(async () => {
      const result = await addAvailabilityException({
        counsellorId: selectedId,
        onDate: exDate,
        isAvailable: false,
        reason: exReason,
      });
      if (!result.ok) setError(result.error);
      else {
        setExDate("");
        setExReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Availability</h1>
          <p className="text-[13px] text-muted mt-0.5">
            Working hours in {timezone}. Open slots on the schedule come from these.
          </p>
        </div>
        <div className="flex-1" />
        {canPickCounsellor && (
          <select
            value={selectedId}
            onChange={(e) => router.push(`/availability?counsellor=${e.target.value}`)}
            className="rounded-full border border-hairline bg-card px-4 py-1.5 text-[13px] cursor-pointer"
            aria-label="Choose counsellor"
          >
            {counsellors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Weekly hours saved.</Alert>}

        <Card>
          <CardHeader
            title="Weekly hours"
            description="Add one or more windows per day. Leave a day empty to stay unavailable."
            action={
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save week"}
              </Button>
            }
          />
          <div className="divide-y divide-[var(--border)]">
            {WEEKDAYS.map((name, weekday) => {
              const windows = draft
                .map((r, index) => ({ ...r, index }))
                .filter((r) => r.weekday === weekday);

              return (
                <div key={name} className="px-5 py-3.5 flex flex-wrap items-start gap-3">
                  <div className="w-24 shrink-0 pt-1.5">
                    <p className="text-[14px] font-medium">{name}</p>
                    {windows.length === 0 && (
                      <p className="text-[12px] text-faint">Closed</p>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    {windows.map((w) => (
                      <div key={w.index} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={w.startTime}
                          onChange={(e) => updateWindow(w.index, { startTime: e.target.value })}
                          className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-[13px] tabular-nums"
                          aria-label={`${name} start time`}
                        />
                        <span className="text-faint text-[13px]">to</span>
                        <input
                          type="time"
                          value={w.endTime}
                          onChange={(e) => updateWindow(w.index, { endTime: e.target.value })}
                          className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-[13px] tabular-nums"
                          aria-label={`${name} end time`}
                        />
                        <button
                          type="button"
                          onClick={() => removeWindow(w.index)}
                          aria-label={`Remove ${name} window`}
                          className="size-7 grid place-items-center rounded-full text-faint hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => addWindow(weekday)}
                    className="text-[13px] text-brand-700 dark:text-brand-300 hover:underline shrink-0 pt-1.5"
                  >
                    + Add window
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Time off"
            description="Block a specific date — holidays, leave, anything one-off."
          />
          <div className="px-5 py-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Field label="Date">
                  <input
                    type="date"
                    value={exDate}
                    onChange={(e) => setExDate(e.target.value)}
                    className={fieldClass}
                  />
                </Field>
              </div>
              <div className="flex-1 min-w-40">
                <Field label="Reason">
                  <input
                    value={exReason}
                    onChange={(e) => setExReason(e.target.value)}
                    className={fieldClass}
                    placeholder="Public holiday"
                  />
                </Field>
              </div>
              <Button variant="secondary" onClick={blockDate} disabled={pending}>
                Block date
              </Button>
            </div>

            {exceptions.length === 0 ? (
              <p className="text-[13px] text-muted">No upcoming time off.</p>
            ) : (
              <ul className="space-y-2">
                {exceptions.map((ex) => (
                  <li
                    key={ex.id}
                    className="flex items-center gap-3 rounded-xl border border-hairline px-3.5 py-2.5"
                  >
                    <span className="text-[13px] font-medium tabular-nums">{ex.on_date}</span>
                    <Pill>{ex.is_available ? "Extra hours" : "Blocked"}</Pill>
                    <span className="text-[13px] text-muted flex-1 truncate">
                      {ex.reason ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(async () => {
                          await removeAvailabilityException(ex.id);
                          router.refresh();
                        })
                      }
                      className="text-[12px] text-muted hover:text-red-600 transition-colors"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
