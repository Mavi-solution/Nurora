"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDaysToDateKey, pad, WEEKDAYS } from "@/lib/time";

/**
 * How a day looks on the calendar.
 *
 *   open     slots going spare
 *   limited  two or fewer left — worth saying so before it goes
 *   full     working that day, nothing left
 *   off      that counsellor is off: week-off or leave
 *   closed   the whole clinic is shut: a holiday, or a closed weekday
 *
 * "off" and "closed" are kept apart on purpose even though both mean
 * "cannot book". Offering the caller a different counsellor solves one
 * of them and is useless for the other.
 */
export type DayStatus = "open" | "limited" | "full" | "off" | "closed";

export type DayStatusMap = Record<string, DayStatus>;

const DOT: Record<DayStatus, string> = {
  open: "bg-sage-500",
  limited: "bg-amber-500",
  full: "bg-[var(--border-strong)]",
  off: "bg-blush-400",
  closed: "bg-red-400",
};

const TITLE: Record<DayStatus, string> = {
  open: "Slots free",
  limited: "Almost full",
  full: "Fully booked",
  off: "Counsellor off",
  closed: "Clinic closed",
};

/**
 * A date field that actually looks like one.
 *
 * `<input type="date">` renders differently in every browser and on
 * several of them shows no calendar affordance at all until it is
 * focused — which is what every "add a calendar icon" line on the QA
 * sheet is about. This is one control that looks the same everywhere,
 * and, more usefully, can colour the days: a desk picking a date for a
 * caller should be able to see that Sunday is shut and Thursday is
 * nearly gone WITHOUT clicking each one to find out.
 *
 * The native input is still there, visually hidden, so form posts,
 * autofill and screen readers keep working exactly as before.
 */
export function DateField({
  label,
  value,
  onChange,
  name,
  min,
  max,
  required,
  hint,
  disabled,
  dayStatus,
  loadingStatus,
  onMonthChange,
  legend = true,
}: {
  label?: string;
  value: string;
  onChange: (dateKey: string) => void;
  name?: string;
  /** Earliest selectable day, "YYYY-MM-DD". Earlier days are dimmed. */
  min?: string;
  max?: string;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
  /** Per-day colouring, keyed by "YYYY-MM-DD". */
  dayStatus?: DayStatusMap;
  loadingStatus?: boolean;
  /** Fired when the visible month changes, so a caller can fetch it. */
  onMonthChange?: (monthKey: string) => void;
  legend?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => (value || today()).slice(0, 7));
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reopening on a different value should land on that value's month,
  // not wherever the calendar was left last time.
  useEffect(() => {
    if (open && value) setCursor(value.slice(0, 7));
  }, [open, value]);

  useEffect(() => {
    onMonthChange?.(cursor);
  }, [cursor, onMonthChange]);

  useEffect(() => {
    if (!open) return;

    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const grid = useMemo(() => buildMonth(cursor), [cursor]);
  const todayKey = today();

  function pick(dateKey: string) {
    onChange(dateKey);
    setOpen(false);
  }

  function shiftMonth(by: number) {
    const [y, m] = cursor.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setCursor(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }

  const statuses = dayStatus ?? {};
  const shown = Object.values(statuses).length > 0;

  return (
    <div>
      {label && (
        <span
          className={`block text-[13px] font-medium mb-1.5 ${
            required ? "is-required" : ""
          }`}
        >
          {label}
        </span>
      )}

      <div className="relative" ref={wrapRef}>
        {/* The real input keeps form posts and autofill working. */}
        {name && <input type="hidden" name={name} value={value} />}

        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label ? `${label}: ${prettyDate(value)}` : prettyDate(value)}
          className={`w-full flex items-center gap-2.5 rounded-xl border border-[var(--border-strong)] bg-card
            px-3.5 py-2.5 text-sm text-left transition-shadow
            hover:bg-card-muted disabled:opacity-50 disabled:pointer-events-none
            focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 focus:outline-none
            ${open ? "border-brand-500 ring-4 ring-brand-500/12" : ""}`}
        >
          <CalendarGlyph />
          <span className={`flex-1 min-w-0 truncate ${value ? "" : "text-faint"}`}>
            {value ? prettyDate(value) : "Pick a date"}
          </span>
          {value && shown && statuses[value] && (
            <span
              className={`size-2 rounded-full shrink-0 ${DOT[statuses[value]]}`}
              title={TITLE[statuses[value]]}
            />
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-faint shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Choose a date"
            className="absolute z-30 mt-2 w-[19.5rem] rounded-2xl border border-hairline bg-card shadow-card p-3 animate-in-up"
          >
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="size-8 grid place-items-center rounded-full text-muted hover:bg-card-muted transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <span className="text-[13px] font-semibold">
                {monthLabel(cursor)}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="size-8 grid place-items-center rounded-full text-muted hover:bg-card-muted transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map((d) => (
                <span
                  key={d}
                  className="text-center text-[10px] uppercase tracking-[0.06em] text-faint font-medium py-1"
                >
                  {d.slice(0, 1)}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {grid.map((key, i) =>
                key === null ? (
                  <span key={`pad-${i}`} />
                ) : (
                  <DayButton
                    key={key}
                    dateKey={key}
                    selected={key === value}
                    isToday={key === todayKey}
                    blocked={
                      (min !== undefined && key < min) ||
                      (max !== undefined && key > max)
                    }
                    status={statuses[key]}
                    onPick={pick}
                  />
                ),
              )}
            </div>

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-hairline">
              <button
                type="button"
                onClick={() => pick(todayKey)}
                className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => pick(addDaysToDateKey(todayKey, 1))}
                className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
              >
                Tomorrow
              </button>
              <div className="flex-1" />
              {loadingStatus && (
                <span className="text-[11px] text-faint">Checking…</span>
              )}
            </div>

            {legend && shown && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {(["open", "limited", "full", "off", "closed"] as DayStatus[]).map(
                  (s) => (
                    <span key={s} className="flex items-center gap-1.5 text-[11px] text-faint">
                      <span className={`size-1.5 rounded-full ${DOT[s]}`} />
                      {TITLE[s]}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {hint && <span className="block text-[12px] text-faint mt-1.5">{hint}</span>}
    </div>
  );
}

function DayButton({
  dateKey,
  selected,
  isToday,
  blocked,
  status,
  onPick,
}: {
  dateKey: string;
  selected: boolean;
  isToday: boolean;
  blocked: boolean;
  status?: DayStatus;
  onPick: (d: string) => void;
}) {
  const day = Number(dateKey.slice(8));

  // A closed day is not selectable: picking it can only ever produce a
  // "no open slots" dead end, so the calendar says no at the point of
  // the click instead of after it.
  const unselectable = blocked || status === "closed";

  return (
    <button
      type="button"
      disabled={unselectable}
      onClick={() => onPick(dateKey)}
      aria-current={selected ? "date" : undefined}
      title={status ? TITLE[status] : undefined}
      className={`relative h-9 grid place-items-center rounded-lg text-[13px] tabular-nums transition-colors
        ${
          selected
            ? "bg-brand-600 text-white font-semibold"
            : unselectable
              ? "text-faint/50 cursor-not-allowed line-through decoration-1"
              : isToday
                ? "bg-brand-50 text-brand-800 font-medium dark:bg-brand-400/12 dark:text-brand-100 hover:bg-brand-100 dark:hover:bg-brand-400/20"
                : "text-muted hover:bg-card-muted hover:text-body"
        }`}
    >
      {day}
      {status && !selected && (
        <span
          className={`absolute bottom-1 size-1 rounded-full ${DOT[status]}`}
          aria-hidden
        />
      )}
    </button>
  );
}

function CalendarGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand-600 dark:text-brand-300 shrink-0"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/* ------------------------------------------------------------- helpers */

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Leading blanks plus every day, so the grid lines up under S M T W T F S. */
function buildMonth(monthKey: string): (string | null)[] {
  const [y, m] = monthKey.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`),
  ];
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function prettyDate(dateKey: string): string {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
