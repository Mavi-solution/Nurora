"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { fieldClass } from "@/components/ui";
import {
  DEFAULT_DIALING_CODE,
  DIALING_CODES,
  joinDialingCode,
  normalisePhoneInput,
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
  const [code, setCode] = useState(() => splitDialingCode(value).code);
  const [national, setNational] = useState(() => splitDialingCode(value).national);
  const [touched, setTouched] = useState(false);

  /*
   * What we last handed the parent.
   *
   * The sync below has to tell "the parent replaced this value" from
   * "the parent is echoing back what we just emitted". Comparing a
   * re-joined string could not: joinDialingCode is lossy — it drops
   * spaces, brackets and a trunk zero — so a number stored as
   * "98400 11223" never equalled its own re-join, the effect fired on
   * every render, and it overwrote whatever was being typed. Holding
   * the emitted string is exact.
   */
  const lastEmitted = useRef(value ?? "");

  useEffect(() => {
    const incoming = value ?? "";
    if (incoming === lastEmitted.current) return;

    // A genuine outside change — picking a returning client fills in
    // their number, or a form resets.
    const next = splitDialingCode(incoming);
    lastEmitted.current = incoming;
    setCode(next.code);
    setNational(next.national);
  }, [value]);

  /**
   * Store exactly what was typed.
   *
   * No re-splitting, no rewriting, no cursor surprises. Tidying happens
   * on paste and on blur instead — see normalisePhoneInput.
   */
  function emit(nextCode: string, nextNational: string) {
    setCode(nextCode);
    setNational(nextNational);
    const out = joinDialingCode(nextCode, nextNational);
    lastEmitted.current = out;
    onChange(out);
  }

  /** Apply the tidy-up and push the result up. */
  function normalise(nextCode: string, nextNational: string) {
    const tidy = normalisePhoneInput(nextCode, nextNational);
    emit(tidy.code, tidy.national);
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    // A pasted "+971 50 123 4567" sets the country too, which is the
    // whole point of pasting a number you were given in full.
    e.preventDefault();
    normalise(code, pasted);
  }

  function onBlurNormalise() {
    setTouched(true);
    normalise(code, national);
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

      {/*
        The two controls are sized by WRAPPERS, not by adding a width
        class to the control itself.

        fieldClass already carries w-full, and `${fieldClass} w-[8.5rem]`
        sets the same CSS property twice — which of the two wins is
        decided by the order Tailwind happens to emit them in the
        stylesheet, not by the order they appear here. w-full won: the
        dialling-code select took the entire row, shrink-0 stopped it
        giving any back, and the number box collapsed to thirty pixels.
        That is the whole of "can't enter mobile number" — the field was
        there, and there was nowhere to type.
      */}
      <div className="flex gap-2">
        <div className="w-[8.5rem] shrink-0">
          {/*
            Named "Country code", NOT "<label> country code". A select
            nested near a labelled field otherwise ends up owning the
            field's name, and the number box — the control anyone
            actually wants — is left with none at all.
          */}
          <select
            value={code}
            disabled={disabled}
            title={`Country code for ${label.toLowerCase()}`}
            aria-label="Country code"
            onChange={(e) => emit(e.target.value, national)}
            className={`${fieldClass} tabular-nums`}
          >
            {DIALING_CODES.map((c) => (
              <option key={`${c.iso}-${c.code}`} value={c.code}>
                +{c.code} {c.iso}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-0">
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
            onPaste={onPaste}
            onBlur={onBlurNormalise}
            className={`${fieldClass} ${
              error ? "border-red-400 focus:border-red-500 focus:ring-red-500/12" : ""
            }`}
          />
        </div>
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
