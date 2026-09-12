/**
 * Session billing — ARCHITECTURE.md rule 2 and FUNCTIONAL-GUIDE.md §2,
 * marked MUST MATCH.
 *
 * Two formulas:
 *
 *   advanceRequirement()  what the client owes upfront at booking. A
 *                         TIERED rule, not a per-service field: certain
 *                         booking modes demand the full price, otherwise
 *                         a fixed amount decided by which side of a
 *                         single threshold the service price falls.
 *
 *   computeBill()         what the session actually cost once it ended:
 *                         the base price, plus extension blocks if it
 *                         ran past the included time and the grace
 *                         period. The advance already paid comes off to
 *                         give the balance still owed.
 *
 * The SHAPE of both is fixed by the handoff. The NUMBERS are not — they
 * live in the clinic's settings row, so they are passed in rather than
 * hard-coded here. Seed them from Settings before going live.
 *
 * All money is in minor units (paise/cents), matching the rest of the
 * schema, so nothing here does floating-point arithmetic.
 */

export type BillingSettings = {
  /**
   * Booking modes that skip the tiers and require the whole price
   * upfront — "Online" and "Walk-in" in the handoff.
   */
  fullPaymentModes: string[];
  /** The single price boundary the advance tiers are decided by. */
  advanceTierThresholdCents: number;
  /** Advance for a service priced AT OR BELOW the threshold. */
  advanceAtOrBelowCents: number;
  /** Advance for a service priced ABOVE the threshold. */
  advanceAboveCents: number;

  /** Minutes included in the base price. */
  includedMinutes: number;
  /** Overrun tolerated before any extension is charged at all. */
  graceMinutes: number;
  /** Extensions are billed in whole blocks of this many minutes. */
  extensionBlockMinutes: number;
  /** Price of one extension block. */
  extensionBlockCents: number;

  /**
   * How the grace period behaves once it has been exceeded.
   *
   *   "gate"   — grace only decides WHETHER extension is charged; blocks
   *              are then counted from the end of the included time.
   *   "deduct" — the grace minutes are also free, and blocks are counted
   *              from the end of included + grace.
   *
   * The handoff's wording ("ran long past the included time and grace
   * period") does not settle this, and the two differ on a session that
   * only just overruns. Confirm against computeBill() in the frontend;
   * it is a one-line change here either way.
   */
  graceMode?: "gate" | "deduct";
};

export type Bill = {
  basePriceCents: number;
  /** Minutes actually tracked on the session. */
  actualMinutes: number;
  /** Minutes beyond the included time (0 when it finished early). */
  overrunMinutes: number;
  /** Overrun that is actually chargeable, after the grace rule. */
  chargeableOverrunMinutes: number;
  extensionBlocks: number;
  extensionCents: number;
  totalCents: number;
  advancePaidCents: number;
  /** What the client still owes. Never negative — see refundDueCents. */
  balanceDueCents: number;
  /** Set when the advance exceeded the final total. */
  refundDueCents: number;
};

/**
 * The advance owed at booking time.
 *
 * Deliberately NOT read from the service row: the handoff calls out that
 * a service has one price and the advance is derived from it, so adding
 * a per-service advance field is the exact mistake it warns against.
 */
export function advanceRequirement(
  priceCents: number,
  bookingMode: string,
  settings: BillingSettings,
): number {
  const price = Math.max(0, Math.round(priceCents));

  const fullPayment = settings.fullPaymentModes.some(
    (mode) => mode.toLowerCase() === bookingMode.toLowerCase(),
  );
  if (fullPayment) return price;

  const tiered =
    price <= settings.advanceTierThresholdCents
      ? settings.advanceAtOrBelowCents
      : settings.advanceAboveCents;

  // A fixed advance can exceed a cheap service's price; asking for more
  // upfront than the session costs is never right, so it is capped.
  return Math.min(price, Math.max(0, Math.round(tiered)));
}

/** What the session cost, once the timer stopped. */
export function computeBill(
  input: {
    basePriceCents: number;
    actualMinutes: number;
    advancePaidCents?: number;
    /** Overrides the settings default, for a service of another length. */
    includedMinutes?: number;
  },
  settings: BillingSettings,
): Bill {
  const basePriceCents = Math.max(0, Math.round(input.basePriceCents));
  const actualMinutes = Math.max(0, input.actualMinutes);
  const advancePaidCents = Math.max(0, Math.round(input.advancePaidCents ?? 0));

  const included = Math.max(
    0,
    input.includedMinutes ?? settings.includedMinutes,
  );
  const grace = Math.max(0, settings.graceMinutes);
  const blockMinutes = Math.max(1, settings.extensionBlockMinutes);

  const overrunMinutes = Math.max(0, actualMinutes - included);

  // Inside the grace period nothing extra is charged at all.
  const exceededGrace = overrunMinutes > grace;

  const chargeableOverrunMinutes = !exceededGrace
    ? 0
    : settings.graceMode === "deduct"
      ? overrunMinutes - grace
      : overrunMinutes;

  const extensionBlocks =
    chargeableOverrunMinutes > 0
      ? Math.ceil(chargeableOverrunMinutes / blockMinutes)
      : 0;

  const extensionCents = extensionBlocks * Math.max(0, settings.extensionBlockCents);
  const totalCents = basePriceCents + extensionCents;

  const outstanding = totalCents - advancePaidCents;

  return {
    basePriceCents,
    actualMinutes,
    overrunMinutes,
    chargeableOverrunMinutes,
    extensionBlocks,
    extensionCents,
    totalCents,
    advancePaidCents,
    balanceDueCents: Math.max(0, outstanding),
    refundDueCents: Math.max(0, -outstanding),
  };
}

/**
 * Settings shape with the handoff's structure but obviously-placeholder
 * numbers, so a deployment that forgets to configure Settings fails
 * loudly in review rather than quietly billing the wrong amount.
 */
export const PLACEHOLDER_BILLING_SETTINGS: BillingSettings = {
  fullPaymentModes: ["Online", "Walk-in"],
  advanceTierThresholdCents: 0,
  advanceAtOrBelowCents: 0,
  advanceAboveCents: 0,
  includedMinutes: 60,
  graceMinutes: 0,
  extensionBlockMinutes: 15,
  extensionBlockCents: 0,
  graceMode: "gate",
};
