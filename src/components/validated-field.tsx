"use client";

import { useEffect, useId, useState } from "react";
import { Field, fieldClass } from "./ui";
import type { Validator } from "@/lib/validation";

/**
 * A field that checks itself when you leave it.
 *
 * The rule QA asked for: tell someone their email is wrong the moment
 * they tab away, not after they have filled in the rest of the form and
 * pressed Save. So validation runs on blur, and the message clears as
 * soon as they start correcting it — nagging while someone is still
 * mid-word is its own kind of rude.
 *
 * `onValidityChange` lets the parent disable submit, which keeps the
 * browser check and the server check agreeing about what is acceptable.
 */
export function ValidatedField({
  label,
  hint,
  required,
  value,
  onChange,
  name,
  defaultValue,
  validate,
  onValidityChange,
  type = "text",
  placeholder,
  inputMode,
  autoComplete,
  maxLength,
  disabled,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** Controlled use: pass both. */
  value?: string;
  onChange?: (value: string) => void;
  /**
   * Uncontrolled use: pass name (and optionally defaultValue) instead,
   * for forms that submit through a form action rather than state.
   * Validation still runs on blur either way.
   */
  name?: string;
  defaultValue?: string;
  validate: Validator;
  onValidityChange?: (valid: boolean) => void;
  type?: string;
  placeholder?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal";
  autoComplete?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const errorId = useId();
  const controlled = value !== undefined;

  // The parent needs to know about validity even before the field is
  // touched — an empty required field must block submit on its own.
  useEffect(() => {
    if (!controlled) return;
    onValidityChange?.(validate(value ?? "") === null);
    // validate is rebuilt on each render by callers; re-running on every
    // value change is the behaviour we want anyway.
  }, [value, controlled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    /*
     * The error sits OUTSIDE <Field>, not inside it.
     *
     * Field puts its children inside the <label>, so an error rendered
     * there becomes part of the field's accessible name — a screen
     * reader would announce "Email That doesn't look like an email
     * address" as the label itself, and it changes every keystroke.
     * Field's own comment warns about this for hints; the same trap
     * applies here. aria-describedby is the correct association.
     */
    <div>
      <Field label={label} hint={error ? undefined : hint} required={required}>
        <input
          type={type}
          {...(controlled ? { value } : { name, defaultValue })}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            onChange?.(e.target.value);
            // Once they have left the field at least once, keep the
            // verdict live as they correct it — the message should go
            // the moment the value is good, not linger until they tab
            // away again. Untouched fields stay quiet, so nobody is
            // told they are wrong mid-word.
            if (touched) setError(validate(e.target.value));
          }}
          onBlur={(e) => {
            setTouched(true);
            setError(validate(e.target.value));
          }}
          className={`${fieldClass} ${
            error ? "border-red-400 focus:border-red-500 focus:ring-red-500/15" : ""
          }`}
        />
      </Field>
      {error && (
        <p id={errorId} role="alert" className="text-[12px] text-red-600 mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
