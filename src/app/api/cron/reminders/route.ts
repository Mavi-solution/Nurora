import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/auth";
import { sendEmail } from "@/lib/notify/email";
import { sendSms, sendWhatsApp } from "@/lib/notify/sms";
import {
  reminderHtml,
  reminderSms,
  reminderSubject,
  reminderText,
  type ReminderInput,
} from "@/lib/notify/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateKeyInTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KIND = "reminder_3d";
const LEAD_DAYS = 3;

type ChannelResult = {
  channel: "email" | "sms" | "whatsapp";
  destination: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
};

/**
 * Daily reminder sweep. Sends to BOTH the counsellor and the client for
 * every session exactly three days out.
 *
 * Idempotency comes from notification_deliveries: a unique key per
 * (appointment, recipient, kind, channel) means re-running the job — or
 * Vercel retrying it — never double-sends.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const now = new Date();

  // Pull a generous window, then filter precisely per counsellor timezone.
  const windowStart = new Date(now.getTime() + 1 * 86_400_000);
  const windowEnd = new Date(now.getTime() + 6 * 86_400_000);

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(
      `id, starts_at, ends_at, title, location, meeting_url, status,
       counsellor:profiles!appointments_counsellor_id_fkey (
         id, full_name, email, phone, timezone,
         notify_email, notify_sms, notify_whatsapp
       ),
       client:clients!appointments_client_id_fkey (
         id, full_name, email, phone, user_id
       )`,
    )
    .in("status", ["scheduled"])
    .gte("starts_at", windowStart.toISOString())
    .lte("starts_at", windowEnd.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = appUrl();
  const summary = {
    scanned: appointments?.length ?? 0,
    due: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of appointments ?? []) {
    // PostgREST types embedded rows loosely; normalise to objects.
    const counsellor = asOne(row.counsellor) as CounsellorRow | null;
    const client = asOne(row.client) as ClientRow | null;
    if (!counsellor || !client) continue;

    const tz = counsellor.timezone || "Asia/Kolkata";
    const todayKey = dateKeyInTimeZone(now, tz);
    const sessionKey = dateKeyInTimeZone(new Date(row.starts_at), tz);

    if (daysBetween(todayKey, sessionKey) !== LEAD_DAYS) continue;
    summary.due += 1;

    const durationMinutes = Math.round(
      (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) /
        60_000,
    );

    const common = {
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: tz,
      durationMinutes,
      title: row.title,
      meetingUrl: row.meeting_url,
      location: row.location,
      appUrl: base,
      appointmentId: row.id,
    };

    const counsellorKey = `staff:${counsellor.id}`;
    const clientKey = `client:${client.id}`;

    // Read the ledger BEFORE sending anything: a channel already marked
    // sent must never go out twice, however often this job runs.
    const alreadySent = await sentChannels(supabase, row.id, [
      counsellorKey,
      clientKey,
    ]);

    // ------------------------------------------------------ counsellor
    const counsellorInput: ReminderInput = {
      ...common,
      recipientName: counsellor.full_name,
      otherPartyName: client.full_name,
      party: "counsellor",
    };

    const counsellorResults = await deliver(
      counsellorInput,
      {
        email: counsellor.notify_email ? counsellor.email : null,
        sms: counsellor.notify_sms ? counsellor.phone : null,
        whatsapp: counsellor.notify_whatsapp ? counsellor.phone : null,
      },
      alreadySent.get(counsellorKey) ?? new Set(),
    );

    await record(supabase, row.id, counsellorResults, {
      recipient_key: counsellorKey,
      recipient_id: counsellor.id,
      recipient_label: counsellor.full_name,
    });

    await notifyInApp(
      supabase,
      counsellor.id,
      counsellorKey,
      row.id,
      counsellorInput,
      alreadySent.get(counsellorKey) ?? new Set(),
    );

    // ---------------------------------------------------------- client
    const clientInput: ReminderInput = {
      ...common,
      recipientName: client.full_name,
      otherPartyName: counsellor.full_name,
      party: "client",
    };

    // Clients have no notification preferences of their own — reach them
    // on whatever contact details the practice holds.
    const clientResults = await deliver(
      clientInput,
      {
        email: client.email,
        sms: process.env.TWILIO_WHATSAPP_FROM ? null : client.phone,
        whatsapp: process.env.TWILIO_WHATSAPP_FROM ? client.phone : null,
      },
      alreadySent.get(clientKey) ?? new Set(),
    );

    await record(supabase, row.id, clientResults, {
      recipient_key: clientKey,
      recipient_client_id: client.id,
      recipient_label: client.full_name,
    });

    if (client.user_id) {
      await notifyInApp(
        supabase,
        client.user_id,
        clientKey,
        row.id,
        clientInput,
        alreadySent.get(clientKey) ?? new Set(),
      );
    }

    for (const r of [...counsellorResults, ...clientResults]) {
      if (r.status === "sent") summary.sent += 1;
      else if (r.status === "failed") summary.failed += 1;
      else summary.skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, ranAt: now.toISOString(), ...summary });
}

/** Also allow POST so the job can be triggered by hand. */
export const POST = GET;

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
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Whole days between two YYYY-MM-DD keys. */
function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** Channels already marked `sent`, keyed by recipient. */
async function sentChannels(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
  recipientKeys: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();

  const { data } = await supabase
    .from("notification_deliveries")
    .select("recipient_key, channel, status")
    .eq("appointment_id", appointmentId)
    .eq("kind", KIND)
    .in("recipient_key", recipientKeys);

  for (const row of data ?? []) {
    if (row.status !== "sent") continue;
    const set = map.get(row.recipient_key) ?? new Set<string>();
    set.add(row.channel);
    map.set(row.recipient_key, set);
  }

  return map;
}

async function deliver(
  input: ReminderInput,
  to: { email: string | null; sms: string | null; whatsapp: string | null },
  alreadySent: Set<string>,
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];

  if (to.email && !alreadySent.has("email")) {
    const res = await sendEmail({
      to: to.email,
      subject: reminderSubject(input),
      html: reminderHtml(input),
      text: reminderText(input),
    });
    results.push({
      channel: "email",
      destination: to.email,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      error: res.error,
    });
  }

  if (to.whatsapp && !alreadySent.has("whatsapp")) {
    const res = await sendWhatsApp(to.whatsapp, reminderSms(input));
    results.push({
      channel: "whatsapp",
      destination: to.whatsapp,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      error: res.error,
    });
  }

  if (to.sms && !alreadySent.has("sms")) {
    const res = await sendSms(to.sms, reminderSms(input));
    results.push({
      channel: "sms",
      destination: to.sms,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      error: res.error,
    });
  }

  return results;
}

async function record(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
  results: ChannelResult[],
  recipient: {
    recipient_key: string;
    recipient_id?: string;
    recipient_client_id?: string;
    recipient_label: string;
  },
) {
  if (results.length === 0) return;

  // Upsert, so a channel that failed today can be retried tomorrow and
  // simply overwrite its own row rather than colliding with it.
  await supabase.from("notification_deliveries").upsert(
    results.map((r) => ({
      appointment_id: appointmentId,
      kind: KIND,
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
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  recipientKey: string,
  appointmentId: string,
  input: ReminderInput,
  alreadySent: Set<string>,
) {
  if (alreadySent.has("in_app")) return;

  await supabase.from("notifications").insert({
    user_id: userId,
    appointment_id: appointmentId,
    kind: KIND,
    title: "Session in 3 days",
    body: reminderSms(input),
  });

  await supabase.from("notification_deliveries").upsert(
    {
      appointment_id: appointmentId,
      recipient_key: recipientKey,
      recipient_id: userId,
      kind: KIND,
      channel: "in_app",
      status: "sent",
      recipient_label: input.recipientName,
    },
    { onConflict: "appointment_id,recipient_key,kind,channel" },
  );
}
