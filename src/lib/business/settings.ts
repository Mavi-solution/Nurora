import {
  PLACEHOLDER_BILLING_SETTINGS,
  type BillingSettings,
} from "./billing";

/**
 * Billing settings, from the environment until the clinic Settings
 * screen exists.
 *
 * ARCHITECTURE.md rule 2's SHAPE is fixed — full payment for certain
 * modes, otherwise one of two fixed amounts decided by a single price
 * threshold. The NUMBERS live in the clinic's settings row, which was
 * not part of the handoff, so they are read from env here rather than
 * invented. Unset, the tiers are zero and only the full-payment modes
 * ask for anything, which is visibly wrong rather than quietly wrong.
 */
export function billingSettings(): BillingSettings {
  const rupees = (key: string, fallback: number) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : fallback;
  };

  const minutes = (key: string, fallback: number) => {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  };

  return {
    ...PLACEHOLDER_BILLING_SETTINGS,
    // Mode keys as stored, not the display labels.
    fullPaymentModes: ["online", "offline_walk_in"],
    advanceTierThresholdCents: rupees("BILLING_ADVANCE_TIER_THRESHOLD", 0),
    advanceAtOrBelowCents: rupees("BILLING_ADVANCE_AT_OR_BELOW", 0),
    advanceAboveCents: rupees("BILLING_ADVANCE_ABOVE", 0),
    includedMinutes: minutes("BILLING_INCLUDED_MINUTES", 60),
    graceMinutes: minutes("BILLING_GRACE_MINUTES", 0),
    extensionBlockMinutes: minutes("BILLING_EXTENSION_BLOCK_MINUTES", 15),
    extensionBlockCents: rupees("BILLING_EXTENSION_BLOCK_PRICE", 0),
    graceMode:
      process.env.BILLING_GRACE_MODE === "deduct" ? "deduct" : "gate",
  };
}

/** True when the tier amounts have actually been configured. */
export function advanceTiersConfigured(): boolean {
  const s = billingSettings();
  return s.advanceAtOrBelowCents > 0 || s.advanceAboveCents > 0;
}
