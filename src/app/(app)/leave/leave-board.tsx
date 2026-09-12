"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Stat,
  fieldClass,
} from "@/components/ui";
import {
  addHoliday,
  addWeekOff,
  approveLeave,
  logLeave,
  removeHoliday,
  removeLeave,
  removeWeekOff,
} from "@/lib/actions/leave";
import type { MonthWeek } from "@/lib/business/weekoff";
import type {
  CounsellorSummary,
  Holiday,
  Leave,
  LeaveKind,
  Profile,
  WeekOff,
} from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LEAVE_LABEL: Record<LeaveKind, string> = {
  planned: "Planned",
  sick: "Sick",
  unpaid: "Unpaid",
  auto: "Auto-marked",
};

/**
 * The month at a glance. The row bands down the left are the real
 * week-off "weeks" — Saturday-bounded, with short stubs merged — so the
 * quota on screen is the same number the server enforces.
 */
export function LeaveBoard({
  profile,
  isAdmin,
  staff,
  staffId,
  monthKey,
  year,
  month,
  weeks,
  quota,
  weekOffs,
  leaves,
  holidays,
}: {
  profile: Profile;
  isAdmin: boolean;
  staff: CounsellorSummary[];
  staffId: string;
  monthKey: string;
  year: number;
  month: number;
  weeks: MonthWeek[];
  quota: number;
  weekOffs: WeekOff[];
  leaves: Leave[];
  holidays: Holiday[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [leaveKind, setLeaveKind] = useState<LeaveKind>("planned");
  const [leaveReason, setLeaveReason] = useState("");
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holidayName, setHolidayName] = useState("");

  const viewingSelf = staffId === profile.id;

  const weekOffByDate = new Map(weekOffs.map((w) => [w.on_date, w]));
  const leaveByDate = new Map(leaves.map((l) => [l.on_date, l]));
  const holidayByDate = new Map(holidays.map((h) => [h.on_date, h]));

  const remaining = Math.max(0, quota - weekOffs.length);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        if (ok) setNotice(ok);
        setDayOpen(null);
        setHolidayOpen(false);
        setLeaveReason("");
        setHolidayName("");
        router.refresh();
      }
    });
  }

  function go(next: { month?: string; staff?: string }) {
    const search = new URLSearchParams();
    search.set("month", next.month ?? monthKey);
    const s = next.staff ?? staffId;
    if (isAdmin && s !== profile.id) search.set("staff", s);
    router.push(`/leave?${search}`);
  }

  function shiftMonth(by: number) {
    const d = new Date(Date.UTC(year, month - 1 + by, 1));
    go({
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    });
  }

  const dateKey = (day: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const selected = dayOpen;
  const selectedWeekOff = selected ? weekOffByDate.get(selected) : undefined;
  const selectedLeave = selected ? leaveByDate.get(selected) : undefined;
  const selectedHoliday = selected ? holidayByDate.get(selected) : undefined;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Week-offs &amp; Leave
          </h1>
          <p className="text-[13px] text-muted mt-0.5">
            The monthly week-off allowance is computed from the shape of the
            month, not a fixed number — some months give {quota === 4 ? "four" : "five"}.
          </p>
        </div>

        {isAdmin && (
          <Button variant="secondary" size="sm" onClick={() => setHolidayOpen(true)}>
            Add holiday
          </Button>
        )}
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}

      {/* ------------------------------------------------------ controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="size-9 grid place-items-center rounded-full border border-hairline hover:bg-card-muted transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span className="font-display text-lg font-semibold tabular-nums px-2 min-w-44 text-center">
            {new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="size-9 grid place-items-center rounded-full border border-hairline hover:bg-card-muted transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>

        {isAdmin && staff.length > 0 && (
          <select
            value={staffId}
            onChange={(e) => go({ staff: e.target.value })}
            aria-label="Whose calendar"
            className={`${fieldClass} w-auto`}
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === profile.id ? `${s.full_name} (you)` : s.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Allowance" value={String(quota)} sub={`${weeks.length} weeks this month`} />
        <Stat label="Week-offs taken" value={String(weekOffs.length)} sub={`${remaining} left`} />
        <Stat label="Leave logged" value={String(leaves.length)} sub={`${holidays.length} clinic holiday${holidays.length === 1 ? "" : "s"}`} />
      </div>

      {/* ------------------------------------------------------ calendar */}
      <Card className="overflow-hidden">
        <CardHeader
          title={viewingSelf ? "Your month" : (staff.find((s) => s.id === staffId)?.full_name ?? "Calendar")}
          description="Each band is one week-off week. Tap a day to mark it."
        />

        <div className="p-4 overflow-x-auto">
          <div className="min-w-[34rem]">
            <div className="grid grid-cols-[3.5rem_1fr] gap-1 mb-1">
              <span />
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((d) => (
                  <span key={d} className="text-center text-[11px] uppercase tracking-[0.08em] text-faint font-medium py-1">
                    {d}
                  </span>
                ))}
              </div>
            </div>

            {weeks.map((week, i) => (
              <WeekRow
                key={week.startDay}
                index={i}
                week={week}
                year={year}
                month={month}
                dateKey={dateKey}
                weekOffByDate={weekOffByDate}
                leaveByDate={leaveByDate}
                holidayByDate={holidayByDate}
                onPick={(d) => {
                  setError(null);
                  setNotice(null);
                  setLeaveKind("planned");
                  setDayOpen(d);
                }}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------------- lists */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader title="Leave this month" />
          {leaves.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-muted text-center">Nothing logged.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {leaves.map((l) => (
                <li key={l.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      {l.on_date} · {LEAVE_LABEL[l.kind]}
                      {!l.approved_at && (
                        <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-300">
                          awaiting approval
                        </span>
                      )}
                    </p>
                    {l.reason && <p className="text-[12px] text-muted mt-0.5">{l.reason}</p>}
                  </div>
                  {isAdmin && !l.approved_at && (
                    <Button size="sm" variant="secondary" disabled={pending}
                      onClick={() => run(() => approveLeave(l.id), "Leave approved.")}>
                      Approve
                    </Button>
                  )}
                  <button type="button" disabled={pending}
                    onClick={() => run(() => removeLeave(l.id), "Leave removed.")}
                    className="text-[12px] text-faint hover:text-red-600 transition-colors">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Clinic holidays" description="Org-wide closures, set by an admin." />
          {holidays.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-muted text-center">None this month.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {holidays.map((h) => (
                <li key={h.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{h.name}</p>
                    <p className="text-[12px] text-muted mt-0.5">{h.on_date}</p>
                  </div>
                  {isAdmin && (
                    <button type="button" disabled={pending}
                      onClick={() => run(() => removeHoliday(h.id), "Holiday removed.")}
                      className="text-[12px] text-faint hover:text-red-600 transition-colors">
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* -------------------------------------------------------- dialogs */}
      <Dialog
        open={selected !== null}
        onClose={() => setDayOpen(null)}
        title={selected ? `${selected}` : ""}
        footer={
          <Button variant="secondary" className="flex-1" onClick={() => setDayOpen(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <div className="space-y-4">
            {selectedHoliday && (
              <Alert tone="info">
                The clinic is closed: {selectedHoliday.name}.
              </Alert>
            )}

            {selectedWeekOff ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-card-muted px-4 py-3">
                <span className="text-[13px]">Marked as a week-off.</span>
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => run(() => removeWeekOff(selectedWeekOff.id), "Week-off removed.")}>
                  Remove
                </Button>
              </div>
            ) : (
              <Button className="w-full" disabled={pending || remaining === 0}
                onClick={() => run(() => addWeekOff({ onDate: selected, staffId }), "Week-off booked.")}>
                {remaining === 0
                  ? "No week-offs left this month"
                  : `Take a week-off (${remaining} left)`}
              </Button>
            )}

            {selectedLeave ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-card-muted px-4 py-3">
                <span className="text-[13px]">
                  Leave logged: {LEAVE_LABEL[selectedLeave.kind]}
                </span>
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => run(() => removeLeave(selectedLeave.id), "Leave removed.")}>
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-hairline p-4">
                <Field label="Log as leave instead">
                  <select value={leaveKind} onChange={(e) => setLeaveKind(e.target.value as LeaveKind)} className={fieldClass}>
                    <option value="planned">Planned</option>
                    <option value="sick">Sick</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </Field>
                <input value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Reason (optional)" className={fieldClass} />
                <Button variant="secondary" size="sm" disabled={pending}
                  onClick={() => run(
                    () => logLeave({ onDate: selected, kind: leaveKind, reason: leaveReason, staffId }),
                    "Leave logged.",
                  )}>
                  Log leave
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={holidayOpen}
        onClose={() => setHolidayOpen(false)}
        title="Add a clinic holiday"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setHolidayOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={pending || !holidayName.trim() || !dayOpen}
              onClick={() => dayOpen && run(() => addHoliday(dayOpen, holidayName), "Holiday added.")}>
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Date" required>
            <input type="date" value={dayOpen ?? ""} onChange={(e) => setDayOpen(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Name" required>
            <input value={holidayName} onChange={(e) => setHolidayName(e.target.value)}
              placeholder="Diwali" className={fieldClass} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

/* --------------------------------------------------------------- a row */

function WeekRow({
  index,
  week,
  year,
  month,
  dateKey,
  weekOffByDate,
  leaveByDate,
  holidayByDate,
  onPick,
}: {
  index: number;
  week: MonthWeek;
  year: number;
  month: number;
  dateKey: (d: number) => string;
  weekOffByDate: Map<string, WeekOff>;
  leaveByDate: Map<string, Leave>;
  holidayByDate: Map<string, Holiday>;
  onPick: (dateKey: string) => void;
}) {
  // A merged row can be longer than seven days — August 2026's closing
  // row is nine. Lay the days out from the weekday its first day falls
  // on and let the row wrap onto a second line, so every day of the
  // month stays reachable. Packing them into exactly seven columns would
  // silently drop the overflow.
  const leadingBlanks = new Date(
    Date.UTC(year, month - 1, week.startDay),
  ).getUTCDay();

  const days = Array.from(
    { length: week.days },
    (_, i) => week.startDay + i,
  );

  const hasWeekOff = days.some((d) => weekOffByDate.has(dateKey(d)));

  return (
    <div className="grid grid-cols-[3.5rem_1fr] gap-1 mb-1">
      <div
        className={`rounded-lg grid place-items-center text-[11px] font-medium ${
          hasWeekOff
            ? "bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200"
            : "bg-card-muted text-faint"
        }`}
        title={`Week ${index + 1}: ${week.days} days`}
      >
        W{index + 1}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} className="h-16 rounded-lg bg-card-muted/40" />
        ))}

        {days.map((day) => {
          const key = dateKey(day);
          const weekOff = weekOffByDate.get(key);
          const leave = leaveByDate.get(key);
          const holiday = holidayByDate.get(key);

          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(key)}
              className={`h-16 rounded-lg border p-1.5 text-left transition-colors ${
                weekOff
                  ? "border-brand-300 bg-brand-50 dark:border-brand-400/30 dark:bg-brand-400/10"
                  : leave
                    ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                    : holiday
                      ? "border-violet-300 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10"
                      : "border-hairline hover:bg-card-muted"
              }`}
            >
              <span className="block text-[12px] font-medium tabular-nums">{day}</span>
              {weekOff && <span className="block text-[10px] text-brand-700 dark:text-brand-300 mt-0.5">Week-off</span>}
              {!weekOff && leave && <span className="block text-[10px] text-amber-700 dark:text-amber-300 mt-0.5">{LEAVE_LABEL[leave.kind]}</span>}
              {!weekOff && !leave && holiday && <span className="block text-[10px] text-violet-700 dark:text-violet-300 mt-0.5 truncate">{holiday.name}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
