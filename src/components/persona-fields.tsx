"use client";

import { useState } from "react";
import { Field, fieldClass } from "@/components/ui";
import { LANGUAGES, withCurrent } from "@/lib/options";
import { personaState } from "@/lib/business/persona";
import type { Client } from "@/lib/types";

export type PersonaDraft = {
  background: string;
  presentingConcern: string;
  referralSource: string;
  preferredLanguage: string;
  address: string;
  area: string;
  education: string;
  occupation: string;
};

export function emptyPersonaDraft(client?: Partial<Client> | null): PersonaDraft {
  return {
    background: client?.background ?? "",
    presentingConcern: client?.presenting_concern ?? "",
    referralSource: client?.referral_source ?? "",
    preferredLanguage: client?.preferred_language ?? "",
    address: client?.address ?? "",
    area: client?.area ?? "",
    education: client?.education ?? "",
    occupation: client?.occupation ?? "",
  };
}

/** How they heard of the clinic. Free text stays available underneath. */
const REFERRAL_SOURCES = [
  "Doctor or hospital referral",
  "Friend or family",
  "A previous client",
  "Google or web search",
  "Social media",
  "Walk-in",
  "School or college",
  "Employer or EAP",
  "Other",
];

/**
 * The Persona intake form.
 *
 * Shared by the session milestone and the client record so the two can
 * never drift into asking different questions — the whole value of an
 * intake form is that everyone's is comparable.
 *
 * The once-only block is the part worth reading twice. On a first visit
 * it is open and asked for; on a follow-up those details are already on
 * file, so the form collapses them and the counsellor goes straight to
 * what has changed. They stay reachable behind a disclosure, because
 * people move house and change jobs — skipping is the default, not a
 * lock.
 */
export function PersonaFields({
  client,
  draft,
  onChange,
}: {
  client: Pick<
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
  draft: PersonaDraft;
  onChange: (next: PersonaDraft) => void;
}) {
  const state = personaState(client);
  const [showOnceOnly, setShowOnceOnly] = useState(state.isFirstVisit);

  const set = (patch: Partial<PersonaDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="space-y-4">
      <Field
        label="Background"
        hint="Family, living situation, health, anything that frames the work."
      >
        <textarea
          value={draft.background}
          onChange={(e) => set({ background: e.target.value })}
          rows={4}
          className={`${fieldClass} resize-y`}
          placeholder="Lives with parents, first time seeking help, recent bereavement…"
        />
      </Field>

      <Field
        label="What they are seeking help with"
        hint="In the client's own words where you can."
      >
        <textarea
          value={draft.presentingConcern}
          onChange={(e) => set({ presentingConcern: e.target.value })}
          rows={4}
          className={`${fieldClass} resize-y`}
          placeholder="Trouble sleeping and constant worry about work."
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="How did they find the clinic?">
          <select
            value={draft.referralSource}
            onChange={(e) => set({ referralSource: e.target.value })}
            aria-label="How did they find the clinic?"
            className={fieldClass}
          >
            <option value="">Not asked</option>
            {withCurrent(REFERRAL_SOURCES, draft.referralSource).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>

        <Field label="Preferred language">
          <select
            value={draft.preferredLanguage}
            onChange={(e) => set({ preferredLanguage: e.target.value })}
            aria-label="Preferred language"
            className={fieldClass}
          >
            <option value="">No preference</option>
            {withCurrent(LANGUAGES, draft.preferredLanguage).map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* ------------------------------------------- asked once only */}
      <div className="rounded-xl border border-hairline overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-card-muted">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">
              {state.isFirstVisit ? "First visit — details to take" : "Details on file"}
            </p>
            <p className="text-[12px] text-muted mt-0.5">
              {state.isFirstVisit
                ? "Address, area, education and occupation. Asked once."
                : "Already taken, so this visit skips them. Open to correct."}
            </p>
          </div>
          {!state.isFirstVisit && (
            <button
              type="button"
              onClick={() => setShowOnceOnly((v) => !v)}
              aria-expanded={showOnceOnly}
              className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline shrink-0"
            >
              {showOnceOnly ? "Hide" : "Update"}
            </button>
          )}
        </div>

        {showOnceOnly && (
          <div className="px-4 py-4 space-y-3">
            <Field label="Address">
              <textarea
                value={draft.address}
                onChange={(e) => set({ address: e.target.value })}
                rows={2}
                className={`${fieldClass} resize-y`}
              />
            </Field>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Area" hint="Neighbourhood or locality.">
                <input
                  value={draft.area}
                  onChange={(e) => set({ area: e.target.value })}
                  className={fieldClass}
                  placeholder="Adyar"
                />
              </Field>
              <Field label="Education">
                <input
                  value={draft.education}
                  onChange={(e) => set({ education: e.target.value })}
                  className={fieldClass}
                  placeholder="B.Com"
                />
              </Field>
              <Field label="Occupation">
                <input
                  value={draft.occupation}
                  onChange={(e) => set({ occupation: e.target.value })}
                  className={fieldClass}
                  placeholder="Teacher"
                />
              </Field>
            </div>
          </div>
        )}
      </div>

      <p className="text-[12px] text-faint leading-relaxed">
        Saved onto the client&apos;s record. A field left blank keeps whatever
        is already on file rather than clearing it.
      </p>
    </div>
  );
}
