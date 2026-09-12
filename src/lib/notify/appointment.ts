import { appUrl } from "@/lib/auth";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { sendEmail } from "./email";
import { toE164 } from "./phone";
import { sendSms, sendWhatsApp, type WhatsAppTemplate } from "./sms";
import {
  appointmentEventHtml,
  appointmentEventSms,
  appointmentEventSubject,
  appointmentEventTemplateVariables,
  appointmentEventText,
  type AppointmentEvent,
  type AppointmentEventInput,
} from "./templates";

export type { AppointmentEvent };

type ChannelOutcome = {
  channel: "email" | "sms" | "whatsapp" | "in_app";
  destination: string | null;
  status: "sent" | "failed" | "skipped";
  error?: string;
};

export type NotifyOutcome = {
  /** True when at least one message actually left the building. */
  delivered: boolean;
  whatsapp: "sent" | "failed" | "skipped" | "none";
  results: ChannelOutcome[];
  note?: string;
};

const EVENT_TITLE: Record<AppointmentEvent, string> = {
  booked: "Appointment confirmed",
  rescheduled: "Appointment moved",
  cancelled: "Appointment cancelled",
};

function practiceName(): string {
  return process.env.NEXT_PUBLIC_PRACTICE_NAME?.trim() || "Nurora";
}

/** An approved template per event, when the practice has registered them. */
function templateFor(event: AppointmentEvent): string | null {
  const key = {
    booked: "TWILIO_WHATSAPP_TEMPLATE_BOOKED",
    rescheduled: "TWILIO_WHATSAPP_TEMPLATE_RESCHEDULED",
    cancelled: "TWILIO_WHATSAPP_TEMPLATE_CANCELLED",
  }[event];
  return process.env[key]?.trim() || null;
}

/**
 * Tell both parties that an appointment was booked, moved or cancelled.
 *
 * WhatsApp is the lead channel for the client — it is how this practice
 * already reaches people — with SMS as the fallback when WhatsApp is not
 * configured, and email alongside whenever an address is on file.
 *
 * This NEVER throws and never rejects: a booking that succeeded must not
 * be reported as failed because Twilio had a bad minute. Every outcome
 * is written to notification_deliveries so the desk can see what went
 * out, and the caller gets a summary it can surface in the UI.
 */
export async function notifyAppointmentEvent(opts: {
  appointmentId: string;
  event: AppointmentEvent;
  reason?: string | null;
  /** Skip the counsellor's own copy (they performed the action). */
  skipCounsellor?: boolean;
}): Promise<NotifyOutcome> {
  const empty: NotifyOutcome = {
    delivered: false,
    whatsapp: "none",
    results: [],
  };

  try {
    const supabase = createAdminClientOrNull();
    if (!supabase) {
      return { ...empty, note: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    }

    const { data: row, error } = await supabase
      .from("appointments")
      .select(
        `id, starts_at, ends_at, title, location, meeting_url, cancel_reason,
         counsellor:profiles!appointments_counsellor_id_fkey (
           id, full_name, email, phone, timezone,
           notify_email, notify_sms, notify_whatsapp
         ),
         client:clients!appointments_client_id_fkey (
           id, full_name, email, phone, user_id
         )`,
      )
      .eq("id", opts.appointmentId)
      .maybeSingle();

    if (error || !row) {
      return { ...empty, note: error?.message ?? "Appointment not found" };
    }

    const counsellor = asOne(row.counsellor) as CounsellorRow | null;
    const client = asOne(row.client) as ClientRow | null;
    if (!counsellor || !client) return { ...empty, note: "Missing party" };

    const tz = counsellor.timezone || "Asia/Kolkata";
    const durationMinutes = Math.max(
      1,
      Math.round(
        (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) /
          60_000,
      ),
    );

    const common = {
      event: opts.event,
      startsAt: row.starts_at,
      timezone: tz,
      durationMinutes,
      title: row.title,
      meetingUrl: row.meeting_url,
      location: row.location,
      reason: opts.reason ?? row.cancel_reason ?? null,
      appUrl: appUrl(),
      appointmentId: row.id,
      practiceName: practiceName(),
    };

    const kind = `appointment_${opts.event}`;
    const contentSid = templateFor(opts.event);
    const results: ChannelOutcome[] = [];

    // ------------------------------------------------------------ client
    const clientInput: AppointmentEventInput = {
      ...common,
      recipientName: client.full_name,
      otherPartyName: counsellor.full_name,
      party: "client",
    };

    // Clients hold no notification preferences of their own — the
    // practice reaches them on whatever contact details are on file.
    const clientResults = await deliver(clientInput, contentSid, {
      email: client.email,
      whatsapp: client.phone,
      sms: client.phone,
    });
    results.push(...clientResults);

    await record(supabase, row.id, kind, clientResults, {
      recipient_key: `client:${client.id}`,
      recipient_client_id: client.id,
      recipient_label: client.full_name,
    });

    if (client.user_id) {
      await notifyInApp(supabase, {
        userId: client.user_id,
        appointmentId: row.id,
        kind,
        title: EVENT_TITLE[opts.event],
        body: appointmentEventSms(clientInput),
      });
    }

    // -------------------------------------------------------- counsellor
    if (!opts.skipCounsellor) {
      const counsellorInput: AppointmentEventInput = {
        ...common,
        recipientName: counsellor.full_name,
        otherPartyName: client.full_name,
        party: "counsellor",
      };

      const counsellorResults = await deliver(counsellorInput, contentSid, {
        email: counsellor.notify_email ? counsellor.email : null,
        whatsapp: counsellor.notify_whatsapp ? counsellor.phone : null,
        sms: counsellor.notify_sms ? counsellor.phone : null,
      });
      results.push(...counsellorResults);

      await record(supabase, row.id, kind, counsellorResults, {
        recipient_key: `staff:${counsellor.id}`,
        recipient_id: counsellor.id,
        recipient_label: counsellor.full_name,
      });

      await notifyInApp(supabase, {
        userId: counsellor.id,
        appointmentId: row.id,
        kind,
        title: EVENT_TITLE[opts.event],
        body: appointmentEventSms(counsellorInput),
      });
    }

    const whatsapp = results.find((r) => r.channel === "whatsapp");

    return {
      delivered: results.some((r) => r.status === "sent"),
      whatsapp: whatsapp ? whatsapp.status : "none",
      results,
      note: whatsapp?.error,
    };
  } catch (err) {
    return {
      ...empty,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------- helpers */

type CounsellorRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  timezone: string;
  notify_email: boolean;
  notify_sms: boolean;
  notify_whatsapp: boolean;
};

type ClientRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  user_id: string | null;
};

function asOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * WhatsApp first, then SMS only if WhatsApp did not go out — the same
 * message twice on two channels reads as a glitch, not diligence.
 */
async function deliver(
  input: AppointmentEventInput,
  contentSid: string | null,
  to: { email: string | null; whatsapp: string | null; sms: string | null },
): Promise<ChannelOutcome[]> {
  const results: ChannelOutcome[] = [];
  const body = appointmentEventSms(input);

  const whatsappTo = toE164(to.whatsapp);
  const smsTo = toE164(to.sms);
  let whatsappLanded = false;

  if (whatsappTo) {
    const template: WhatsAppTemplate | null = contentSid
      ? {
          contentSid,
          variables: appointmentEventTemplateVariables(input),
        }
      : null;

    const res = await sendWhatsApp(whatsappTo, body, template);
    whatsappLanded = res.ok;
    results.push({
      channel: "whatsapp",
      destination: whatsappTo,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      error: res.error,
    });
  }

  // SMS is the fallback, not a second copy: only send it when WhatsApp
  // did not actually reach them.
  if (smsTo && !whatsappLanded) {
    const res = await sendSms(smsTo, body);
    results.push({
      channel: "sms",
      destination: smsTo,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      error: res.error,
    });
  }

  if (to.email) {
    const res = await sendEmail({
      to: to.email,
      subject: appointmentEventSubject(input),
      html: appointmentEventHtml(input),
      text: appointmentEventText(input),
    });
    results.push({
      channel: "email",
      destination: to.email,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      error: res.error,
    });
  }

  return results;
}

async function record(
  supabase: NonNullable<ReturnType<typeof createAdminClientOrNull>>,
  appointmentId: string,
  kind: string,
  results: ChannelOutcome[],
  recipient: {
    recipient_key: string;
    recipient_id?: string;
    recipient_client_id?: string;
    recipient_label: string;
  },
) {
  if (results.length === 0) return;

  // Upsert on the same unique key the reminder cron uses. A second
  // reschedule overwrites the first one's ledger row, which is what we
  // want: the row records the latest attempt per channel, not a history.
  await supabase.from("notification_deliveries").upsert(
    results.map((r) => ({
      appointment_id: appointmentId,
      kind,
      channel: r.channel,
      status: r.status,
      destination: r.destination,
      error: r.error ?? null,
      sent_at: new Date().toISOString(),
      ...recipient,
    })),
    { onConflict: "appointment_id,recipient_key,kind,channel" },
  );
}

async function notifyInApp(
  supabase: NonNullable<ReturnType<typeof createAdminClientOrNull>>,
  n: {
    userId: string;
    appointmentId: string;
    kind: string;
    title: string;
    body: string;
  },
) {
  await supabase.from("notifications").insert({
    user_id: n.userId,
    appointment_id: n.appointmentId,
    kind: n.kind,
    title: n.title,
    body: n.body,
  });
}
