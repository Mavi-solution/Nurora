/**
 * The MUST MATCH rules from ARCHITECTURE.md, checked against the
 * acceptance cases the handoff itself names.
 *
 *   node scripts/check-business-rules.mjs
 *
 * No database, no services — pure arithmetic.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Compile the real modules rather than regex-stripping types, so what is
// tested is exactly what ships.
const out = mkdtempSync(join(tmpdir(), "nurora-rules-"));
execFileSync("npx", [
  "tsc",
  "src/lib/business/weekoff.ts",
  "src/lib/business/billing.ts",
  "--outDir", out,
  "--module", "esnext",
  "--target", "es2022",
  "--moduleResolution", "bundler",
], { stdio: "pipe" });

for (const name of ["weekoff", "billing"]) {
  renameSync(join(out, `${name}.js`), join(out, `${name}.mjs`));
}

const wk = await import(join(out, "weekoff.mjs"));
const bl = await import(join(out, "billing.mjs"));

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const check = (n, ok, d = "") => {
  if (ok) console.log(`  ok    ${n}`);
  else { failures += 1; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ""}`); }
};

/* ============================ rule 1: week-off ======================== */

step("Week-off quota — the handoff's two named months");

const aug = wk.getMonthWeeks(2026, 8);
const sep = wk.getMonthWeeks(2026, 9);

console.log(`        Aug 2026 rows: ${aug.map((r) => `${r.startDay}-${r.endDay} (${r.days}d)`).join(", ")}`);
console.log(`        Sep 2026 rows: ${sep.map((r) => `${r.startDay}-${r.endDay} (${r.days}d)`).join(", ")}`);

check("August 2026 is a 4-week month", wk.weekOffQuotaForMonth(2026, 8) === 4, `got ${wk.weekOffQuotaForMonth(2026, 8)}`);
check("September 2026 is a 5-week month", wk.weekOffQuotaForMonth(2026, 9) === 5, `got ${wk.weekOffQuotaForMonth(2026, 9)}`);

step("Week-off structural invariants, every month 2024–2030");

let structural = 0;
for (let y = 2024; y <= 2030; y += 1) {
  for (let m = 1; m <= 12; m += 1) {
    const weeks = wk.getMonthWeeks(y, m);
    const total = wk.daysInMonth(y, m);

    const covered = weeks.reduce((sum, r) => sum + r.days, 0);
    if (covered !== total) { structural += 1; console.log(`        ${y}-${m}: covers ${covered}/${total} days`); }

    if (weeks[0].startDay !== 1) { structural += 1; console.log(`        ${y}-${m}: starts on ${weeks[0].startDay}`); }
    if (weeks[weeks.length - 1].endDay !== total) { structural += 1; console.log(`        ${y}-${m}: ends on ${weeks[weeks.length-1].endDay}`); }

    for (let i = 1; i < weeks.length; i += 1) {
      if (weeks[i].startDay !== weeks[i - 1].endDay + 1) {
        structural += 1; console.log(`        ${y}-${m}: gap before row ${i}`);
      }
    }
    // After merging, no row may still be a stub.
    if (weeks.some((r) => r.days <= 3)) { structural += 1; console.log(`        ${y}-${m}: stub row survived`); }
    // Quota is always 4 or 5 in a Gregorian month.
    if (weeks.length < 4 || weeks.length > 5) { structural += 1; console.log(`        ${y}-${m}: quota ${weeks.length}`); }
  }
}
check("84 months: rows tile the month with no gaps, stubs or stray quotas", structural === 0, `${structural} problem(s)`);

step("Week-off: a day maps back to its row");
check("1 Aug 2026 lands in the merged opening row", wk.weekIndexForDay(2026, 8, 1) === 0);
check("31 Aug 2026 lands in the merged closing row", wk.weekIndexForDay(2026, 8, 31) === 3);
check("a day outside the month has no row", wk.weekIndexForDay(2026, 8, 32) === null);

/* ========================== rule 2: advance =========================== */

// Structure is fixed by the handoff; these numbers are illustrative.
const S = {
  fullPaymentModes: ["Online", "Walk-in"],
  advanceTierThresholdCents: 150000,   // ₹1,500
  advanceAtOrBelowCents: 50000,        // ₹500
  advanceAboveCents: 100000,           // ₹1,000
  includedMinutes: 60,
  graceMinutes: 10,
  extensionBlockMinutes: 15,
  extensionBlockCents: 25000,          // ₹250
  graceMode: "gate",
};

step("Advance is tiered by price, and full for certain modes");
check("Online demands the whole price", bl.advanceRequirement(200000, "Online", S) === 200000);
check("Walk-in demands the whole price", bl.advanceRequirement(200000, "Walk-in", S) === 200000);
check("mode match is case-insensitive", bl.advanceRequirement(200000, "online", S) === 200000);
check("Offline below the threshold pays the low tier", bl.advanceRequirement(120000, "Offline", S) === 50000);
check("Offline exactly AT the threshold pays the low tier", bl.advanceRequirement(150000, "Offline", S) === 50000);
check("Offline above the threshold pays the high tier", bl.advanceRequirement(200000, "Offline", S) === 100000);
check("advance never exceeds the price itself", bl.advanceRequirement(30000, "Offline", S) === 30000);

/* =========================== rule 2: the bill ========================= */

step("Bill: base price, extension blocks, balance");

const onTime = bl.computeBill({ basePriceCents: 200000, actualMinutes: 55, advancePaidCents: 100000 }, S);
check("finishing early charges base only", onTime.totalCents === 200000 && onTime.extensionBlocks === 0);
check("balance is total minus advance", onTime.balanceDueCents === 100000);

const withinGrace = bl.computeBill({ basePriceCents: 200000, actualMinutes: 70 }, S);
check("overrun inside grace charges nothing extra", withinGrace.extensionBlocks === 0 && withinGrace.totalCents === 200000);

const atGraceEdge = bl.computeBill({ basePriceCents: 200000, actualMinutes: 71 }, S);
check("one minute past grace starts charging", atGraceEdge.extensionBlocks === 1, JSON.stringify(atGraceEdge));

const longRun = bl.computeBill({ basePriceCents: 200000, actualMinutes: 95 }, S);
check("35 min over bills 3 blocks of 15 (gate mode)", longRun.extensionBlocks === 3, JSON.stringify(longRun));
check("extension is priced per block", longRun.extensionCents === 75000);
check("total is base + extension", longRun.totalCents === 275000);

const deductMode = bl.computeBill({ basePriceCents: 200000, actualMinutes: 95 }, { ...S, graceMode: "deduct" });
check("deduct mode bills from the end of grace instead", deductMode.extensionBlocks === 2, JSON.stringify(deductMode));

step("Bill: refunds and partial blocks");
const overpaid = bl.computeBill({ basePriceCents: 200000, actualMinutes: 50, advancePaidCents: 250000 }, S);
check("an overpaid advance shows a refund, not a negative balance", overpaid.balanceDueCents === 0 && overpaid.refundDueCents === 50000);
const partial = bl.computeBill({ basePriceCents: 200000, actualMinutes: 76 }, S);
check("a part-used block is billed whole", partial.extensionBlocks === 2, JSON.stringify(partial));

// The same 100-minute session bills differently depending on what the
// service includes — which is the point of the override.
const long90 = bl.computeBill({ basePriceCents: 300000, actualMinutes: 100, includedMinutes: 90 }, S);
const long60 = bl.computeBill({ basePriceCents: 300000, actualMinutes: 100 }, S);
check("a 90-min service: 10 min over is inside grace, nothing extra", long90.extensionBlocks === 0, JSON.stringify(long90));
check("the same 100 min on a 60-min service bills 3 blocks", long60.extensionBlocks === 3, JSON.stringify(long60));
const over90 = bl.computeBill({ basePriceCents: 300000, actualMinutes: 110, includedMinutes: 90 }, S);
check("a 90-min service past grace bills 2 blocks", over90.extensionBlocks === 2, JSON.stringify(over90));

console.log(failures === 0 ? "\n✓ All business-rule checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
