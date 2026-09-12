import { formatDateTime, formatDuration } from "../format";
import {
  confirmationDate,
  confirmationPlain,
  confirmationTemplateVariables,
  confirmationWhatsApp,
  greetingName,
} from "./message-templates";

export type ReminderParty = "counsellor" | "client";

type ReminderInput = {
  recipientName: string;
  otherPartyName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  durationMinutes: number;
  title: string;
  meetingUrl?: string | null;
  location?: string | null;
  appUrl: string;
  appointmentId: string;
  party: ReminderParty;
};

const BRAND = "#2f6f6b";

export function reminderSubject(i: ReminderInput): string {
  const who = i.party === "counsellor" ? i.otherPartyName : `with ${i.otherPartyName}`;
  return `Reminder: session ${i.party === "counsellor" ? `with ${who}` : who} in 3 days`;
}

export function reminderText(i: ReminderInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);
  const lines = [
    `Hi ${i.recipientName || "there"},`,
    ``,
    `This is a reminder that your session is coming up in 3 days.`,
    ``,
    `${i.title}`,
    `When: ${when} (${i.timezone})`,
    `Duration: ${formatDuration(i.durationMinutes)}`,
    i.party === "counsellor"
      ? `Client: ${i.otherPartyName}`
      : `Counsellor: ${i.otherPartyName}`,
  ];

  if (i.meetingUrl) lines.push(`Join: ${i.meetingUrl}`);
  if (i.location) lines.push(`Location: ${i.location}`);

  lines.push(
    ``,
    `View or reschedule: ${i.appUrl}/appointments/${i.appointmentId}`,
    ``,
    `— Nurora`,
  );

  return lines.join("\n");
}

export function reminderHtml(i: ReminderInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);
  const partyRow =
    i.party === "counsellor"
      ? row("Client", i.otherPartyName)
      : row("Counsellor", i.otherPartyName);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b201f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f0;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e1d8;">
          <tr>
            <td style="padding:24px 28px;background:${BRAND};color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.75;">Nurora</div>
              <div style="font-size:21px;font-weight:600;margin-top:6px;">Your session is in 3 days</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(i.recipientName || "there")}, this is a friendly reminder about your upcoming session.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ece7de;border-radius:12px;padding:4px 16px;background:#fbfaf7;">
                ${row("Session", escapeHtml(i.title))}
                ${row("When", `${escapeHtml(when)}<br><span style="color:#6b7573;font-size:13px;">${escapeHtml(i.timezone)}</span>`)}
                ${row("Duration", formatDuration(i.durationMinutes))}
                ${partyRow}
                ${i.location ? row("Location", escapeHtml(i.location)) : ""}
              </table>
              ${
                i.meetingUrl
                  ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(i.meetingUrl)}" style="color:${BRAND};font-weight:600;">Join the session &rarr;</a></p>`
                  : ""
              }
              <p style="margin:26px 0 0;">
                <a href="${i.appUrl}/appointments/${i.appointmentId}"
                   style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">
                  View appointment
                </a>
              </p>
              <p style="margin:22px 0 0;font-size:13px;color:#6b7573;line-height:1.6;">
                Need to change the time? Open the appointment to reschedule or cancel.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:#fbfaf7;border-top:1px solid #ece7de;font-size:12px;color:#8a918f;">
              Sent by Nurora · you receive these because you have an upcoming appointment.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function reminderSms(i: ReminderInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);
  const other =
    i.party === "counsellor"
      ? `client ${i.otherPartyName}`
      : `${i.otherPartyName}`;
  return `Nurora reminder: your session with ${other} is in 3 days — ${when} (${i.timezone}). Details: ${i.appUrl}/appointments/${i.appointmentId}`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;font-size:13px;color:#6b7573;width:96px;vertical-align:top;">${label}</td>
    <td style="padding:10px 0;font-size:14px;font-weight:500;">${value}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type { ReminderInput };

/* ===================================================================
 * Transactional appointment messages
 *
 * These go out the moment the desk books, moves or cancels a session —
 * unlike the 3-day reminder above, which is swept by cron. WhatsApp is
 * the primary channel for clients (that is how this practice already
 * talks to them); email and SMS ride along where available.
 * =================================================================== */

export type AppointmentEvent = "booked" | "rescheduled" | "cancelled";

export type AppointmentEventInput = {
  event: AppointmentEvent;
  recipientName: string;
  otherPartyName: string;
  startsAt: string;
  timezone: string;
  durationMinutes: number;
  title: string;
  meetingUrl?: string | null;
  location?: string | null;
  /** Only meaningful for a cancellation. */
  reason?: string | null;
  appUrl: string;
  appointmentId: string;
  party: ReminderParty;
  practiceName: string;
};

const EVENT_HEADLINE: Record<AppointmentEvent, string> = {
  booked: "Appointment confirmed",
  rescheduled: "Appointment moved",
  cancelled: "Appointment cancelled",
};

export function appointmentEventSubject(i: AppointmentEventInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);
  if (i.event === "cancelled") {
    return `Cancelled: your ${i.practiceName} session on ${when}`;
  }
  if (i.event === "rescheduled") {
    return `Moved: your ${i.practiceName} session is now ${when}`;
  }
  return `Confirmed: your ${i.practiceName} session on ${when}`;
}

/**
 * The WhatsApp / SMS body. Kept under ~600 characters and free of
 * markup — WhatsApp renders plain text, and SMS is billed per segment.
 */
export function appointmentEventSms(i: AppointmentEventInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);

  // A new booking uses the practice's approved confirmation copy rather
  // than wording invented here. Only the client gets it — a counsellor
  // does not need to be told to arrive ten minutes early.
  if (i.event === "booked" && i.party === "client") {
    return confirmationWhatsApp({
      name: greetingName(i.recipientName),
      date: confirmationDate(i.startsAt, i.timezone),
    });
  }

  const withWhom =
    i.party === "counsellor" ? `${i.otherPartyName}` : `${i.otherPartyName}`;

  if (i.event === "cancelled") {
    const because = i.reason ? ` Reason: ${i.reason}.` : "";
    return (
      `${i.practiceName}: your session with ${withWhom} on ${when} (${i.timezone}) ` +
      `has been cancelled.${because} To rebook, just reply to this message.`
    );
  }

  const lead =
    i.event === "rescheduled"
      ? `${i.practiceName}: your session with ${withWhom} has been moved to ${when}`
      : `${i.practiceName}: your session with ${withWhom} is confirmed for ${when}`;

  const lines = [`${lead} (${i.timezone}), ${formatDuration(i.durationMinutes)}.`];

  if (i.meetingUrl) lines.push(`Join: ${i.meetingUrl}`);
  else if (i.location) lines.push(`Where: ${i.location}`);

  lines.push(`Details: ${i.appUrl}/appointments/${i.appointmentId}`);

  return lines.join("\n");
}

/**
 * Positional variables for an approved WhatsApp template. The template
 * body registered with Meta is expected to read, in order:
 *   {{1}} recipient name  {{2}} other party  {{3}} date & time
 *   {{4}} duration        {{5}} where/join   {{6}} practice name
 */
export function appointmentEventTemplateVariables(
  i: AppointmentEventInput,
): Record<string, string> {
  // The approved confirmation template takes two variables, so a
  // booking must not be sent the six-variable mapping below.
  if (i.event === "booked" && i.party === "client") {
    return confirmationTemplateVariables({
      name: greetingName(i.recipientName),
      date: confirmationDate(i.startsAt, i.timezone),
    });
  }

  return {
    "1": i.recipientName || "there",
    "2": i.otherPartyName,
    "3": `${formatDateTime(i.startsAt, i.timezone)} (${i.timezone})`,
    "4": formatDuration(i.durationMinutes),
    "5": i.meetingUrl || i.location || "at the clinic",
    "6": i.practiceName,
  };
}

export function appointmentEventText(i: AppointmentEventInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);

  if (i.event === "booked" && i.party === "client") {
    return `${confirmationPlain({
      name: greetingName(i.recipientName),
      date: confirmationDate(i.startsAt, i.timezone),
    })}

View the appointment: ${i.appUrl}/appointments/${i.appointmentId}`;
  }

  const lines = [
    `Hi ${i.recipientName || "there"},`,
    ``,
    i.event === "cancelled"
      ? `Your session below has been cancelled.`
      : i.event === "rescheduled"
        ? `Your session has been moved. The new time is below.`
        : `Your session is confirmed. Here are the details.`,
    ``,
    i.title,
    `When: ${when} (${i.timezone})`,
    `Duration: ${formatDuration(i.durationMinutes)}`,
    i.party === "counsellor"
      ? `Client: ${i.otherPartyName}`
      : `Counsellor: ${i.otherPartyName}`,
  ];

  if (i.event === "cancelled" && i.reason) lines.push(`Reason: ${i.reason}`);
  if (i.event !== "cancelled" && i.meetingUrl) lines.push(`Join: ${i.meetingUrl}`);
  if (i.event !== "cancelled" && i.location) lines.push(`Location: ${i.location}`);

  lines.push(
    ``,
    `View the appointment: ${i.appUrl}/appointments/${i.appointmentId}`,
    ``,
    `— ${i.practiceName}`,
  );

  return lines.join("\n");
}

export function appointmentEventHtml(i: AppointmentEventInput): string {
  const when = formatDateTime(i.startsAt, i.timezone);
  const cancelled = i.event === "cancelled";
  const accent = cancelled ? "#a33a32" : BRAND;

  const partyRow =
    i.party === "counsellor"
      ? row("Client", escapeHtml(i.otherPartyName))
      : row("Counsellor", escapeHtml(i.otherPartyName));

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b201f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f0;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e1d8;">
          <tr>
            <td style="padding:24px 28px;background:${accent};color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.75;">${escapeHtml(i.practiceName)}</div>
              <div style="font-size:21px;font-weight:600;margin-top:6px;">${EVENT_HEADLINE[i.event]}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(greetingName(i.recipientName || "there"))},
                ${
                  cancelled
                    ? "the session below has been cancelled."
                    : i.event === "rescheduled"
                      ? "your session has been moved — the new time is below."
                      : "your session is confirmed."
                }
              </p>
              ${
                i.event === "booked" && i.party === "client"
                  ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
                       Please arrive at the clinic at least <strong>10 minutes</strong>
                       before your scheduled time.
                     </p>`
                  : ""
              }
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ece7de;border-radius:12px;padding:4px 16px;background:#fbfaf7;">
                ${row("Session", escapeHtml(i.title))}
                ${row("When", `${escapeHtml(when)}<br><span style="color:#6b7573;font-size:13px;">${escapeHtml(i.timezone)}</span>`)}
                ${row("Duration", formatDuration(i.durationMinutes))}
                ${partyRow}
                ${!cancelled && i.location ? row("Location", escapeHtml(i.location)) : ""}
                ${cancelled && i.reason ? row("Reason", escapeHtml(i.reason)) : ""}
              </table>
              ${
                !cancelled && i.meetingUrl
                  ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(i.meetingUrl)}" style="color:${BRAND};font-weight:600;">Join the session &rarr;</a></p>`
                  : ""
              }
              <p style="margin:26px 0 0;">
                <a href="${i.appUrl}/appointments/${i.appointmentId}"
                   style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">
                  View appointment
                </a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:#fbfaf7;border-top:1px solid #ece7de;font-size:12px;color:#8a918f;">
              ${
                i.event === "booked" && i.party === "client"
                  ? `<strong>Important note:</strong> we kindly request you avoid
                     rescheduling or cancelling, as this time is reserved
                     exclusively for you. Each slot is precious and could be
                     used to support someone in urgent need.<br><br>`
                  : ""
              }
              Sent by ${escapeHtml(i.practiceName)}.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
