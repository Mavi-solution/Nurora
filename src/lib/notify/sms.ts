import type { SendResult } from "./email";
import { toE164 } from "./phone";

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const smsFrom = process.env.TWILIO_SMS_FROM;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886

type Channel = "sms" | "whatsapp";

/**
 * An approved WhatsApp template. Outside a 24-hour customer-service
 * window Meta rejects free-form business-initiated messages, and an
 * appointment confirmation is always business-initiated — so when a
 * Content SID is configured we send the template and keep the prose
 * only as the in-app/SMS wording.
 */
export type WhatsAppTemplate = {
  contentSid: string;
  /** Positional variables, as Twilio's Content API expects: {"1":"…"}. */
  variables: Record<string, string>;
};

/**
 * Twilio's REST API over fetch. Avoids pulling the Node SDK (and its
 * filesystem deps) into the edge-friendly route bundle.
 */
async function twilioSend(
  to: string,
  from: string,
  payload: { body: string } | { template: WhatsAppTemplate },
): Promise<SendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from });

  if ("template" in payload) {
    params.set("ContentSid", payload.template.contentSid);
    params.set("ContentVariables", JSON.stringify(payload.template.variables));
  } else {
    params.set("Body", payload.body);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `Twilio ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!sid || !token || !smsFrom) {
    return { ok: false, skipped: true, error: "Twilio SMS not configured" };
  }

  const dest = toE164(to);
  if (!dest) {
    return { ok: false, skipped: true, error: `Unusable phone number: ${to}` };
  }

  return twilioSend(dest, smsFrom, { body });
}

/**
 * WhatsApp via Twilio. `template` is used when supplied AND a Content SID
 * is available; otherwise this falls back to the free-form body, which is
 * what the Twilio sandbox accepts during development.
 */
export async function sendWhatsApp(
  to: string,
  body: string,
  template?: WhatsAppTemplate | null,
): Promise<SendResult> {
  if (!sid || !token || !whatsappFrom) {
    return { ok: false, skipped: true, error: "Twilio WhatsApp not configured" };
  }

  const e164 = toE164(to);
  if (!e164) {
    return { ok: false, skipped: true, error: `Unusable phone number: ${to}` };
  }

  const from = whatsappFrom.startsWith("whatsapp:")
    ? whatsappFrom
    : `whatsapp:${whatsappFrom}`;

  return twilioSend(
    `whatsapp:${e164}`,
    from,
    template?.contentSid ? { template } : { body },
  );
}

/** True when at least one Twilio channel is usable. */
export function whatsappConfigured(): boolean {
  return Boolean(sid && token && whatsappFrom);
}

export function channelDestination(
  channel: Channel,
  phone: string | null,
): string | null {
  const e164 = toE164(phone);
  if (!e164) return null;
  return channel === "whatsapp" ? `whatsapp:${e164}` : e164;
}
