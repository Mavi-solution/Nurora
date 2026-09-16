"use client";

import Link from "next/link";
import { ValidatedField } from "@/components/validated-field";
import { validators } from "@/lib/validation";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import {
  Alert, Avatar, Button, Card, CardHeader, Field, Pill, Stat, fieldClass,
} from "@/components/ui";
import {
  resetCounsellorPassword, setCounsellorActive, updateCounsellor,
} from "@/lib/actions/counsellors";
import { setUserAdmin, setUserRole } from "@/lib/actions/profile";
import {
  grantBenefit, revokeBenefit, setCounsellorPermission, setNulancer,
} from "@/lib/actions/settings-admin";
import { formatMoney } from "@/lib/format";
import type {
  Benefit, CounsellorPermissions, PermissionKey, Profile, Specialism, UserRole,
} from "@/lib/types";

/** The per-feature switches, with what each one hides. */
const PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: "attendance", label: "Attendance" },
  { key: "nubills", label: "Nubills" },
  { key: "persona", label: "Persona" },
  { key: "bric", label: "BRIC" },
  { key: "reviews", label: "Google Reviews" },
  { key: "follow_ups", label: "Follow-up & Commitments" },
  { key: "my_summary", label: "My Summary" },
  { key: "week_offs", label: "Week-offs" },
];

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: "counsellor", label: "Counsellor", hint: "Runs sessions and holds a lane on the schedule." },
  { value: "support", label: "Booking desk", hint: "Runs the diary. Never sees clinical notes." },
  { value: "admin", label: "Admin (back office)", hint: "Administers the practice but does NOT appear as a counsellor." },
  { value: "client", label: "Client", hint: "Read-only view of their own sessions." },
];

/**
 * Edit one counsellor.
 *
 * Role and the admin flag are separate on purpose: admin is a FLAG, so
 * a practising counsellor can administer the practice while keeping
 * their lane on the schedule. Setting role = 'admin' instead makes
 * someone back-office and takes them off the roster — which is why that
 * option says so plainly rather than looking like a promotion.
 */
export function CounsellorEditor({
  counsellor, specialisms, selectedSpecialismIds, viewerIsAdmin, viewerId,
  permissions, benefits, appointmentCount, upcomingCount,
}: {
  counsellor: Profile;
  specialisms: Specialism[];
  selectedSpecialismIds: string[];
  viewerIsAdmin: boolean;
  viewerId: string;
  permissions: CounsellorPermissions;
  benefits: Benefit[];
  appointmentCount: number;
  upcomingCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(counsellor.full_name);
  const [phone, setPhone] = useState(counsellor.phone ?? "");
  const [headline, setHeadline] = useState(counsellor.headline ?? "");
  const [bio, setBio] = useState(counsellor.bio ?? "");
  const [timezone, setTimezone] = useState(counsellor.timezone);
  const [languages, setLanguages] = useState(counsellor.languages.join(", "));
  const [sessionFee, setSessionFee] = useState(String(counsellor.default_session_fee_cents / 100));
  const [duration, setDuration] = useState(String(counsellor.default_duration_minutes));
  const [currency, setCurrency] = useState(counsellor.currency);
  const [skills, setSkills] = useState<string[]>(selectedSpecialismIds);

  // Role and the admin flag are optimistic: they are controlled by
  // server state, and without a local copy the control snaps back to its
  // old value until the round-trip and refresh land, which reads as the
  // click having been ignored. Reverted if the write is rejected.
  const [role, setRole] = useState<UserRole>(counsellor.role);
  const [adminFlag, setAdminFlag] = useState(counsellor.is_admin);
  useEffect(() => setRole(counsellor.role), [counsellor.role]);
  useEffect(() => setAdminFlag(counsellor.is_admin), [counsellor.is_admin]);

  const [perms, setPerms] = useState(permissions);
  useEffect(() => setPerms(permissions), [permissions]);

  const [isNulancer, setIsNulancer] = useState(counsellor.is_nulancer);
  useEffect(() => setIsNulancer(counsellor.is_nulancer), [counsellor.is_nulancer]);
  const [rateIndividual, setRateIndividual] = useState(
    counsellor.nulancer_individual_cents != null
      ? String(counsellor.nulancer_individual_cents / 100) : "",
  );
  const [rateCouple, setRateCouple] = useState(
    counsellor.nulancer_couple_cents != null
      ? String(counsellor.nulancer_couple_cents / 100) : "",
  );
  const [benefitOpen, setBenefitOpen] = useState(false);
  const [benefitName, setBenefitName] = useState("");
  const [benefitDetail, setBenefitDetail] = useState("");

  const [pwOpen, setPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const isSelf = counsellor.id === viewerId;

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
    onFail?: () => void,
  ) {
    setError(null); setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        onFail?.();
      } else {
        setNotice(ok); setPwOpen(false); setNewPassword(""); router.refresh();
      }
    });
  }

  function saveProfile() {
    run(
      () =>
        updateCounsellor(counsellor.id, {
          fullName, phone, headline, bio, timezone, currency,
          languages: languages.split(",").map((l) => l.trim()).filter(Boolean),
          sessionFee: Number(sessionFee),
          durationMinutes: Number(duration),
          specialismIds: skills,
        }),
      "Profile saved.",
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/counsellors" className="text-[13px] text-muted hover:text-body">
        ← Counsellors
      </Link>

      <div className="flex items-start gap-4 mt-3 mb-6">
        <Avatar name={counsellor.full_name} url={counsellor.avatar_url} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {counsellor.full_name || "Unnamed"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Pill>{counsellor.role}</Pill>
            {counsellor.is_admin && <Pill>Admin</Pill>}
            {!counsellor.is_active && <Pill>Not taking bookings</Pill>}
            <span className="text-[12px] text-muted">{counsellor.email}</span>
          </div>
        </div>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Sessions" value={String(appointmentCount)} sub="all time" />
        <Stat label="Upcoming" value={String(upcomingCount)} />
        <Stat label="Specialisms" value={String(skills.length)} />
      </div>

      {/* ------------------------------------------------------ profile */}
      <Card className="mb-4">
        <CardHeader title="Profile" description="What clients and the booking desk see." />
        <div className="px-5 py-4 space-y-4">
          <Field label="Full name" required>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldClass} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <ValidatedField
              label="Phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={setPhone}
              validate={validators.phone()}
            />
            <Field label="Timezone">
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={fieldClass} />
            </Field>
          </div>
          <Field label="Headline" hint="One line, shown under their name.">
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Bio">
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className={`${fieldClass} resize-y`} />
          </Field>
          <Field label="Languages" hint="Comma separated. Used to match callers at the booking desk.">
            <input value={languages} onChange={(e) => setLanguages(e.target.value)} className={fieldClass} placeholder="English, Tamil" />
          </Field>

          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Session fee">
              <input type="number" min={0} step={50} value={sessionFee} onChange={(e) => setSessionFee(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Minutes">
              <input type="number" min={5} max={480} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Currency">
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} className={fieldClass} />
            </Field>
          </div>

          <div>
            <span className="block text-[13px] font-medium mb-1.5">Specialisms</span>
            <div className="flex flex-wrap gap-2">
              {specialisms.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    setSkills((prev) =>
                      prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                    )
                  }
                  aria-pressed={skills.includes(s.id)}
                  className={`h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                    skills.includes(s.id)
                      ? "bg-brand-700 border-brand-700 text-white font-medium"
                      : "border-hairline hover:bg-card-muted"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={saveProfile} disabled={pending || fullName.trim().length < 2}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </Card>

      {/* ------------------------------------------------ availability */}
      <Card className="mb-4">
        <CardHeader
          title="Taking bookings"
          description="Turn off to keep them on the roster but out of the booking search."
        />
        <div className="px-5 py-4 flex items-center gap-3">
          <Button
            variant={counsellor.is_active ? "secondary" : "primary"}
            disabled={pending}
            onClick={() =>
              run(
                () => setCounsellorActive(counsellor.id, !counsellor.is_active),
                counsellor.is_active ? "No longer taking bookings." : "Taking bookings again.",
              )
            }
          >
            {counsellor.is_active ? "Stop taking bookings" : "Resume taking bookings"}
          </Button>
          <Link href={`/availability?counsellor=${counsellor.id}`} className="text-[13px] text-brand-700 dark:text-brand-300 hover:underline">
            Edit working hours →
          </Link>
        </div>
      </Card>

      {/* ------------------------------------------------------- access */}
      {viewerIsAdmin && (
        <Card>
          <CardHeader title="Access" description="Admin only." />
          <div className="px-5 py-4 space-y-4">
            <Field label="Role">
              <select
                value={role}
                disabled={pending || isSelf}
                onChange={(e) => {
                  const next = e.target.value as UserRole;
                  const previous = role;
                  setRole(next);
                  run(
                    () => setUserRole(counsellor.id, next),
                    "Role updated.",
                    () => setRole(previous),
                  );
                }}
                className={fieldClass}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            <p className="text-[12px] text-muted -mt-2">
              {ROLES.find((r) => r.value === role)?.hint}
            </p>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={adminFlag}
                disabled={pending || isSelf}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAdminFlag(next);
                  run(
                    () => setUserAdmin(counsellor.id, next),
                    next ? "Admin rights granted." : "Admin rights revoked.",
                    () => setAdminFlag(!next),
                  );
                }}
                className="size-4 rounded accent-brand-600"
              />
              <span className="text-[13px]">
                Admin rights — independent of role, so a counsellor can also administer the practice
              </span>
            </label>

            {isSelf && (
              <Alert tone="info">
                You cannot change your own role or admin rights — that is what
                stops the last admin locking everyone out.
              </Alert>
            )}

            <div className="pt-2 border-t border-hairline">
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => setPwOpen(true)}>
                Set a temporary password
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------ permissions */}
      {viewerIsAdmin && (
        <Card className="mt-4">
          <CardHeader
            title="Feature access"
            description="Switch a feature off and it disappears from their drawer. Everything is on unless switched off."
          />
          <div className="px-5 py-4 grid sm:grid-cols-2 gap-3">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={perms[p.key]}
                  disabled={pending}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPerms((prev: CounsellorPermissions) => ({ ...prev, [p.key]: next }));
                    run(
                      () => setCounsellorPermission(counsellor.id, p.key, next),
                      `${p.label} ${next ? "enabled" : "hidden"}.`,
                      () => setPerms((prev: CounsellorPermissions) => ({ ...prev, [p.key]: !next })),
                    );
                  }}
                  className="size-4 rounded accent-brand-600"
                />
                <span className="text-[13px]">{p.label}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      {/* -------------------------------------------------- NuLancer */}
      {viewerIsAdmin && (
        <Card className="mt-4">
          <CardHeader
            title="NuLancer"
            description="A freelance counsellor paid per completed session rather than salaried."
          />
          <div className="px-5 py-4 space-y-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isNulancer}
                disabled={pending}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIsNulancer(next);
                  run(
                    () => setNulancer(counsellor.id, {
                      isNulancer: next,
                      individual: rateIndividual ? Number(rateIndividual) : undefined,
                      couple: rateCouple ? Number(rateCouple) : undefined,
                    }),
                    next ? "Marked as a NuLancer." : "No longer a NuLancer.",
                    () => setIsNulancer(!next),
                  );
                }}
                className="size-4 rounded accent-brand-600"
              />
              <span className="text-[13px]">This counsellor is a NuLancer</span>
            </label>

            {isNulancer && (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Individual session (₹)">
                    <input type="number" min={0} value={rateIndividual}
                      onChange={(e) => setRateIndividual(e.target.value)} className={fieldClass} />
                  </Field>
                  <Field label="Couple session (₹)">
                    <input type="number" min={0} value={rateCouple}
                      onChange={(e) => setRateCouple(e.target.value)} className={fieldClass} />
                  </Field>
                </div>
                <Button variant="secondary" size="sm" disabled={pending}
                  onClick={() => run(() => setNulancer(counsellor.id, {
                    isNulancer: true,
                    individual: rateIndividual ? Number(rateIndividual) : undefined,
                    couple: rateCouple ? Number(rateCouple) : undefined,
                  }), "Rates saved.")}>
                  Save rates
                </Button>

                <div className="pt-3 border-t border-hairline">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[13px] font-medium">Special benefits</span>
                    <Button variant="secondary" size="sm" onClick={() => setBenefitOpen(true)}>
                      Grant a benefit
                    </Button>
                  </div>
                  {benefits.length === 0 ? (
                    <p className="text-[13px] text-muted">None granted.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {benefits.map((b) => (
                        <li key={b.id} className="flex items-center gap-2 text-[13px]">
                          <span className="flex-1">
                            {b.name}
                            {b.value_cents != null && (
                              <span className="text-muted"> · {formatMoney(b.value_cents)}</span>
                            )}
                            {b.expires_on && <span className="text-faint"> · to {b.expires_on}</span>}
                          </span>
                          <button type="button" disabled={pending}
                            onClick={() => run(() => revokeBenefit(b.id), "Benefit revoked.")}
                            className="text-[12px] text-faint hover:text-red-600">
                            Revoke
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      <Dialog
        open={benefitOpen}
        onClose={() => setBenefitOpen(false)}
        title="Grant a benefit"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setBenefitOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={pending || benefitName.trim().length < 2}
              onClick={() => run(() => grantBenefit({
                counsellorId: counsellor.id, name: benefitName, detail: benefitDetail,
              }), "Benefit granted.")}>
              Grant
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Benefit" required>
            <input value={benefitName} onChange={(e) => setBenefitName(e.target.value)} className={fieldClass} placeholder="Supervision hours" />
          </Field>
          <Field label="Detail">
            <textarea value={benefitDetail} onChange={(e) => setBenefitDetail(e.target.value)} rows={3} className={`${fieldClass} resize-y`} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={`Temporary password for ${counsellor.full_name}`}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={pending || newPassword.length < 8}
              onClick={() => run(() => resetCounsellorPassword(counsellor.id, newPassword), "Password set — pass it on securely.")}
            >
              Set password
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted leading-relaxed">
            They can change it under Settings once signed in. Hand it over in
            person or by a channel you trust — not the same email you send
            their username to.
          </p>
          <Field label="Temporary password" required hint="At least 8 characters.">
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={fieldClass}
              autoFocus
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
