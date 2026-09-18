"use client";

import { Field, fieldClass } from "@/components/ui";
import { timezoneLabel, timezoneOptions } from "@/lib/time";

/**
 * A timezone picker people can find India in.
 *
 * Asia/Kolkata was always first in the list, and QA still filed "add
 * Indian timezone" against three separate screens — because a column of
 * raw IANA identifiers does not read as a list of countries. The zone
 * stored is unchanged; only how it is labelled is.
 */
export function TimezoneSelect({
  label = "Timezone",
  hint,
  value,
  onChange,
  name,
  defaultValue,
  required,
}: {
  label?: string;
  hint?: string;
  /** Controlled use. Omit both this and onChange for an uncontrolled field. */
  value?: string;
  onChange?: (tz: string) => void;
  name?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const current = value ?? defaultValue;
  const options = timezoneOptions(current);

  return (
    <Field label={label} hint={hint} required={required}>
      <select
        name={name}
        className={fieldClass}
        {...(onChange
          ? { value: current ?? "", onChange: (e) => onChange(e.target.value) }
          : { defaultValue: current })}
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>
            {timezoneLabel(tz)}
          </option>
        ))}
      </select>
    </Field>
  );
}
