import { Resend } from "resend";
import { serverEnv } from "../server-env";

/* Built per call, for the same reason as sms.ts: a module-scope read
 * freezes the value and can be substituted at build time, so a key
 * supplied only at runtime would never be seen. */
function client(): { resend: Resend; from: string } | null {
  const apiKey = serverEnv("RESEND_API_KEY");
  if (!apiKey) return null;
  return {
    resend: new Resend(apiKey),
    from: serverEnv("RESEND_FROM_EMAIL") ?? "Nurora <onboarding@resend.dev>",
  };
}

/** True when email can actually send. */
export function emailConfigured(): boolean {
  return serverEnv("RESEND_API_KEY") !== undefined;
}

export type SendResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const c = client();
  if (!c) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY not configured" };
  }

  try {
    const { error } = await c.resend.emails.send({
      from: c.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
