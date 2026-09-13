"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, EmptyState, Pill, Stat, fieldClass } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { Client } from "@/lib/types";

export function PersonaList({
  clients,
  q,
  from,
  to,
  canExport,
}: {
  clients: Client[];
  q: string;
  from: string;
  to: string;
  canExport: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);

  const filled = clients.filter((c) => c.presenting_concern).length;

  function go(next: Partial<{ q: string; from: string; to: string }>) {
    const s = new URLSearchParams({ q: search, from, to, ...next });
    router.push(`/persona?${s}`);
  }

  function exportCsv() {
    downloadCsv(
      `nurora-persona-${from}-to-${to}.csv`,
      toCsv(clients as unknown as Record<string, unknown>[], [
        { key: "full_name", label: "Name" },
        { key: "age", label: "Age" },
        { key: "gender", label: "Gender" },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Email" },
        { key: "preferred_language", label: "Language" },
        { key: "presenting_concern", label: "Presenting concern" },
        { key: "notes", label: "Notes" },
        { key: "created_at", label: "Added" },
      ]),
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Persona</h1>
        <p className="text-[13px] text-muted mt-0.5">
          The client intake form — what each person is seeking help with.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Clients" value={String(clients.length)} sub={`${from} to ${to}`} />
        <Stat label="Persona filled" value={String(filled)} sub={`${clients.length - filled} outstanding`} />
        <Stat
          label="Completion"
          value={clients.length ? `${Math.round((filled / clients.length) * 100)}%` : "—"}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="text-[12px] text-muted flex-1 min-w-48">
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go({ q: search })}
            placeholder="Name, phone or email"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="text-[12px] text-muted">
          From
          <input type="date" value={from} onChange={(e) => go({ from: e.target.value })} className={`${fieldClass} mt-1`} />
        </label>
        <label className="text-[12px] text-muted">
          To
          <input type="date" value={to} onChange={(e) => go({ to: e.target.value })} className={`${fieldClass} mt-1`} />
        </label>
        <Button variant="secondary" onClick={() => go({ q: search })}>Search</Button>
        {canExport && (
          <Button variant="secondary" onClick={exportCsv} disabled={clients.length === 0}>
            Export CSV
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`${clients.length} client${clients.length === 1 ? "" : "s"}`} />
        {clients.length === 0 ? (
          <EmptyState title="Nobody matches" description="Widen the dates or clear the search." />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {clients.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/clients/${c.id}`}
                      className="text-[14px] font-semibold hover:underline underline-offset-2"
                    >
                      {c.full_name}
                    </Link>
                    <span className="ml-2 text-[12px] text-muted">
                      {[c.age ? `${c.age}` : null, c.gender, c.preferred_language]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {c.presenting_concern ? (
                      <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
                        {c.presenting_concern}
                      </p>
                    ) : (
                      <p className="mt-1.5"><Pill>Persona not filled</Pill></p>
                    )}
                  </div>
                  <span className="text-[12px] text-faint shrink-0 tabular-nums">
                    {new Date(c.created_at).toLocaleDateString([], {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
