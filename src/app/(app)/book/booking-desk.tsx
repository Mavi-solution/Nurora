"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Field,
  fieldClass,
  Pill,
} from "@/components/ui";
import { bookAppointment } from "@/lib/actions/appointments";
import { createClientRecord, findClients } from "@/lib/actions/clients";
import { formatMoney } from "@/lib/format";
import { addDaysToDateKey } from "@/lib/time";
import type {
  ClientSummary,
  CounsellorSummary,
  Profile,
  Specialism,
} from "@/lib/types";

type Step = 1 | 2 | 3;

type MatchedSlot = {
  counsellorId: string;
  counsellorName: string;
  startsAt: string;
  endsAt: string;
  label: string;
  durationMinutes: number;
  feeCents: number;
  currency: string;
};

const CHANNELS = [
  { value: "phone", label: "Phone call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "online", label: "Online" },
] as const;

export function BookingDesk({
  profile,
  specialisms,
  counsellors,
  languages,
  todayKey,
}: {
  profile: Profile;
  specialisms: Specialism[];
  counsellors: CounsellorSummary[];
  languages: string[];
  todayKey: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // -------------------------------------------------- step 1: the caller
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ClientSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const [draft, setDraft] = useState({
    fullName: "",
    phone: "",
    email: "",
    age: "",
    gender: "",
    preferredLanguage: "",
    presentingConcern: "",
  });

  // -------------------------------------------------- step 2: the match
  const [specialismId, setSpecialismId] = useState("");
  const [language, setLanguage] = useState("");
  const [counsellorId, setCounsellorId] = useState("");
  const [date, setDate] = useState(todayKey);
  const [slots, setSlots] = useState<MatchedSlot[]>([]);
  const [nextDays, setNextDays] = useState<{ date: string; count: number }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<MatchedSlot | null>(null);

  // -------------------------------------------------- step 3: confirming
  const [channel, setChannel] = useState<string>("phone");
  const [bookingNotes, setBookingNotes] = useState("");

  /* ---------------------------------------------------- caller lookup */

  const runSearch = useCallback(async (term: string) => {
    if (term.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const result = await findClients(term);
    setResults(result.ok ? (result.data as ClientSummary[]) : []);
    setSearching(false);
  }, []);

  // Debounced so a desk typing a phone number does not fire 10 queries.
  useEffect(() => {
    const id = setTimeout(() => void runSearch(search), 300);
    return () => clearTimeout(id);
  }, [search, runSearch]);

  function chooseClient(existing: ClientSummary) {
    setClient(existing);
    setCreatingNew(false);
    setError(null);
    // Carry what we know about them into the match step.
    if (existing.preferred_language) setLanguage(existing.preferred_language);
    if (existing.counsellor_id) setCounsellorId(existing.counsellor_id);
    setStep(2);
  }

  function startNewClient() {
    setCreatingNew(true);
    setClient(null);
    // A phone number typed into search is almost always the caller's.
    const digits = search.replace(/\D/g, "");
    setDraft((d) => ({
      ...d,
      phone: digits.length >= 6 ? search.trim() : d.phone,
      fullName: digits.length >= 6 ? d.fullName : search.trim(),
    }));
  }

  function saveNewClient() {
    setError(null);
    if (draft.fullName.trim().length < 2) return setError("Enter the caller's name.");
    if (!draft.phone.trim() && !draft.email.trim()) {
      return setError("Capture a phone number or email so we can send reminders.");
    }

    startTransition(async () => {
      const result = await createClientRecord({
        fullName: draft.fullName,
        phone: draft.phone,
        email: draft.email,
        age: draft.age ? Number(draft.age) : null,
        gender: draft.gender,
        preferredLanguage: draft.preferredLanguage,
        presentingConcern: draft.presentingConcern,
      });

      if (!result.ok) return setError(result.error);

      setClient({
        id: result.data.id,
        full_name: result.data.fullName,
        age: draft.age ? Number(draft.age) : null,
        email: draft.email || null,
        phone: draft.phone || null,
        user_id: null,
        preferred_language: draft.preferredLanguage || null,
        presenting_concern: draft.presentingConcern || null,
        counsellor_id: null,
      });
      if (draft.preferredLanguage) setLanguage(draft.preferredLanguage);
      setCreatingNew(false);
      setStep(2);
    });
  }

  /* ------------------------------------------------- availability search */

  useEffect(() => {
    if (step !== 2) return;

    let cancelled = false;
    setLoadingSlots(true);
    setSlot(null);

    const params = new URLSearchParams({ date });
    if (specialismId) params.set("specialism", specialismId);
    if (language) params.set("language", language);
    if (counsellorId) params.set("counsellor", counsellorId);

    fetch(`/api/availability-search?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSlots(data.slots ?? []);
        setNextDays(data.nextDays ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setNextDays([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });

    return () => {
      cancelled = true;
    };
  }, [step, date, specialismId, language, counsellorId]);

  /* ------------------------------------------------------------ booking */

  function confirmBooking() {
    if (!client || !slot) return;
    setError(null);

    startTransition(async () => {
      const result = await bookAppointment({
        counsellorId: slot.counsellorId,
        clientId: client.id,
        startsAt: slot.startsAt,
        durationMinutes: slot.durationMinutes,
        priceCents: slot.feeCents,
        channel,
        bookingNotes,
        clientNotes: client.presenting_concern ?? undefined,
      });

      if (!result.ok) {
        setError(result.error);
        // The slot may have gone in the meantime — send them back to pick again.
        setStep(2);
        return;
      }

      router.push(`/appointments/${result.data.id}?booked=1`);
    });
  }

  const byCounsellor = slots.reduce<Record<string, MatchedSlot[]>>((acc, s) => {
    (acc[s.counsellorName] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl pb-16">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Book a session
        </h1>
        <p className="text-[13px] text-muted mt-0.5">
          Take the caller&apos;s details, match them to a counsellor, confirm the slot.
        </p>
      </div>

      <StepBar step={step} onBack={setStep} clientName={client?.full_name} />

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* ============================================ 1. who is calling */}
      {step === 1 && (
        <Card>
          <div className="px-5 py-5 space-y-4">
            <Field
              label="Find the caller"
              hint="Search by phone number, name or email. Check here first — it stops a duplicate record every time they ring."
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={fieldClass}
                placeholder="98765 43210, or Ravi"
                autoFocus
              />
            </Field>

            {searching && <p className="text-[13px] text-muted">Searching…</p>}

            {!searching && results.length > 0 && (
              <ul className="divide-y divide-[var(--border)] border border-hairline rounded-xl overflow-hidden">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => chooseClient(r)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-card-muted transition-colors"
                    >
                      <Avatar name={r.full_name} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium truncate">
                          {r.full_name}
                        </span>
                        <span className="block text-[12px] text-muted truncate">
                          {[r.phone, r.email].filter(Boolean).join(" · ") ||
                            "No contact details"}
                        </span>
                      </span>
                      {r.age != null && <Pill>{r.age} yrs</Pill>}
                      <span className="text-[12px] text-brand-700 dark:text-brand-300">
                        Select
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!searching && search.trim().length >= 3 && results.length === 0 && (
              <Alert tone="info">
                No existing record matches “{search.trim()}”. Add them as a new
                client below.
              </Alert>
            )}

            {!creatingNew && (
              <Button variant="secondary" onClick={startNewClient}>
                New client
              </Button>
            )}

            {creatingNew && (
              <div className="rounded-xl border border-hairline bg-card-muted p-4 space-y-4">
                <p className="text-[13px] font-medium">New client details</p>

                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Full name" required>
                    <input
                      value={draft.fullName}
                      onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                      className={fieldClass}
                      placeholder="Ravi Kumar"
                    />
                  </Field>
                  <Field label="Phone" hint="Reminders go here.">
                    <input
                      value={draft.phone}
                      onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                      className={fieldClass}
                      placeholder="+91 98765 43210"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                      className={fieldClass}
                      placeholder="ravi@example.com"
                    />
                  </Field>
                  <Field label="Age">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={draft.age}
                      onChange={(e) => setDraft({ ...draft, age: e.target.value })}
                      className={fieldClass}
                      placeholder="36"
                    />
                  </Field>
                  <Field label="Gender">
                    <input
                      value={draft.gender}
                      onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
                      className={fieldClass}
                      placeholder="Optional"
                    />
                  </Field>
                  <Field label="Preferred language">
                    <select
                      value={draft.preferredLanguage}
                      onChange={(e) =>
                        setDraft({ ...draft, preferredLanguage: e.target.value })
                      }
                      className={fieldClass}
                    >
                      <option value="">No preference</option>
                      {languages.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field
                  label="What do they need help with?"
                  hint="In their own words — it goes to the counsellor before the session."
                >
                  <textarea
                    value={draft.presentingConcern}
                    onChange={(e) =>
                      setDraft({ ...draft, presentingConcern: e.target.value })
                    }
                    rows={3}
                    className={`${fieldClass} resize-y`}
                    placeholder="Trouble sleeping and constant worry about work."
                  />
                </Field>

                <div className="flex gap-2">
                  <Button onClick={saveNewClient} disabled={pending}>
                    {pending ? "Saving…" : "Save and continue"}
                  </Button>
                  <Button variant="ghost" onClick={() => setCreatingNew(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ========================================= 2. match a counsellor */}
      {step === 2 && client && (
        <div className="space-y-4">
          <Card>
            <div className="px-5 py-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Needs help with">
                <select
                  value={specialismId}
                  onChange={(e) => setSpecialismId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Any specialism</option>
                  {specialisms.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Language">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Any language</option>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Counsellor">
                <select
                  value={counsellorId}
                  onChange={(e) => setCounsellorId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Anyone available</option>
                  {counsellors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={date}
                  min={todayKey}
                  onChange={(e) => setDate(e.target.value)}
                  className={fieldClass}
                />
              </Field>
            </div>

            <div className="px-5 pb-3 flex flex-wrap gap-2">
              {[0, 1, 2, 7].map((offset) => {
                const key = addDaysToDateKey(todayKey, offset);
                const label =
                  offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : `+${offset}d`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDate(key)}
                    className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                      date === key
                        ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-400/10 dark:text-brand-100"
                        : "border-hairline text-muted hover:bg-card-muted"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="px-5 py-4">
              {loadingSlots ? (
                <p className="text-[13px] text-muted py-4">Checking availability…</p>
              ) : slots.length === 0 ? (
                <div className="py-4">
                  <p className="text-[14px] font-medium">
                    Nothing free on {date} for that combination.
                  </p>
                  <p className="text-[13px] text-muted mt-1">
                    Widen the filters, or offer the caller one of these:
                  </p>
                  {nextDays.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {nextDays.map((d) => (
                        <button
                          key={d.date}
                          type="button"
                          onClick={() => setDate(d.date)}
                          className="rounded-full border border-hairline px-3.5 py-1.5 text-[13px] hover:bg-card-muted transition-colors"
                        >
                          {d.date} · {d.count} free
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted mt-3">
                      Nothing in the next two weeks either — try another
                      specialism or language.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  {Object.entries(byCounsellor).map(([name, list]) => (
                    <div key={name}>
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar name={name} size={26} />
                        <span className="text-[14px] font-medium">{name}</span>
                        <span className="text-[12px] text-muted">
                          {list.length} free
                        </span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                        {list.map((s) => {
                          const selected = slot?.startsAt === s.startsAt &&
                            slot?.counsellorId === s.counsellorId;
                          return (
                            <button
                              key={`${s.counsellorId}-${s.startsAt}`}
                              type="button"
                              onClick={() => setSlot(s)}
                              className={`h-9 rounded-lg border text-[13px] tabular-nums transition-colors ${
                                selected
                                  ? "bg-brand-600 border-brand-600 text-white font-medium"
                                  : "border-hairline bg-card hover:bg-card-muted text-muted"
                              }`}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={!slot} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* ================================================= 3. confirming */}
      {step === 3 && client && slot && (
        <div className="space-y-4">
          <Card>
            <div className="px-5 py-5 space-y-4">
              <Summary label="Client" value={client.full_name} />
              <Summary
                label="Contact"
                value={[client.phone, client.email].filter(Boolean).join(" · ") || "—"}
              />
              {client.presenting_concern && (
                <Summary label="Concern" value={client.presenting_concern} />
              )}
              <Summary label="Counsellor" value={slot.counsellorName} />
              <Summary
                label="When"
                value={new Intl.DateTimeFormat("en-GB", {
                  timeZone: profile.timezone,
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                }).format(new Date(slot.startsAt))}
              />
              <Summary
                label="Length"
                value={`${slot.durationMinutes} minutes`}
              />
              <Summary
                label="Fee"
                value={formatMoney(slot.feeCents, slot.currency)}
              />
            </div>
          </Card>

          <Card>
            <div className="px-5 py-5 space-y-4">
              <Field label="How did this booking come in?">
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className={fieldClass}
                >
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Notes from the call"
                hint="Anything the counsellor should know. Not a clinical note."
              >
                <textarea
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  rows={3}
                  className={`${fieldClass} resize-y`}
                  placeholder="Prefers a call before the session. Asked for a female counsellor."
                />
              </Field>

              <Alert tone="info">
                Both {client.full_name} and {slot.counsellorName} get a reminder
                three days before this session.
              </Alert>
            </div>
          </Card>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={pending}>
              Back
            </Button>
            <Button onClick={confirmBooking} disabled={pending}>
              {pending ? "Booking…" : "Confirm booking"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepBar({
  step,
  onBack,
  clientName,
}: {
  step: Step;
  onBack: (s: Step) => void;
  clientName?: string;
}) {
  const steps = [
    { n: 1 as Step, label: clientName && step > 1 ? clientName : "Caller" },
    { n: 2 as Step, label: "Counsellor & time" },
    { n: 3 as Step, label: "Confirm" },
  ];

  return (
    <ol className="flex items-center gap-2 mb-5">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2">
          <button
            type="button"
            disabled={s.n >= step}
            onClick={() => onBack(s.n)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              s.n === step
                ? "border-brand-500 bg-brand-50 text-brand-800 font-medium dark:bg-brand-400/10 dark:text-brand-100"
                : s.n < step
                  ? "border-hairline text-muted hover:bg-card-muted"
                  : "border-hairline text-faint"
            }`}
          >
            <span
              className={`size-5 rounded-full grid place-items-center text-[11px] font-semibold ${
                s.n <= step ? "bg-brand-600 text-white" : "bg-[var(--border)] text-faint"
              }`}
            >
              {s.n < step ? "✓" : s.n}
            </span>
            <span className="max-w-40 truncate">{s.label}</span>
          </button>
          {i < steps.length - 1 && (
            <span className="w-4 h-px bg-[var(--border-strong)]" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-[14px]">
      <span className="text-muted w-28 shrink-0">{label}</span>
      <span className="min-w-0 font-medium break-words">{value}</span>
    </div>
  );
}
