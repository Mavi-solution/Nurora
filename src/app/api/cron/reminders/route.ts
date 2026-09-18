import { NextResponse, type NextRequest } from "next/server";
import {
  positionalVars,
  renderTemplate,
  varsForAppointment,
} from "@/lib/business/render-message";
import { sendEmail } from "@/lib/notify/email";
import { toE164 } from "@/lib/notify/phone";
import { sendSms, sendWhatsApp } from "@/lib/notify/sms";
import { stripWhatsAppFormatting } from "@/lib/notify/message-templates";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scheduled-message sweep.
 *
 * This used to be one reminder hard-coded to three days out. It now
 * walks every active message_schedule, so the practice decides what
 * goes out and when without a deploy.
 *
 * Idempotency is unchanged in spirit and still the important part: a
 * ledger row per (appointment, recipient, kind, channel), where kind is
 * the schedule's own id. Re-running the job — or the platform retrying
 * it — never sends the same message twice, while a channel that FAILED
 * is retried tomorrow because only 'sent' blocks a resend.
 */
export async function GET(request: NextRequest) {
  /*
   * Read at RUNTIME, not through a literal process.env.CRON_SECRET.
   *
   * This is the same trap that made the app insist WhatsApp was not
   * configured while /api/health could see all four Twilio variables:
   * a static process.env.X is substituted when the bundle is built, and
   * Vercel withholds Sensitive variables from the build step. Here the
   * consequence is worse than a missing feature — the secret would read
   * as absent, the guard below would be skipped, and the endpoint would
   * stay WIDE OPEN on a deployment whose owner had just set a secret to
   * close it.
   */
  const secret = serverEnv("CRON_SECRET");

  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (isProduction()) {
    /*
     * Fail closed in production. This endpoint sends real WhatsApp
     * messages to real clients, so an unprotected one is not a
     * degraded feature — it is a way for anyone who finds the URL to
     * message the practice's client list. Locally it stays open, where
     * the only thing it can reach is a test database.
     */
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not set on this deployment, so the reminder sweep " +
          "is disabled. Set it in the project's environment variables and " +
          "redeploy — see DEPLOY.md.",
      },
      { status: 503 },
    );
  }

  const supabase = createAdminClient();
  const now = new Date();

  const { data: schedules, error: scheduleError } = await supabase
    .from("message_schedules")
    .select("*, template:message_templates (*)")
    .eq("is_active", true)
    .in("trigger", ["before_appointment", "after_appointment"]);

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 500 });
  }

  const practice = process.env.NEXT_PUBLIC_PRACTICE_NAME?.trim() || "Nurora";
  const summary = {
    schedules: 0,
    scanned: 0,
    due: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const schedule of schedules ?? []) {
    const template = asOne(schedule.template) as TemplateRow | null;
    if (!template || !template.is_active) continue;
    summary.schedules += 1;

    const offsetMs = (schedule.offset_minutes as number) * 60_000;
    const before = schedule.trigger === "before_appointment";

    // The window this run is responsible for. Deliberately generous —
    // wider than the gap between runs — because the ledger stops
    // duplicates, whereas a window too narrow silently drops a message
    // if a run is late or missed.
    const centre = before
      ? new Date(now.getTime() + offsetMs)
      : new Date(now.getTime() - offsetMs);
    const from = new Date(centre.getTime() - 12 * 3_600_000);
    const to = new Date(centre.getTime() + 12 * 3_600_000);

    const { data: appointments } = await supabase
      .from("appointments")
      .select(
        `id, starts_at, ends_at, title, location, meeting_url, status,
         counsellor:profiles!appointments_counsellor_id_fkey (
           id, full_name, email, phone, timezone,
           notify_email, notify_sms, notify_whatsapp
         ),
         client:clients!appointments_client_id_fkey (
           id, full_name, email, phone, user_id
         ),
         service:services (name)`,
      )
      // A cancelled session needs no reminder, and a completed one
      // needs no nudge to attend.
      .eq("status", before ? "scheduled" : "completed")
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString());

    summary.scanned += appointments?.length ?? 0;

    for (const row of appointments ?? []) {
      const counsellor = asOne(row.counsellor) as CounsellorRow | null;
      const client = asOne(row.client) as ClientRow | null;
      if (!counsellor || !client) continue;

      // Only the appointments whose moment has actually arrived.
      const due = before
        ? new Date(row.starts_at as string).getTime() - offsetMs
        : new Date(row.ends_at as string).getTime() + offsetMs;
      if (due > now.getTime()) continue;
      summary.due += 1;

      const kind = `schedule:${schedule.id}`;
      const tz = counsellor.timezone || "Asia/Kolkata";

      const vars = varsForAppointment({
        clientFullName: client.full_name,
        counsellorName: counsellor.full_name,
        startsAt: row.starts_at as string,
        endsAt: row.ends_at as string,
        timezone: tz,
        serviceName: asOne(row.service)?.name ?? (row.title as string),
        practiceName: practice,
        location: row.location as string | null,
        meetingUrl: row.meeting_url as string | null,
      });

      const body = renderTemplate(template.body, vars);
      const audience = schedule.audience as string;

      const targets: { key: string; phone: string | null; email: string | null; label: string; id: string; isClient: boolean }[] = [];
      if (audience === "client" || audience === "both") {
        targets.push({
          key: `client:${client.id}`, phone: client.phone, email: client.email,
          label: client.full_name, id: client.id, isClient: true,
        });
      }
      if (audience === "counsellor" || audience === "both") {
        targets.push({
          key: `staff:${counsellor.id}`,
          phone: counsellor.notify_whatsapp || counsellor.notify_sms ? counsellor.phone : null,
          email: counsellor.notify_email ? counsellor.email : null,
          label: counsellor.full_name, id: counsellor.id, isClient: false,
        });
      }

      for (const target of targets) {
        const alreadySent = await sentChannels(supabase, row.id as string, kind, target.key);
        const results: ChannelResult[] = [];

        if (template.channel === "whatsapp" || template.channel === "sms") {
          const phone = toE164(target.phone);
          if (phone && !alreadySent.has(template.channel)) {
            const res =
              template.channel === "whatsapp"
                ? await sendWhatsApp(
                    phone,
                    body,
                    template.content_sid
                      ? {
                          contentSid: template.content_sid,
                          variables: positionalVars(template.variables ?? [], vars),
                        }
                      : null,
                  )
                : await sendSms(phone, stripWhatsAppFormatting(body));

            results.push({
              channel: template.channel,
              destination: phone,
              status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
              error: res.error,
            });
          }
        }

        if (template.channel === "email" && target.email && !alreadySent.has("email")) {
          const res = await sendEmail({
            to: target.email,
            subject: `${practice}: ${template.name}`,
            text: stripWhatsAppFormatting(body),
            html: `<pre style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;white-space:pre-wrap">${escapeHtml(
              stripWhatsAppFormatting(body),
            )}</pre>`,
          });
          results.push({
            channel: "email", destination: target.email,
            status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
            error: res.error,
          });
        }

        if (results.length > 0) {
          await supabase.from("notification_deliveries").upsert(
            results.map((r) => ({
              appointment_id: row.id,
              kind,
              channel: r.channel,
              status: r.status,
              destination: r.destination,
              error: r.error ?? null,
              sent_at: new Date().toISOString(),
              recipient_key: target.key,
              recipient_label: target.label,
              ...(target.isClient
                ? { recipient_client_id: target.id }
                : { recipient_id: target.id }),
            })),
            { onConflict: "appointment_id,recipient_key,kind,channel" },
          );
        }

        for (const r of results) {
          if (r.status === "sent") summary.sent += 1;
          else if (r.status === "failed") summary.failed += 1;
          else summary.skipped += 1;
        }
      }
    }

    await supabase
      .from("message_schedules")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", schedule.id);
  }

  return NextResponse.json({ ok: true, ranAt: now.toISOString(), ...summary });
}

/** Also allow POST so the job can be triggered by hand. */
/** True on a real deployment, however it was built. */
function isProduction(): boolean {
  return (
    serverEnv("VERCEL_ENV") === "production" ||
    (Boolean(serverEnv("VERCEL")) && serverEnv("VERCEL_ENV") !== "development") ||
    process.env.NODE_ENV === "production"
  );
}

export const POST = GET;

/* ------------------------------------------------------------- helpers */

type TemplateRow = {
  body: string; channel: string; content_sid: string | null;
  variables: string[]; is_active: boolean; name: string;
};
type CounsellorRow = {
  id: string; full_name: string; email: string | null; phone: string | null;
  timezone: string; notify_email: boolean; notify_sms: boolean; notify_whatsapp: boolean;
};
type ClientRow = {
  id: string; full_name: string; email: string | null; phone: string | null; user_id: string | null;
};
type ChannelResult = {
  channel: string; destination: string | null;
  status: "sent" | "failed" | "skipped"; error?: string;
};

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Channels already marked sent, so nothing goes out twice. */
async function sentChannels(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
  kind: string,
  recipientKey: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("notification_deliveries")
    .select("channel, status")
    .eq("appointment_id", appointmentId)
    .eq("kind", kind)
    .eq("recipient_key", recipientKey);

  return new Set(
    (data ?? []).filter((r) => r.status === "sent").map((r) => r.channel as string),
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
