import { toE164 } from "./notify/phone";

/**
 * Field validators, shared by the client and the server.
 *
 * A validator returns null when the value is fine, or the message to
 * show. Deliberately plain functions so the same rule can run on blur
 * in the browser and again in a server action — the browser check is a
 * courtesy, the server one is the guarantee.
 */
export type Validator = (value: string) => string | null;

/**
 * Email, checked the way that is actually useful.
 *
 * No attempt at RFC 5322 — that grammar accepts things no mail server
 * will, and rejecting a valid address is worse than accepting a
 * doubtful one. This catches what people actually mistype: a missing @,
 * a missing dot, trailing punctuation, spaces, a doubled @.
 */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  if ((v.match(/@/g) ?? []).length !== 1) return false;

  const [local, domain] = v.split("@");
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 253) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;
  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;

  const tld = domain.split(".").pop() ?? "";
  if (tld.length < 2 || !/^[a-z]+$/i.test(tld)) return false;

  return /^[A-Za-z0-9._%+'-]+$/.test(local);
}

/**
 * A number we could actually dial, once normalised to E.164.
 *
 * The character check is not redundant: toE164 strips anything that is
 * not a digit, so "98400 1122a" would otherwise normalise cleanly to a
 * nine-digit number and pass. A letter in a phone number is a typo, and
 * silently discarding it produces a number nobody can be reached on.
 */
export function isValidPhone(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (!/^[\d\s()+\-.]+$/.test(v)) return false;
  return toE164(v) !== null;
}

export const validators = {
  email(opts: { required?: boolean } = {}): Validator {
    return (value) => {
      const v = value.trim();
      if (!v) return opts.required ? "Enter an email address." : null;
      return isValidEmail(v)
        ? null
        : "That doesn't look like an email address.";
    };
  },

  phone(opts: { required?: boolean; label?: string } = {}): Validator {
    const what = opts.label ?? "phone number";
    return (value) => {
      const v = value.trim();
      if (!v) return opts.required ? `Enter a ${what}.` : null;
      if (!/^[\d\s()+\-.]+$/.test(v)) {
        return `A ${what} can only contain digits, spaces and + ( ) -`;
      }
      return isValidPhone(v)
        ? null
        : `That doesn't look like a valid ${what}. Include the area or country code.`;
    };
  },

  required(what: string): Validator {
    return (value) => (value.trim() ? null : `Enter ${what}.`);
  },

  minLength(n: number, what: string): Validator {
    return (value) => {
      const v = value.trim();
      if (!v) return null;
      return v.length >= n ? null : `${what} needs at least ${n} characters.`;
    };
  },

  /** Whole number in a range. Empty passes — pair with required(). */
  numberBetween(min: number, max: number, what: string): Validator {
    return (value) => {
      const v = value.trim();
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return `${what} must be a number.`;
      if (n < min || n > max) return `${what} must be between ${min} and ${max}.`;
      return null;
    };
  },

  /** Run several in order and report the first complaint. */
  all(...list: Validator[]): Validator {
    return (value) => {
      for (const v of list) {
        const message = v(value);
        if (message) return message;
      }
      return null;
    };
  },
};
