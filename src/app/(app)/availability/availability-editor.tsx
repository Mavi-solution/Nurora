"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass, Pill } from "@/components/ui";
import {
  addAvailabilityException,
  removeAvailabilityException,
  saveWeeklyAvailability,
} from "@/lib/actions/availability";
import { DateField } from "@/components/date-field";
import { minutesToTime, timeToMinutes, WEEKDAYS } from "@/lib/time";
import type { AvailabilityException, AvailabilityRule, CounsellorSummary } from "@/lib/types";

type DraftRule = { weekday: number; startTime: string; endTime: string };

/** A new window is this long when there is nothing to infer one from. */
const DEFAULT_WINDOW = { startTime: "09:00", endTime: "18:00" };

/** How long a window added after an existing one runs for, in minutes. */
const FOLLOW_ON_MINUTES = 120;

const END_OF_DAY = 24 * 60;

export function AvailabilityEditor({
  canPickCounsellor,
  counsellors,
  selectedId,
  rules,
  exceptions,
  timezone,
  openWeekdays,
}: {
  canPickCounsellor: boolean;
  counsellors: CounsellorSummary[];
  selectedId: string;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  timezone: string;
  /** Weekdays the clinic opens at all, 0 = Sunday. */
  openWeekdays: number[];
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


  /*
   * Add a window that does not collide with the ones already there.
   *
   * The old version always pushed 09:00–18:00, so a second click made
   * an exact duplicate — which is the "adding same time in the same day
   * multiple times" report. It looked like nothing happened, because
   * two identical rows are indistinguishable from one.
   *
   * A follow-on window therefore starts where the last one ends. When
   * the day is already full to midnight there is nothing sensible to
   * add, and saying so beats adding a window that cannot exist.
   */
  function addWindow(weekday: number) {
    setError(null);
    setSaved(false);

    setDraft((d) => {
      const onDay = d
        .filter((r) => r.weekday === weekday)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      if (onDay.length === 0) return [...d, { weekday, ...DEFAULT_WINDOW }];

      const lastEnd = timeToMinutes(onDay[onDay.length - 1].endTime);
      if (lastEnd >= END_OF_DAY) {
        setError(
          `${WEEKDAYS[weekday]} already runs to the end of the day. Edit or remove a window instead of adding another.`,
        );
        return d;
      }

      const end = Math.min(lastEnd + FOLLOW_ON_MINUTES, END_OF_DAY);
      return [
        ...d,
        {
          weekday,
          startTime: minutesToTime(lastEnd),
          endTime: minutesToTime(end),
        },
      ];
    });
  }

  /** Windows on one day that overlap each other, by draft index. */
  const overlapping = new Set<number>();
  for (const weekday of new Set(draft.map((r) => r.weekday))) {
    const onDay = draft
      .map((r, index) => ({ ...r, index }))
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (let i = 1; i < onDay.length; i += 1) {
      if (onDay[i].startTime < onDay[i - 1].endTime) {
        overlapping.add(onDay[i].index);
        overlapping.add(onDay[i - 1].index);
      }
    }
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

    if (overlapping.size > 0) {
      return setError(
        "Two windows on the same day overlap. Fix the highlighted rows before saving.",
      );
    }

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

              // A day the clinic does not open at all. No hours set on
              // it could ever produce a bookable slot, so the editor
              // does not offer to set any.
              const clinicClosed = !openWeekdays.includes(weekday);

              return (
                <div
                  key={name}
                  className={`px-5 py-3.5 flex flex-wrap items-start gap-3 ${
                    clinicClosed ? "bg-card-muted/50" : ""
                  }`}
                >
                  <div className="w-24 shrink-0 pt-1.5">
                    <p
                      className={`text-[14px] font-medium ${
                        clinicClosed ? "text-faint" : ""
                      }`}
                    >
                      {name}
                    </p>
                    {clinicClosed ? (
                      <p className="text-[12px] text-faint">Clinic closed</p>
                    ) : (
                      windows.length === 0 && (
                        <p className="text-[12px] text-faint">Not working</p>
                      )
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    {clinicClosed ? (
                      <p className="text-[12px] text-faint pt-1.5">
                        The practice does not open on {name}s. An admin can
                        change that under Clinic settings.
                      </p>
                    ) : (
                      windows.map((w) => (
                        <div key={w.index} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={w.startTime}
                            onChange={(e) => updateWindow(w.index, { startTime: e.target.value })}
                            className={`rounded-lg border bg-card px-2.5 py-1.5 text-[13px] tabular-nums ${
                              overlapping.has(w.index)
                                ? "border-red-400 ring-2 ring-red-500/15"
                                : "border-hairline"
                            }`}
                            aria-label={`${name} start time`}
                            aria-invalid={overlapping.has(w.index) || undefined}
                          />
                          <span className="text-faint text-[13px]">to</span>
                          <input
                            type="time"
                            value={w.endTime}
                            onChange={(e) => updateWindow(w.index, { endTime: e.target.value })}
                            className={`rounded-lg border bg-card px-2.5 py-1.5 text-[13px] tabular-nums ${
                              overlapping.has(w.index)
                                ? "border-red-400 ring-2 ring-red-500/15"
                                : "border-hairline"
                            }`}
                            aria-label={`${name} end time`}
                            aria-invalid={overlapping.has(w.index) || undefined}
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
                          {overlapping.has(w.index) && (
                            <span className="text-[12px] text-red-600 dark:text-red-400">
                              overlaps
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {!clinicClosed && (
                    <button
                      type="button"
                      onClick={() => addWindow(weekday)}
                      className="text-[13px] text-brand-700 dark:text-brand-300 hover:underline shrink-0 pt-1.5"
                    >
                      + Add window
                    </button>
                  )}
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
              <div className="w-56">
                <DateField label="Date" value={exDate} onChange={setExDate} />
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
