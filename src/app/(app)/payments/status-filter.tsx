"use client";

import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@/lib/types";

/**
 * Server Components cannot hand an onChange to the client, so the filter
 * lives here and drives navigation instead.
 */
export function StatusFilter({
  value,
  options,
}: {
  value: string;
  options: InvoiceStatus[];
}) {
  const router = useRouter();

  return (
    <>
      <label className="sr-only" htmlFor="status">
        Filter by status
      </label>
      <select
        id="status"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          router.push(next === "all" ? "/payments" : `/payments?status=${next}`);
        }}
        className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[13px] cursor-pointer hover:bg-card-muted transition-colors"
      >
        <option value="all">All statuses</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </>
  );
}
