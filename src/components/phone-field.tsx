"use client";

import { useEffect, useState } from "react";
import { fieldClass } from "@/components/ui";
import {
  DEFAULT_DIALING_CODE,
  DIALING_CODES,
  joinDialingCode,
  splitDialingCode,
} from "@/lib/dialing-codes";
import { isValidPhone } from "@/lib/validation";

/**
 * A phone number with its country code chosen, not guessed.
 *
 * Every phone field in the app used to be one free-text box, and
 * toE164() quietly assumed +91 for anything without a prefix. For a
 * Chennai practice that is right most of the time, and the times it is
 * wrong are invisible: the number stores fine, the booking saves fine,
 * and the WhatsApp reminder is simply never delivered to a client in
 * Dubai. Splitting the code out makes the assumption a choice on
 * screen, and the stored value is always full E.164.
 *
 * Validation runs on blur, matching every other field in the app: the
 * complaint arrives when you leave the box, not when you submit.
 */
export function PhoneField({
  label = "Phone",
  hint,
  value,
  onChange,
  name,
  required,
  disabled,
  placeholder = "98400 11223",
  autoFocus,
}: {
  label?: string;
  hint?: string;
  /** Full number as stored, e.g. "+919840011223". */
  value: string;
  onChange: (value: string) => void;
  /** Posts the joined E.164 value when used inside a plain form. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const initial = splitDialingCode(value);
  const [code, setCode] = useState(initial.code);
  const [national, setNational] = useState(initial.national);
  const [touched, setTouched] = useState(false);

  /*
   * Re-sync when the value is replaced from outside — picking a
   * returning client fills their number in, and the two halves have to
   * follow. Guarded on the JOINED value so typing does not fight the
   * effect: the parent is told "+919840011223" and hands back the same
   * string, which must not reset what is being typed.
   */
  useEffect(() => {
    const joined = joinDialingCode(code, national);
    if (joined === (value ?? "")) return;
    const next = splitDialingCode(value);
    setCode(next.code);
    setNational(next.national);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nextCode: string, nextNational: string) {
    /*
     * A full international number typed or pasted into the national
     * box splits itself.
     *
     * People paste "+91 98400 11223" out of WhatsApp without first
     * noticing there is a separate code dropdown. Treating that as a
     * local number would store "+9191984001122" — a number that looks
     * plausible, saves without complaint, and can never be delivered
     * to. Only an explicit "+" or "00" triggers this: a bare
     * "9840011223" is a local number, not a Nigerian one.
     */
    const typed = nextNational.trim();
    if (typed.startsWith("+") || typed.startsWith("00")) {
      const split = splitDialingCode(typed);
      if (split.national) {
        setCode(split.code);
        setNational(split.national);
        onChange(joinDialingCode(split.code, split.national));
        return;
      }
    }

    setCode(nextCode);
    setNational(nextNational);
    onChange(joinDialingCode(nextCode, nextNational));
  }

  const joined = joinDialingCode(code, national);

  /*
   * The character check runs on what was TYPED, not on the joined
   * value.
   *
   * joinDialingCode strips everything that is not a digit, so
   * "98400 1122a" would otherwise normalise to a clean nine-digit
   * number and pass — the letter silently discarded, leaving a number
   * nobody can be reached on. A letter in a phone number is a typo, and
   * the person typing it is the only one who can say what it should
   * have been.
   */
  const error = !touched
    ? null
    : !national.trim()
      ? required
        ? `Enter a ${label.toLowerCase()}.`
        : null
      : !/^[\d\s()+\-.]+$/.test(national.trim())
        ? "A phone number can only contain digits, spaces and + ( ) -"
        : isValidPhone(joined)
          ? null
          : "That number is too short or too long to dial.";

  const describedBy = error ? `${fieldId(label)}-error` : undefined;

  return (
    <div>
      <span
        className={`block text-[13px] font-medium mb-1.5 ${required ? "is-required" : ""}`}
      >
        {label}
      </span>

      {name && <input type="hidden" name={name} value={joined} />}

      <div className="flex gap-2">
        {/*
          Named "Country code", NOT "<label> country code". A select
          nested near a labelled field otherwise ends up owning the
          field's name, and the number box — the control anyone actually
          wants — is left with none at all.
        */}
        <select
          value={code}
          disabled={disabled}
          title={`Country code for ${label.toLowerCase()}`}
          aria-label="Country code"
          onChange={(e) => emit(e.target.value, national)}
          className={`${fieldClass} w-[8.5rem] shrink-0 tabular-nums`}
        >
          {DIALING_CODES.map((c) => (
            <option key={`${c.iso}-${c.code}`} value={c.code}>
              +{c.code} {c.iso}
            </option>
          ))}
        </select>

        <input
          type="tel"
          inputMode="tel"
          aria-label={label}
          autoComplete="tel-national"
          autoFocus={autoFocus}
          disabled={disabled}
          value={national}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => emit(code, e.target.value)}
          onBlur={() => setTouched(true)}
          className={`${fieldClass} flex-1 min-w-0 ${
            error ? "border-red-400 focus:border-red-500 focus:ring-red-500/12" : ""
          }`}
        />
      </div>

      {error ? (
        <span
          id={describedBy}
          role="alert"
          className="block text-[12px] text-red-600 dark:text-red-400 mt-1.5"
        >
          {error}
        </span>
      ) : (
        hint && <span className="block text-[12px] text-faint mt-1.5">{hint}</span>
      )}
    </div>
  );
}

/** Stable-enough id for aria-describedby without pulling in useId noise. */
function fieldId(label: string): string {
  return `phone-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export { DEFAULT_DIALING_CODE };
