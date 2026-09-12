import { formatDateTime } from "../format";

/**
 * The clinic's approved client-facing message copy.
 *
 * This is the wording the practice actually sends, reproduced verbatim
 * — including its WhatsApp *bold* markers and its indentation. Both the
 * automated confirmation (Twilio) and the counsellor's own follow-up
 * (the wa.me link behind milestone 1) render from here, so the client
 * never receives two differently-worded confirmations.
 *
 * FUNCTIONAL-GUIDE.md §3 lists "message/policy templates" as a Settings
 * screen. When that exists these move into it; until then this file is
 * the one place to edit the copy.
 */

export type ConfirmationVars = {
  /** {{name}} — the client, as addressed. */
  name: string;
  /** {{date}} — when the session is, including the time. */
  date: string;
};

/**
 * WhatsApp confirmation, exactly as approved.
 *
 * The asterisks are WhatsApp's bold syntax and the leading spaces are
 * the layout of the original — kept rather than tidied, because this is
 * copy the practice has signed off on.
 */
export function confirmationWhatsApp(v: ConfirmationVars): string {
  return `*Appointment Confirmation*

Hi ${v.name}, 

          Your appointment has been confirmed for *${v.date}.*
          Kindly arrive at the clinic at least *10 minutes* before your scheduled time.

*Important Note:* We kindly request you to avoid rescheduling or canceling your appointment, as this time is reserved exclusively for you. Each slot is precious and could be used to support someone in urgent need.

                          Thank you for your understanding. We’re here to help, and we look forward to seeing you!`;
}

/**
 * The same message for channels that cannot render WhatsApp markup.
 *
 * SMS shows a literal asterisk and is billed per segment, so the bold
 * markers come out and the decorative indentation is collapsed.
 */
export function confirmationPlain(v: ConfirmationVars): string {
  return stripWhatsAppFormatting(confirmationWhatsApp(v));
}

/** Remove *bold* markers and collapse decorative indentation. */
export function stripWhatsAppFormatting(text: string): string {
  return text
    .replace(/\*(.+?)\*/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** How {{date}} is rendered wherever the template is used. */
export function confirmationDate(startsAt: string, timezone: string): string {
  return formatDateTime(startsAt, timezone);
}

/**
 * How the client is addressed. First name only — the approved copy
 * reads "Hi {{name}}," which is a greeting, not a formal salutation.
 */
export function greetingName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || "there";
}

/**
 * Positional variables for the approved WhatsApp template registered
 * with Meta. The body has two placeholders, in this order:
 *
 *   {{1}} client name     {{2}} date and time
 *
 * Register the template with exactly this copy and variable order, or
 * the rendered message will not match what is sent free-form in dev.
 */
export function confirmationTemplateVariables(
  v: ConfirmationVars,
): Record<string, string> {
  return { "1": v.name, "2": v.date };
}
