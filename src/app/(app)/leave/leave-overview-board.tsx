"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, EmptyState, Pill, Stat } from "@/components/ui";
import { approveLeave, removeLeave, removeHoliday } from "@/lib/actions/leave";
import {
  formatMinutes,
  offBetween,
  offOn,
  type LeaveOverview,
} from "@/lib/business/leave-overview";
import { addDaysToDateKey, WEEKDAYS } from "@/lib/time";
import type { Holiday, Leave, LeaveKind } from "@/lib/types";

const LEAVE_LABEL: Record<LeaveKind, string> = {
  planned: "Planned",
  sick: "Sick",
  unpaid: "Unpaid",
  auto: "Auto-marked",
};

/**
 * Everyone's month at once.
 *
 * The question an admin opens this screen with is "who have I got
 * tomorrow", and the old one could only answer "here is one person's
 * calendar, pick another from the dropdown". This leads with the
 * numbers that change a decision — how many people are away today and
 * over the coming week, and how many working hours that removes — then
 * the day-by-day detail underneath.
 */
export function LeaveOverviewBoard({
  overview,
  leaves,
  holidays,
  todayKey,
  monthKey,
  onPickPerson,
}: {
  overview: LeaveOverview;
  leaves: Leave[];
  holidays: Holiday[];
  todayKey: string;
  monthKey: string;
  onPickPerson: (staffId: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else {
        if (ok) setNotice(ok);
        router.refresh();
      }
    });
  }

  const today = offOn(overview, todayKey);
  const week = offBetween(overview, todayKey, addDaysToDateKey(todayKey, 6));
  const weekPeople = new Set(week.flatMap((d) => d.people.map((p) => p.staffId)));
  const weekMinutes = week.reduce((sum, d) => sum + d.minutesLost, 0);

  const { totals } = overview;
  const availableToday = totals.staffCount - (today?.people.length ?? 0);

  // Only days with something on them — a month of empty rows is noise.
  const busyDays = overview.days.filter(
    (d) => d.people.length > 0 || d.holiday,
  );

  /*
   * Whether "today" is inside the month being viewed. Looking at
   * October in September, "off today" is not a question this data can
   * answer, and showing a confident zero would be a lie.
   */
  const showsToday = todayKey.startsWith(monthKey);

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {/* ------------------------------------------------ the headline */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label={showsToday ? "Available today" : "On the team"}
          value={showsToday ? `${availableToday}/${totals.staffCount}` : String(totals.staffCount)}
          sub={
            showsToday
              ? today?.holiday
                ? `Clinic closed — ${today.holiday}`
                : `${today?.people.length ?? 0} away`
              : "Active staff"
          }
        />
        <Stat
          label="Away in the next 7 days"
          value={String(weekPeople.size)}
          sub={weekMinutes > 0 ? `${formatMinutes(weekMinutes)} of cover lost` : "Fully covered"}
        />
        <Stat
          label="Hours lost this month"
          value={formatMinutes(totals.minutesLost)}
          sub={`${totals.absenceDays} day${totals.absenceDays === 1 ? "" : "s"} away`}
        />
        <Stat
          label="Awaiting approval"
          value={String(totals.pendingLeave)}
          sub={
            totals.holidayDays > 0
              ? `${totals.holidayDays} clinic holiday${totals.holidayDays === 1 ? "" : "s"}`
              : "No clinic holidays"
          }
        />
      </div>

      {showsToday && today && today.people.length > 0 && (
        <Alert tone="info">
          <span className="font-medium">Away today: </span>
          {today.people
            .map((p) => `${p.name} (${p.reason === "week-off" ? "week-off" : LEAVE_LABEL[p.kind ?? "planned"].toLowerCase()})`)
            .join(", ")}
        </Alert>
      )}

      {/* ------------------------------------------------- per person */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Everyone this month"
          description="Week-offs are against a monthly allowance; leave is not."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-[0.08em] text-faint">
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Week-offs</th>
                <th className="px-3 py-2.5 font-medium">Leave</th>
                <th className="px-3 py-2.5 font-medium">Hours lost</th>
                <th className="px-3 py-2.5 font-medium">Normal week</th>
                <th className="px-5 py-2.5 font-medium text-right">Calendar</th>
              </tr>
            </thead>
            <tbody>
              {overview.people.map((p) => (
                <tr key={p.staffId} className="border-b border-hairline last:border-0 hover:bg-card-muted transition-colors">
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-3 py-3 text-muted tabular-nums">
                    {p.weekOffsTaken} of {p.quota}
                    {p.remaining === 0 && (
                      <span className="ml-2 text-[11px] text-blush-700 dark:text-blush-300">
                        · allowance spent
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted tabular-nums">
                    {/* "1" beside "1 to approve" reads as "11" — the
                        separator is doing real work here. */}
                    {p.leaveDays === 0 ? "—" : `${p.leaveDays} day${p.leaveDays === 1 ? "" : "s"}`}
                    {p.pendingLeave > 0 && (
                      <span className="ml-2 text-[11px] text-blush-700 dark:text-blush-300">
                        · {p.pendingLeave} to approve
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted tabular-nums">
                    {formatMinutes(p.minutesLost)}
                  </td>
                  <td className="px-3 py-3 text-faint tabular-nums">
                    {formatMinutes(p.weeklyMinutes)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onPickPerson(p.staffId)}
                      className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------------------------------------------- by day */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Day by day"
          description="Only days with somebody away, or the clinic closed."
        />
        {busyDays.length === 0 ? (
          <EmptyState
            title="Nobody is away this month"
            description="Week-offs, leave and clinic holidays all show up here."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {busyDays.map((day) => {
              const past = day.dateKey < todayKey;
              return (
                <li
                  key={day.dateKey}
                  className={`px-5 py-3 flex flex-wrap items-center gap-3 ${past ? "opacity-55" : ""}`}
                >
                  <div className="w-32 shrink-0">
                    <p className="text-[13px] font-medium tabular-nums">
                      {day.dateKey === todayKey ? "Today" : day.dateKey.slice(8)}
                      <span className="text-muted font-normal">
                        {" "}
                        {WEEKDAYS[new Date(`${day.dateKey}T00:00:00Z`).getUTCDay()].slice(0, 3)}
                      </span>
                    </p>
                  </div>

                  <div className="min-w-0 flex-1 flex flex-wrap gap-1.5">
                    {day.holiday && <Pill>Closed — {day.holiday}</Pill>}
                    {day.people.map((p) => (
                      <span
                        key={`${day.dateKey}-${p.staffId}`}
                        title={p.approved ? undefined : "Awaiting approval"}
                        className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                          p.reason === "week-off"
                            ? "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-400/25 dark:bg-brand-400/10 dark:text-brand-200"
                            : "border-blush-200 bg-blush-50 text-blush-800 dark:border-blush-500/25 dark:bg-blush-500/10 dark:text-blush-300"
                        }`}
                      >
                        {p.name}
                        <span className="opacity-70">
                          {" · "}
                          {p.reason === "week-off" ? "week-off" : LEAVE_LABEL[p.kind ?? "planned"]}
                        </span>
                        {!p.approved && <span className="opacity-70"> · pending</span>}
                      </span>
                    ))}
                  </div>

                  <span className="text-[12px] text-faint tabular-nums shrink-0">
                    {formatMinutes(day.minutesLost)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* --------------------------------------------- approvals + holidays */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Leave this month"
            description="Everyone's, not just yours."
          />
          {leaves.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-muted text-center">Nothing logged.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {leaves.map((l) => {
                const who = overview.people.find((p) => p.staffId === l.staff_id);
                return (
                  <li key={l.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">
                        {who?.name ?? "Unknown"} · {l.on_date} · {LEAVE_LABEL[l.kind]}
                        {!l.approved_at && (
                          <span className="ml-2 text-[11px] text-blush-700 dark:text-blush-300">
                            awaiting approval
                          </span>
                        )}
                      </p>
                      {l.reason && <p className="text-[12px] text-muted mt-0.5">{l.reason}</p>}
                    </div>
                    {!l.approved_at && (
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
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Clinic holidays" description="Org-wide closures." />
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
                  <button type="button" disabled={pending}
                    onClick={() => run(() => removeHoliday(h.id), "Holiday removed.")}
                    className="text-[12px] text-faint hover:text-red-600 transition-colors">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
