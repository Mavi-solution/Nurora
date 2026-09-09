import type { SendResult } from "./email";

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const smsFrom = process.env.TWILIO_SMS_FROM;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886

type Channel = "sms" | "whatsapp";

/**
 * Twilio's REST API over fetch. Avoids pulling the Node SDK (and its
 * filesystem deps) into the edge-friendly route bundle.
 */
async function twilioSend(
  to: string,
  from: string,
  body: string,
): Promise<SendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });

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
  return twilioSend(to, smsFrom, body);
}

export async function sendWhatsApp(
  to: string,
  body: string,
): Promise<SendResult> {
  if (!sid || !token || !whatsappFrom) {
    return { ok: false, skipped: true, error: "Twilio WhatsApp not configured" };
  }
  const dest = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  return twilioSend(dest, whatsappFrom, body);
}

export function channelDestination(
  channel: Channel,
  phone: string | null,
): string | null {
  if (!phone) return null;
  return channel === "whatsapp" ? `whatsapp:${phone}` : phone;
}
