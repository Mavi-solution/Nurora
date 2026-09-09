"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AgeSelect } from "@/components/age-select";
import { Dialog } from "@/components/dialog";
import { SessionTimer } from "@/components/session-timer";
import { Alert, Avatar, Button, Card, EmptyState } from "@/components/ui";
import { endSession, startSession } from "@/lib/actions/appointments";
import { toggleCheckIn } from "@/lib/actions/shifts";
import { formatMoney } from "@/lib/format";
import { addDaysToDateKey, pad, WEEKDAYS } from "@/lib/time";
import type {
  AppointmentRow,
  ClientSummary,
  CounsellorSummary,
  Profile,
  ScheduleLane,
} from "@/lib/types";
import { QuickBookDialog } from "./quick-book";
import { TeamComposer } from "./team-composer";

export function ScheduleBoard({
  profile,
  dateKey,
  todayKey,
  counsellors,
  counsellorFilter,
  lanes,
  clients,
  checkedInAt,
}: {
  profile: Profile;
  dateKey: string;
  todayKey: string;
  counsellors: CounsellorSummary[];
  counsellorFilter: string;
  lanes: ScheduleLane[];
  clients: ClientSummary[];
  checkedInAt: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startTarget, setStartTarget] = useState<AppointmentRow | null>(null);
  const [quickBook, setQuickBook] = useState<{
    counsellorId?: string;
    startsAt?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const tz = profile.timezone;

  function go(next: Partial<{ date: string; counsellor: string }>) {
    const search = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === "all" && k === "counsellor") search.delete(k);
      else search.set(k, v);
    }
    router.push(`/schedule?${search.toString()}`);
  }

  function onCheckIn() {
    setError(null);
    startTransition(async () => {
      const result = await toggleCheckIn();
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function onEnd(appointmentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await endSession(appointmentId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const totalBooked = lanes.reduce((n, l) => n + l.appointments.length, 0);
  const isToday = dateKey === todayKey;

  return (
    <div className="pb-32">
      {/* ------------------------------------------------ check-in */}
      <div className="flex justify-center mb-6">
        <button
          type="button"
          onClick={onCheckIn}
          disabled={pending}
          aria-pressed={Boolean(checkedInAt)}
          className={`group inline-flex items-center gap-3 rounded-full border pl-4 pr-1.5 py-1.5 text-[13px] font-medium
            transition-all disabled:opacity-60 ${
              checkedInAt
                ? "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-100"
                : "border-hairline bg-card text-muted hover:text-body hover:shadow-card"
            }`}
        >
          <PinIcon />
          {checkedInAt ? (
            <span className="flex items-center gap-2">
              Checked in
              <SessionTimer startedAt={checkedInAt} className="text-[12px] opacity-80" />
            </span>
          ) : (
            <span>Tap to check in</span>
          )}
          <span
            className={`relative w-10 h-6 rounded-full transition-colors ${
              checkedInAt ? "bg-brand-600" : "bg-[var(--border-strong)]"
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                checkedInAt ? "translate-x-[1.125rem]" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {/* ---------------------------------------------- week strip */}
      <DateStrip
        dateKey={dateKey}
        todayKey={todayKey}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        onPick={(d) => go({ date: d })}
      />

      {/* -------------------------------------------- day heading */}
      <div className="flex flex-wrap items-center gap-3 mt-8 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-muted">
            <CalendarIcon />
          </span>
          <h1 className="font-display text-xl font-semibold tracking-tight">
            {longDate(dateKey)}
          </h1>
          <span className="text-muted text-sm hidden sm:inline">
            {WEEKDAYS[weekdayOf(dateKey)]}
          </span>
          {isToday && (
            <span className="rounded-full bg-brand-600 text-white text-[11px] font-semibold px-2 py-0.5">
              Today
            </span>
          )}
        </div>

        <div className="flex-1" />

        <label className="sr-only" htmlFor="counsellor-filter">
          Filter by counsellor
        </label>
        <select
          id="counsellor-filter"
          value={counsellorFilter}
          onChange={(e) => go({ counsellor: e.target.value })}
          className="rounded-full border border-hairline bg-card px-4 py-1.5 text-[13px] cursor-pointer hover:bg-card-muted transition-colors"
        >
          <option value="all">All counsellors</option>
          {counsellors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* -------------------------------------------------- lanes */}
      {lanes.length === 0 ? (
        <Card>
          <EmptyState
            title="No counsellors yet"
            description="Add counsellors from Settings → Team, or invite them to sign in with Google. Their lanes appear here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {lanes.map((lane) => (
            <LaneCard
              key={lane.counsellor.id}
              lane={lane}
              tz={tz}
              viewer={profile}
              pending={pending}
              onStart={setStartTarget}
              onEnd={onEnd}
              onBook={(startsAt) =>
                setQuickBook({ counsellorId: lane.counsellor.id, startsAt })
              }
            />
          ))}
        </div>
      )}

      {totalBooked === 0 && lanes.length > 0 && (
        <p className="text-center text-[13px] text-muted mt-6">
          Nothing booked on this day yet.
        </p>
      )}

      {/* ---------------------------------------------- composer */}
      <TeamComposer
        profile={profile}
        onQuickBook={() => setQuickBook({})}
      />

      {/* ----------------------------------------------- dialogs */}
      <StartSessionDialog
        appointment={startTarget}
        tz={tz}
        onClose={() => setStartTarget(null)}
        onStarted={() => {
          setStartTarget(null);
          router.refresh();
        }}
        onError={setError}
      />

      <QuickBookDialog
        open={quickBook !== null}
        onClose={() => setQuickBook(null)}
        counsellors={counsellors}
        clients={clients}
        defaultCounsellorId={quickBook?.counsellorId}
        defaultStartsAt={quickBook?.startsAt}
        dateKey={dateKey}
        tz={tz}
        currency={profile.currency}
        onBooked={() => {
          setQuickBook(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ date strip */

function DateStrip({
  dateKey,
  todayKey,
  expanded,
  onToggleExpanded,
  onPick,
}: {
  dateKey: string;
  todayKey: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onPick: (dateKey: string) => void;
}) {
  // The selected day sits in the middle of the strip.
  const week = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateKey(dateKey, i - 3)),
    [dateKey],
  );

  const month = useMemo(() => {
    if (!expanded) return [];
    const [y, m] = dateKey.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = first.getUTCDay();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`),
    ];
  }, [expanded, dateKey]);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {week.map((key) => (
          <DayCell
            key={key}
            dateKey={key}
            selected={key === dateKey}
            isToday={key === todayKey}
            onPick={onPick}
          />
        ))}
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-hairline animate-in-up">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} className="text-center text-[11px] text-faint font-medium">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {month.map((key, i) =>
              key === null ? (
                <span key={`pad-${i}`} />
              ) : (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPick(key)}
                  className={`h-9 rounded-lg text-[13px] tabular-nums transition-colors ${
                    key === dateKey
                      ? "bg-brand-600 text-white font-semibold"
                      : key === todayKey
                        ? "bg-brand-50 text-brand-800 font-medium dark:bg-brand-400/12 dark:text-brand-100"
                        : "text-muted hover:bg-card-muted hover:text-body"
                  }`}
                >
                  {Number(key.slice(8))}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      <div className="flex justify-center mt-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="size-7 grid place-items-center rounded-full text-faint hover:text-body hover:bg-card-muted transition-all"
          aria-label={expanded ? "Collapse calendar" : "Expand calendar"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function DayCell({
  dateKey,
  selected,
  isToday,
  onPick,
}: {
  dateKey: string;
  selected: boolean;
  isToday: boolean;
  onPick: (d: string) => void;
}) {
  const day = Number(dateKey.slice(8));
  const weekday = WEEKDAYS[weekdayOf(dateKey)].slice(0, 3);

  return (
    <button
      type="button"
      onClick={() => onPick(dateKey)}
      aria-current={selected ? "date" : undefined}
      className={`flex flex-col items-center py-2 rounded-xl transition-all ${
        selected ? "bg-card border border-hairline shadow-card" : "hover:bg-card-muted"
      }`}
    >
      <span
        className={`text-[11px] ${selected ? "text-muted" : "text-faint"}`}
      >
        {weekday}
      </span>
      <span
        className={`tabular-nums leading-tight ${
          selected
            ? "text-2xl font-semibold font-display"
            : "text-lg text-muted"
        }`}
      >
        {day}
      </span>
      {isToday && (
        <span
          className={`mt-0.5 size-1.5 rounded-full ${
            selected ? "bg-brand-600" : "bg-[var(--border-strong)]"
          }`}
        />
      )}
    </button>
  );
}

/* ------------------------------------------------------------- lane card */

function LaneCard({
  lane,
  tz,
  viewer,
  pending,
  onStart,
  onEnd,
  onBook,
}: {
  lane: ScheduleLane;
  tz: string;
  viewer: Profile;
  pending: boolean;
  onStart: (a: AppointmentRow) => void;
  onEnd: (id: string) => void;
  onBook: (startsAt: string) => void;
}) {
  const { counsellor, appointments, openSlots } = lane;
  const [showAllSlots, setShowAllSlots] = useState(false);

  const booked = appointments.filter((a) => a.status !== "cancelled").length;
  // Only clinicians run timers; the desk can see the diary but not start
  // a session on someone's behalf.
  const viewerIsClinical =
    viewer.role === "counsellor" || viewer.role === "admin" || viewer.is_admin;
  const canRun = viewerIsClinical && (viewer.is_admin || viewer.role === "admin" || viewer.id === counsellor.id);

  const VISIBLE_SLOTS = 4;
  const hiddenSlots = Math.max(0, openSlots.length - VISIBLE_SLOTS);
  const shownSlots = showAllSlots ? openSlots : openSlots.slice(0, VISIBLE_SLOTS);

  // Booked sessions and open gaps read as one timeline, in time order —
  // listing every free slot after every booking makes the day unreadable.
  const rows = [
    ...appointments.map((a) => ({ kind: "appointment" as const, at: a.starts_at, appointment: a })),
    ...shownSlots.map((sl) => ({ kind: "slot" as const, at: sl.startsAt, slot: sl })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-hairline">
        <span className="relative">
          <Avatar name={counsellor.full_name} url={counsellor.avatar_url} size={38} />
          {lane.isOnShift && (
            <span
              className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 border-2 border-[var(--card)]"
              title="Checked in"
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[15px] truncate">{counsellor.full_name}</p>
          <p className="text-[12px] text-muted">
            {booked} booked
            {openSlots.length > 0 && ` · ${openSlots.length} open`}
          </p>
        </div>

        {lane.activeAppointmentId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 text-[12px] font-medium dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25">
            <span className="size-1.5 rounded-full bg-current animate-pulse" />
            Session in progress
          </span>
        )}

        <Link
          href={`/availability?counsellor=${counsellor.id}`}
          aria-label={`Edit ${counsellor.full_name}'s availability`}
          className="size-8 grid place-items-center rounded-full text-faint hover:text-body hover:bg-card-muted transition-colors"
        >
          <PencilIcon />
        </Link>
      </div>

      <div>
        {rows.length === 0 && (
          <p className="px-5 py-6 text-[13px] text-muted text-center">
            Not available on this day.
          </p>
        )}

        {rows.map((row) =>
          row.kind === "appointment" ? (
            <AppointmentLine
              key={row.appointment.id}
              appointment={row.appointment}
              tz={tz}
              canRun={canRun}
              pending={pending}
              onStart={onStart}
              onEnd={onEnd}
            />
          ) : (
            <div
              key={row.slot.startsAt}
              className="flex items-center gap-3 px-4 sm:px-5 py-3 border-t border-hairline first:border-t-0"
            >
              <span className="text-faint shrink-0">
                <ClockIcon />
              </span>
              <span className="text-[13px] tabular-nums text-muted w-[4.5rem] shrink-0">
                {timeLabel(row.slot.startsAt, tz)}
              </span>
              <span className="text-[13px] text-faint flex-1 truncate">Available</span>
              <Button size="sm" variant="secondary" onClick={() => onBook(row.slot.startsAt)}>
                <PlusIcon />
                Book
              </Button>
            </div>
          ),
        )}

        {hiddenSlots > 0 && (
          <button
            type="button"
            onClick={() => setShowAllSlots((v) => !v)}
            className="w-full px-5 py-2.5 border-t border-hairline text-[13px] text-muted hover:text-body hover:bg-card-muted transition-colors"
          >
            {showAllSlots
              ? "Show fewer slots"
              : `Show ${hiddenSlots} more open slot${hiddenSlots === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </Card>
  );
}

function AppointmentLine({
  appointment,
  tz,
  canRun,
  pending,
  onStart,
  onEnd,
}: {
  appointment: AppointmentRow;
  tz: string;
  canRun: boolean;
  pending: boolean;
  onStart: (a: AppointmentRow) => void;
  onEnd: (id: string) => void;
}) {
  const running = appointment.time_entries.find((e) => e.ended_at === null);
  const cancelled = appointment.status === "cancelled";
  const completed = appointment.status === "completed";

  return (
    <div
      className={`flex items-center gap-3 px-4 sm:px-5 py-3 border-t border-hairline first:border-t-0 transition-colors ${
        running ? "bg-emerald-50/40 dark:bg-emerald-500/5" : ""
      } ${cancelled ? "opacity-55" : ""}`}
    >
      <span className="text-faint shrink-0">
        <ClockIcon />
      </span>

      <span className="text-[13px] tabular-nums text-muted w-[4.5rem] shrink-0">
        {timeLabel(appointment.starts_at, tz)}
      </span>

      <Link
        href={`/appointments/${appointment.id}`}
        className={`text-[14px] font-medium flex-1 truncate hover:underline underline-offset-2 ${
          cancelled ? "line-through" : ""
        }`}
      >
        {appointment.client?.full_name ?? "Unknown client"}
      </Link>

      {appointment.client && (
        <span className="hidden sm:inline shrink-0">
          <AgeSelect
            clientId={appointment.client.id}
            age={appointment.client.age}
            disabled={cancelled}
          />
        </span>
      )}

      {running ? (
        <span className="flex items-center gap-3 shrink-0">
          <span className="text-right">
            <SessionTimer
              startedAt={running.started_at}
              className="block text-[15px] text-emerald-700 dark:text-emerald-300"
            />
            <span className="block text-[11px] text-faint">
              Since {timeLabel(running.started_at, tz)}
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRun || pending}
            onClick={() => onEnd(appointment.id)}
          >
            <StopIcon />
            End
          </Button>
        </span>
      ) : completed ? (
        <span className="text-[12px] text-muted shrink-0 tabular-nums">
          {totalMinutes(appointment)} min
        </span>
      ) : cancelled ? (
        <span className="text-[12px] text-muted shrink-0">Cancelled</span>
      ) : (
        <Button
          size="sm"
          disabled={!canRun || pending}
          title={canRun ? undefined : "Only the assigned counsellor can start this session"}
          onClick={() => onStart(appointment)}
          className="shrink-0"
        >
          <PlayIcon />
          Start
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------- start session dialog */

function StartSessionDialog({
  appointment,
  tz,
  onClose,
  onStarted,
  onError,
}: {
  appointment: AppointmentRow | null;
  tz: string;
  onClose: () => void;
  onStarted: () => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!appointment) return;
    startTransition(async () => {
      const result = await startSession(appointment.id);
      if (!result.ok) {
        onError(result.error);
        onClose();
      } else {
        onStarted();
      }
    });
  }

  return (
    <Dialog
      open={appointment !== null}
      onClose={onClose}
      title="Start this session?"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={confirm} disabled={pending}>
            <PlayIcon />
            {pending ? "Starting…" : "Start timer"}
          </Button>
        </>
      }
    >
      {appointment && (
        <>
          <div className="text-center pb-5 border-b border-hairline">
            <p className="font-display text-xl font-semibold">
              {appointment.client?.full_name}
            </p>
            <p className="text-[13px] text-muted mt-1">
              with {appointment.counsellor?.full_name} ·{" "}
              {timeLabel(appointment.starts_at, tz)}
            </p>
          </div>

          <div className="flex items-center justify-between py-4 border-b border-hairline">
            <span className="text-[13px] text-muted">Base session fee</span>
            <span className="font-semibold tabular-nums">
              {formatMoney(appointment.price_cents, appointment.currency)}
            </span>
          </div>

          <p className="text-[13px] text-muted leading-relaxed pt-4">
            This starts the billed timer right away. Double-check this is the
            right client and slot before continuing.
          </p>
        </>
      )}
    </Dialog>
  );
}

/* ----------------------------------------------------------------- utils */

function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function totalMinutes(appointment: AppointmentRow): number {
  return appointment.time_entries.reduce(
    (sum, e) => sum + (e.duration_minutes ?? 0),
    0,
  );
}

/* ----------------------------------------------------------------- icons */

const sw = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ClockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...sw}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...sw}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
const PencilIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...sw}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
  </svg>
);
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...sw} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const PlayIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 4.5v15l13-7.5-13-7.5Z" />
  </svg>
);
const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);
const PinIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...sw}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);
