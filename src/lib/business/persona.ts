import type { Client } from "@/lib/types";

/**
 * The Persona intake form, and what it asks on a given visit.
 *
 * Two kinds of question, and the distinction is the feature:
 *
 *   EVERY VISIT   background, what they are seeking help with, how they
 *                 found us. These change, so they are asked again.
 *
 *   ONCE ONLY     address, area, education, occupation. Facts about a
 *                 life, not about a session. A follow-up skips straight
 *                 past them rather than making a counsellor re-take
 *                 details the clinic already holds while a client sits
 *                 waiting.
 *
 * "First visit" is decided by whether those details are ON FILE, not by
 * counting appointments. A client can be booked three times before
 * anyone sits down and takes their details, and a form that stopped
 * asking on the second booking would leave them permanently blank.
 */

export const ONCE_ONLY_FIELDS = [
  "address",
  "area",
  "education",
  "occupation",
] as const;

export type OnceOnlyField = (typeof ONCE_ONLY_FIELDS)[number];

export type PersonaState = {
  /** Ask for the once-only details on this visit. */
  isFirstVisit: boolean;
  /** Which of the once-only details are still blank. */
  outstanding: OnceOnlyField[];
  /** Every question answered. */
  complete: boolean;
};

type PersonaSource = Pick<
  Client,
  | "background"
  | "presenting_concern"
  | "referral_source"
  | "address"
  | "area"
  | "education"
  | "occupation"
  | "intake_completed_at"
>;

function filled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

/** What the form should ask this time. */
export function personaState(client: PersonaSource): PersonaState {
  const outstanding = ONCE_ONLY_FIELDS.filter((f) => !filled(client[f]));

  /*
   * Already marked taken counts as done even with a gap, because some
   * of these genuinely do not apply — a client who is not working has
   * no occupation to record, and nagging about it every visit would
   * teach the counsellor to ignore the form.
   */
  const taken = filled(client.intake_completed_at) || outstanding.length === 0;

  return {
    isFirstVisit: !taken,
    outstanding,
    complete:
      taken &&
      filled(client.background) &&
      filled(client.presenting_concern) &&
      filled(client.referral_source),
  };
}
