import { dateKeyInTimeZone } from "../time";

/**
 * When a session may be started.
 *
 * Two rules, both enforced on the server and mirrored in the UI so the
 * button and the action can never disagree:
 *
 *   1. The assigned counsellor must be CHECKED IN for the day. Attendance
 *      is what says someone is actually at work; a session timer running
 *      while nobody is on shift makes both records meaningless.
 *
 *   2. Only TODAY's sessions can be started — not tomorrow's, not
 *      yesterday's. Starting a future session would bill time against a
 *      slot that has not happened, and back-starting a past one lets a
 *      missed session be quietly reclassified as delivered. A genuinely
 *      untracked past session is what manual time entry is for.
 *
 * "Today" is resolved in the COUNSELLOR's timezone, not the server's or
 * the viewer's: an evening session in Chennai must not become
 * unstartable because the server thinks it is already tomorrow.
 */
export type StartCheck = { ok: true } | { ok: false; reason: string };

export function canStartSession(input: {
  status: string;
  startsAt: string;
  counsellorTimezone: string;
  counsellorOnShift: boolean;
  /** The counsellor's own name, for a message about someone else. */
  counsellorName?: string;
  startedBySelf?: boolean;
  now?: Date;
}): StartCheck {
  const now = input.now ?? new Date();
  const tz = input.counsellorTimezone || "Asia/Kolkata";

  if (input.status === "completed") {
    return { ok: false, reason: "This session is already completed." };
  }
  if (input.status === "cancelled") {
    return { ok: false, reason: "This session was cancelled." };
  }
  if (input.status === "in_progress") {
    return { ok: false, reason: "This session is already running." };
  }

  // Date before attendance: on a future booking, being told to check in
  // would be the wrong advice.
  const sessionDay = dateKeyInTimeZone(new Date(input.startsAt), tz);
  const today = dateKeyInTimeZone(now, tz);

  if (sessionDay > today) {
    return {
      ok: false,
      reason: `This session is on ${sessionDay}. Only today's sessions can be started.`,
    };
  }
  if (sessionDay < today) {
    return {
      ok: false,
      reason: `This session was on ${sessionDay}. Past sessions cannot be started — log the time manually instead.`,
    };
  }

  if (!input.counsellorOnShift) {
    return {
      ok: false,
      reason: input.startedBySelf === false && input.counsellorName
        ? `${input.counsellorName} has not checked in yet.`
        : "Check in for the day before starting a session.",
    };
  }

  return { ok: true };
}
