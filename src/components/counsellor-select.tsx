"use client";

import { Field, fieldClass } from "@/components/ui";
import type { CounsellorSummary } from "@/lib/types";

/**
 * Describe a counsellor the way the desk chooses one.
 *
 * QA's complaint on three screens was the same: the dropdowns listed
 * names and nothing else, so picking one meant either knowing the
 * roster by heart or guessing. Language and specialism ARE the choice —
 * a caller who needs trauma work in Tamil is not served by an
 * alphabetical list of people.
 *
 * `<option>` cannot hold markup, so the detail goes into the option
 * text, and the fuller version is repeated under the field once a
 * choice is made.
 */
export function describeCounsellor(c: CounsellorSummary): string {
  const bits: string[] = [];
  const languages = (c.languages ?? []).filter(Boolean);
  const specialisms = (c.specialisms ?? []).filter(Boolean);

  if (languages.length > 0) bits.push(languages.join(", "));
  if (specialisms.length > 0) bits.push(specialisms.join(", "));

  return bits.length > 0 ? `${c.full_name} — ${bits.join(" · ")}` : c.full_name;
}

export function CounsellorSelect({
  label = "Counsellor",
  counsellors,
  value,
  onChange,
  required,
  placeholder = "Select counsellor",
  hint,
}: {
  label?: string;
  counsellors: CounsellorSummary[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const chosen = counsellors.find((c) => c.id === value);
  const languages = (chosen?.languages ?? []).filter(Boolean);
  const specialisms = (chosen?.specialisms ?? []).filter(Boolean);

  return (
    <div>
      <Field label={label} required={required}>
        {/*
          An explicit aria-label, because a <select> nested inside a
          <label> has every option folded into its accessible name.
          With counsellors now described by their specialisms, that name
          ran to hundreds of characters and matched, among other things,
          a search for the Age field — via "Marriage & family".
        */}
        <select
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
        >
          <option value="">{placeholder}</option>
          {counsellors.map((c) => (
            <option key={c.id} value={c.id}>
              {describeCounsellor(c)}
            </option>
          ))}
        </select>
      </Field>

      {chosen && (languages.length > 0 || specialisms.length > 0) ? (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {languages.map((l) => (
            <span
              key={`lang-${l}`}
              title="Can hold the session in this language"
              className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-800 dark:border-brand-400/25 dark:bg-brand-400/10 dark:text-brand-200"
            >
              {l}
            </span>
          ))}
          {specialisms.map((s) => (
            <span
              key={`spec-${s}`}
              title="Specialises in"
              className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-muted"
            >
              {s}
            </span>
          ))}
        </div>
      ) : (
        hint && <span className="block text-[12px] text-faint mt-1.5">{hint}</span>
      )}
    </div>
  );
}
