/**
 * Is Twilio actually configured, and if not, what exactly is wrong?
 *
 * Kept apart from sms.ts, which does the sending: this is pure
 * configuration logic with no dependencies beyond reading the
 * environment, so it can be unit-tested without dragging the send path
 * (and its HTTP client) along behind it.
 */
/**
 * The same runtime read as serverEnv(), inlined.
 *
 * This module is deliberately importable with no dependency graph at
 * all, so the unit tests can load it directly. The three lines are
 * duplicated rather than imported for that reason — and the one thing
 * that must not drift is the COMPUTED key, which is what stops the
 * bundler substituting the value at build time. A trimmed-empty value
 * reads as absent, which is the distinction this whole module exists
 * to make.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type EnvState = "absent" | "empty" | "set" | "wrong shape";

export type WhatsAppStatus = {
  connected: boolean;
  /** Per variable, with never a value — only what is wrong with it. */
  detail: Record<string, string>;
  /** Names that are absent or blank. */
  missing: string[];
  /** Names that hold something, but not the thing they should. */
  malformed: string[];
};

/**
 * Why WhatsApp is or is not connected, in enough detail to act on.
 *
 * "Set the Twilio variables and redeploy" is unhelpful advice to give
 * someone who has set them — and that is exactly the state this ran
 * into: a variable created in Vercel with an EMPTY value. The key is
 * then present in process.env, so it looks set in every listing, while
 * the value is a blank string and nothing can send.
 *
 * The shape checks catch the other half of the same problem. A Twilio
 * Account SID starts "AC" and is 34 characters; an Auth Token is 32
 * hex. Paste one into the other's box and both read as "set" while
 * every send fails with a 401 that says nothing about which.
 *
 * NO VALUE IS EVER RETURNED — only lengths and verdicts. This is
 * surfaced on a diagnostic endpoint, and a leaked auth token is worth
 * more to an attacker than the diagnosis is to anyone else.
 */
export function whatsappStatus(): WhatsAppStatus {
  const raw = {
    TWILIO_ACCOUNT_SID: env("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: env("TWILIO_AUTH_TOKEN"),
    TWILIO_WHATSAPP_FROM: env("TWILIO_WHATSAPP_FROM"),
  };

  const detail: Record<string, string> = {};
  const missing: string[] = [];
  const malformed: string[] = [];

  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) {
      // serverEnv() trims and returns undefined for a blank string, so
      // the two cases are told apart by looking at the key itself.
      const present = Object.prototype.hasOwnProperty.call(process.env, name);
      detail[name] = present
        ? "present but EMPTY — the variable exists with no value"
        : "MISSING";
      missing.push(name);
      continue;
    }

    const problem = shapeProblem(name, value);
    if (problem) {
      detail[name] = problem;
      malformed.push(name);
    } else {
      detail[name] = `set (${value.length} chars)`;
    }
  }

  return {
    connected: missing.length === 0 && malformed.length === 0,
    detail,
    missing,
    malformed,
  };
}

/** What is obviously wrong with a value, without revealing it. */
function shapeProblem(name: string, value: string): string | null {
  if (name === "TWILIO_ACCOUNT_SID") {
    if (!value.startsWith("AC")) {
      return `wrong shape — an Account SID starts "AC"; this starts "${value.slice(0, 2)}". Did the Auth Token or a Content SID go in here?`;
    }
    if (value.length !== 34) {
      return `wrong shape — an Account SID is 34 characters; this is ${value.length}`;
    }
  }

  if (name === "TWILIO_AUTH_TOKEN") {
    if (value.startsWith("AC") || value.startsWith("HX") || value.startsWith("SK")) {
      return `wrong shape — this looks like a SID ("${value.slice(0, 2)}…"), not an Auth Token`;
    }
    if (value.length !== 32) {
      return `wrong shape — an Auth Token is 32 characters; this is ${value.length}`;
    }
  }

  if (name === "TWILIO_WHATSAPP_FROM") {
    const number = value.replace(/^whatsapp:/i, "");
    if (!/^\+\d{7,15}$/.test(number)) {
      return 'wrong shape — expected a number in E.164, like "whatsapp:+14155238886" or "+14155238886"';
    }
  }

  return null;
}
