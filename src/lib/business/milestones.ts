/**
 * The five appointment milestones — FUNCTIONAL-GUIDE.md §2.
 *
 * The important rule: an appointment is "Completed" only once ALL FIVE
 * are done, NOT when the session ends. Reports and the activity view
 * read this same function, so no screen can invent its own definition.
 *
 * Milestone 3 is DERIVED from the session's own status rather than
 * stored. A manual tick could otherwise claim a session happened when
 * the timer says it did not.
 */

export type MilestoneKey = "message" | "call" | "session" | "nubill" | "persona";

export type Milestone = {
  key: MilestoneKey;
  label: string;
  /** Milestone 3 cannot be ticked — it follows the timer. */
  manual: boolean;
  hint: string;
};

export const MILESTONES: Milestone[] = [
  {
    key: "message",
    label: "Personalize message",
    manual: true,
    hint: "Send the client their confirmation on WhatsApp.",
  },
  {
    key: "call",
    label: "Call the client",
    manual: true,
    hint: "A courtesy or reminder call, marked done by hand.",
  },
  {
    key: "session",
    label: "Start and end session",
    manual: false,
    hint: "Follows the session timer — it cannot be ticked by hand.",
  },
  {
    key: "nubill",
    label: "NuBills",
    manual: true,
    hint: "Paste the billing text once the session is paid up.",
  },
  {
    key: "persona",
    label: "Fill the Persona",
    manual: true,
    hint: "The client's intake and assessment form.",
  },
];

/** The fields this reads. Kept narrow so any row shape can be passed. */
export type MilestoneSource = {
  status: string;
  message_sent_at: string | null;
  call_made_at: string | null;
  nubill_at: string | null;
  persona_at: string | null;
};

export type MilestoneProgress = {
  steps: { milestone: Milestone; done: boolean; at: string | null }[];
  doneCount: number;
  total: number;
  /** All five done. The ONLY thing that counts as complete. */
  allDone: boolean;
  /** 1-based position of the next outstanding step, or null when done. */
  currentStep: number | null;
  currentLabel: string | null;
};

export function milestoneProgress(row: MilestoneSource): MilestoneProgress {
  // Derived, never stored: a cancelled session never happened, and only
  // a completed one counts as run.
  const sessionDone = row.status === "completed";

  const at: Record<MilestoneKey, string | null> = {
    message: row.message_sent_at,
    call: row.call_made_at,
    session: sessionDone ? "derived" : null,
    nubill: row.nubill_at,
    persona: row.persona_at,
  };

  const steps = MILESTONES.map((milestone) => ({
    milestone,
    done: at[milestone.key] !== null,
    at: at[milestone.key] === "derived" ? null : at[milestone.key],
  }));

  const doneCount = steps.filter((s) => s.done).length;
  const firstOpen = steps.findIndex((s) => !s.done);

  return {
    steps,
    doneCount,
    total: steps.length,
    allDone: doneCount === steps.length,
    currentStep: firstOpen === -1 ? null : firstOpen + 1,
    currentLabel: firstOpen === -1 ? null : steps[firstOpen].milestone.label,
  };
}

/** "Step 1 of 5 · Personalize message", or "All 5 steps done". */
export function milestoneSummary(row: MilestoneSource): string {
  const p = milestoneProgress(row);
  if (p.allDone) return `All ${p.total} steps done`;
  return `Step ${p.currentStep} of ${p.total} · ${p.currentLabel}`;
}

/**
 * Best-effort parse of pasted billing text for the NuBills milestone.
 *
 * Advisory only — the raw text is what is stored and trusted. This just
 * saves retyping, so it is deliberately conservative: anything it is
 * unsure about comes back null rather than guessed.
 */
export function parseNubill(text: string): {
  name: string | null;
  amountCents: number | null;
  reference: string | null;
} {
  // ₹1,234.50 / Rs 1234 / INR 1234
  const amount = text.match(
    /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const amountCents = amount
    ? Math.round(Number(amount[1].replace(/,/g, "")) * 100)
    : null;

  // UPI refs and bill numbers are the long alphanumeric runs.
  const reference =
    text.match(/(?:ref(?:erence)?|txn|utr|bill(?:\s*no)?)[^\w]{0,4}([A-Za-z0-9-]{6,})/i)?.[1] ??
    text.match(/\b(\d{12,})\b/)?.[1] ??
    null;

  const name =
    text.match(/(?:from|paid\s+by|to)\s+([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,2})/)?.[1] ??
    null;

  return {
    name: name?.trim() || null,
    amountCents: Number.isFinite(amountCents) ? amountCents : null,
    reference,
  };
}
