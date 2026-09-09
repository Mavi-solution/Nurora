import { formatDateTime, formatDuration } from "../format";

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
