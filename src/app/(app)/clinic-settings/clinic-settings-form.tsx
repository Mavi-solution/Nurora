"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Field, fieldClass } from "@/components/ui";
import { updateClinicSettings } from "@/lib/actions/settings-admin";
import { WEEKDAYS } from "@/lib/time";
import type { ClinicSettings } from "@/lib/types";

const MODES = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "offline_walk_in", label: "Offline - Walk-in" },
];

/**
 * The clinic's configuration. Admin only.
 *
 * The advance tiers and extension billing live here rather than in
 * environment variables, so changing a price no longer needs a
 * redeploy. The formula SHAPE is fixed by ARCHITECTURE.md rule 2 — these
 * are only the amounts it works on.
 */
export function ClinicSettingsForm({ settings }: { settings: ClinicSettings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rupees = (cents: number) => String(cents / 100);

  const [f, setF] = useState({
    practiceName: settings.practice_name,
    advanceTierThreshold: rupees(settings.advance_tier_threshold_cents),
    advanceAtOrBelow: rupees(settings.advance_at_or_below_cents),
    advanceAbove: rupees(settings.advance_above_cents),
    fullPaymentModes: settings.full_payment_modes,
    openWeekdays: settings.open_weekdays?.length
      ? settings.open_weekdays
      : [0, 1, 2, 3, 4, 5, 6],
    includedMinutes: String(settings.included_minutes),
    graceMinutes: String(settings.grace_minutes),
    extensionBlockMinutes: String(settings.extension_block_minutes),
    extensionBlockPrice: rupees(settings.extension_block_cents),
    graceMode: settings.grace_mode,
    clinicLatitude: settings.clinic_latitude?.toString() ?? "",
    clinicLongitude: settings.clinic_longitude?.toString() ?? "",
    checkInRadiusM: String(settings.check_in_radius_m),
    checkOutRadiusM: String(settings.check_out_radius_m),
    geofenceEnforced: settings.geofence_enforced,
    signinQuote: settings.signin_quote ?? "",
    designerCreditUrl: settings.designer_credit_url ?? "",
    nulancerIndividual: rupees(settings.nulancer_individual_cents),
    nulancerCouple: rupees(settings.nulancer_couple_cents),
    reviewMonthlyTarget: String(settings.review_monthly_target),
  });

  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function save() {
    setError(null); setNotice(null);
    startTransition(async () => {
      const result = await updateClinicSettings({
        ...f,
        clinicLatitude: f.clinicLatitude === "" ? null : Number(f.clinicLatitude),
        clinicLongitude: f.clinicLongitude === "" ? null : Number(f.clinicLongitude),
      });
      if (!result.ok) setError(result.error);
      else { setNotice("Settings saved."); router.refresh(); }
    });
  }

  const tiersUnset =
    Number(f.advanceAtOrBelow) === 0 && Number(f.advanceAbove) === 0;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Clinic settings</h1>
        <p className="text-[13px] text-muted mt-0.5">
          Pricing rules, the attendance geofence and sign-in copy. Admin only.
        </p>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}
      {tiersUnset && (
        <div className="mb-4">
          <Alert tone="error">
            Advance tiers are both zero, so only Online and Walk-in bookings
            ask for anything upfront. Set them before taking real bookings.
          </Alert>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader title="Practice" />
        <div className="px-5 py-4 space-y-4">
          <Field label="Practice name" hint="Used in every client message.">
            <input value={f.practiceName} onChange={(e) => set("practiceName", e.target.value)} className={fieldClass} />
          </Field>

          {/*
            Which days the practice opens at all.

            This is NOT the same as "nobody has set hours on a Sunday",
            though the two used to look identical to the booking desk.
            Saying it explicitly is what lets the availability editor
            stop offering to add hours on a closed day, and lets every
            calendar paint it shut rather than merely empty.
          */}
          <div>
            <span className="block text-[13px] font-medium mb-1.5">Open days</span>
            <p className="text-[12px] text-faint mb-2">
              Days the clinic opens. No slot is ever offered on a day that is
              off, and working hours cannot be set on one.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((name, weekday) => {
                const on = f.openWeekdays.includes(weekday);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set(
                        "openWeekdays",
                        on
                          ? f.openWeekdays.filter((d) => d !== weekday)
                          : [...f.openWeekdays, weekday].sort((a, b) => a - b),
                      )
                    }
                    className={`h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                      on
                        ? "bg-brand-700 border-brand-700 text-white font-medium"
                        : "border-hairline text-muted hover:bg-card-muted"
                    }`}
                  >
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {f.openWeekdays.length === 0 && (
              <p className="text-[12px] text-red-600 dark:text-red-400 mt-2">
                The clinic has to open on at least one day.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Advance payment"
          description="A service has one price; the advance is worked out from it. Not set per service."
        />
        <div className="px-5 py-4 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Threshold (₹)" hint="Which tier applies.">
              <input type="number" min={0} value={f.advanceTierThreshold} onChange={(e) => set("advanceTierThreshold", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="At or below (₹)">
              <input type="number" min={0} value={f.advanceAtOrBelow} onChange={(e) => set("advanceAtOrBelow", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Above (₹)">
              <input type="number" min={0} value={f.advanceAbove} onChange={(e) => set("advanceAbove", e.target.value)} className={fieldClass} />
            </Field>
          </div>

          <div>
            <span className="block text-[13px] font-medium mb-1.5">
              Modes that require the full price upfront
            </span>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => {
                const on = f.fullPaymentModes.includes(m.value);
                return (
                  <button key={m.value} type="button"
                    onClick={() => set("fullPaymentModes", on
                      ? f.fullPaymentModes.filter((x) => x !== m.value)
                      : [...f.fullPaymentModes, m.value])}
                    aria-pressed={on}
                    className={`h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                      on ? "bg-brand-700 border-brand-700 text-white font-medium" : "border-hairline hover:bg-card-muted"
                    }`}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-faint mt-1.5">These skip the tiers entirely.</p>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Session length and extensions" />
        <div className="px-5 py-4 space-y-4">
          <div className="grid sm:grid-cols-4 gap-3">
            <Field label="Included minutes">
              <input type="number" min={5} max={480} value={f.includedMinutes} onChange={(e) => set("includedMinutes", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Grace minutes">
              <input type="number" min={0} value={f.graceMinutes} onChange={(e) => set("graceMinutes", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Block minutes">
              <input type="number" min={1} value={f.extensionBlockMinutes} onChange={(e) => set("extensionBlockMinutes", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Block price (₹)">
              <input type="number" min={0} value={f.extensionBlockPrice} onChange={(e) => set("extensionBlockPrice", e.target.value)} className={fieldClass} />
            </Field>
          </div>
          <Field
            label="How grace behaves once exceeded"
            hint="On a 60-minute session running 95 minutes: gate bills 3 blocks, deduct bills 2."
          >
            <select value={f.graceMode} onChange={(e) => set("graceMode", e.target.value)} className={fieldClass}>
              <option value="gate">Gate — bill from the end of the included time</option>
              <option value="deduct">Deduct — the grace minutes are free too</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Attendance geofence"
          description="Check-in is strict because you are arriving; check-out is lenient because someone may step out to a home visit. The two differ on purpose."
        />
        <div className="px-5 py-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Clinic latitude">
              <input value={f.clinicLatitude} onChange={(e) => set("clinicLatitude", e.target.value)} className={fieldClass} placeholder="13.0827" />
            </Field>
            <Field label="Clinic longitude">
              <input value={f.clinicLongitude} onChange={(e) => set("clinicLongitude", e.target.value)} className={fieldClass} placeholder="80.2707" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Check-in radius (m)">
              <input type="number" min={10} max={5000} value={f.checkInRadiusM} onChange={(e) => set("checkInRadiusM", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Check-out radius (m)">
              <input type="number" min={10} max={50000} value={f.checkOutRadiusM} onChange={(e) => set("checkOutRadiusM", e.target.value)} className={fieldClass} />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={f.geofenceEnforced}
              onChange={(e) => set("geofenceEnforced", e.target.checked)}
              className="size-4 rounded accent-brand-600" />
            <span className="text-[13px]">
              Enforce the geofence — staff must be near the clinic to check in
            </span>
          </label>
          <p className="text-[12px] text-faint">
            Off, or without coordinates, location is ignored entirely.
          </p>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="NuLancer rates and review target" />
        <div className="px-5 py-4 grid sm:grid-cols-3 gap-3">
          <Field label="Individual session (₹)">
            <input type="number" min={0} value={f.nulancerIndividual} onChange={(e) => set("nulancerIndividual", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Couple session (₹)">
            <input type="number" min={0} value={f.nulancerCouple} onChange={(e) => set("nulancerCouple", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Reviews per counsellor / month">
            <input type="number" min={0} value={f.reviewMonthlyTarget} onChange={(e) => set("reviewMonthlyTarget", e.target.value)} className={fieldClass} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Sign-in screen" />
        <div className="px-5 py-4 space-y-4">
          <Field label="Quote">
            <input value={f.signinQuote} onChange={(e) => set("signinQuote", e.target.value)} className={fieldClass} placeholder="Always believe something wonderful…" />
          </Field>
          <Field label="Designer credit link">
            <input value={f.designerCreditUrl} onChange={(e) => set("designerCreditUrl", e.target.value)} className={fieldClass} placeholder="https://…" />
          </Field>
        </div>
      </Card>

      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}
