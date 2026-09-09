"use client";

import { useState, useTransition } from "react";
import { setClientAge } from "@/lib/actions/clients";

const AGES = Array.from({ length: 101 }, (_, i) => i + 1);

/**
 * The inline age chip on each schedule row. Optimistic: the new value
 * shows immediately and rolls back if the write is rejected.
 */
export function AgeSelect({
  clientId,
  age,
  disabled,
}: {
  clientId: string;
  age: number | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<number | null>(age);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const parsed = next === "" ? null : Number(next);
    const previous = value;
    setValue(parsed);
    setError(null);

    startTransition(async () => {
      const result = await setClientAge(clientId, parsed);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <span className="relative inline-flex items-center">
      <select
        value={value ?? ""}
        disabled={disabled || pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Client age"
        title={error ?? "Client age"}
        className={`appearance-none bg-transparent pr-4 pl-1.5 py-0.5 rounded-md text-[13px] tabular-nums
          cursor-pointer transition-colors hover:bg-card-muted focus:bg-card-muted
          disabled:cursor-default disabled:opacity-60
          ${error ? "text-red-600" : "text-muted"}`}
      >
        <option value="">—</option>
        {AGES.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-0 text-faint"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
