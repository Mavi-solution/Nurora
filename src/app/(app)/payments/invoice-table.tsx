"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, fieldClass, InvoiceBadge } from "@/components/ui";
import { rebillFromTrackedTime, setInvoiceStatus } from "@/lib/actions/invoices";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import type { Invoice } from "@/lib/types";

type Row = {
  invoice: Invoice;
  clientName: string;
  counsellorName: string;
  startsAt: string | null;
};

export function InvoiceTable({
  invoices,
  timezone,
}: {
  invoices: Row[];
  timezone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<Row | null>(null);
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  return (
    <>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-faint border-b border-hairline">
              <th className="font-medium px-5 py-2.5">Invoice</th>
              <th className="font-medium px-3 py-2.5">Client</th>
              <th className="font-medium px-3 py-2.5 hidden md:table-cell">Counsellor</th>
              <th className="font-medium px-3 py-2.5 hidden sm:table-cell">Session</th>
              <th className="font-medium px-3 py-2.5 text-right">Amount</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {invoices.map((row) => (
              <tr key={row.invoice.id} className="hover:bg-card-muted transition-colors">
                <td className="px-5 py-3">
                  <Link
                    href={`/appointments/${row.invoice.appointment_id}`}
                    className="font-medium hover:underline"
                  >
                    {row.invoice.number}
                  </Link>
                  {row.invoice.billed_minutes != null && (
                    <span className="block text-[11px] text-faint">
                      {formatDuration(row.invoice.billed_minutes)} tracked
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">{row.clientName}</td>
                <td className="px-3 py-3 hidden md:table-cell text-muted">
                  {row.counsellorName}
                </td>
                <td className="px-3 py-3 hidden sm:table-cell text-muted tabular-nums">
                  {row.startsAt ? formatDate(row.startsAt, timezone) : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-medium">
                  {formatMoney(row.invoice.amount_cents, row.invoice.currency)}
                </td>
                <td className="px-3 py-3">
                  <InvoiceBadge status={row.invoice.status} />
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  {row.invoice.status === "unpaid" ? (
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" onClick={() => setPayTarget(row)} disabled={pending}>
                        Mark paid
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        title="Re-price from tracked time"
                        onClick={() => act(() => rebillFromTrackedTime(row.invoice.id))}
                      >
                        Rebill
                      </Button>
                    </div>
                  ) : row.invoice.status === "paid" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => act(() => setInvoiceStatus(row.invoice.id, "refunded"))}
                    >
                      Refund
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => act(() => setInvoiceStatus(row.invoice.id, "unpaid"))}
                    >
                      Reopen
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title="Record a payment"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setPayTarget(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => {
                if (payTarget) {
                  act(() => setInvoiceStatus(payTarget.invoice.id, "paid", method, reference));
                }
                setPayTarget(null);
              }}
            >
              Mark as paid
            </Button>
          </>
        }
      >
        {payTarget && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between pb-4 border-b border-hairline">
              <span className="text-[13px] text-muted">
                {payTarget.invoice.number} · {payTarget.clientName}
              </span>
              <span className="font-display text-xl font-semibold tabular-nums">
                {formatMoney(payTarget.invoice.amount_cents, payTarget.invoice.currency)}
              </span>
            </div>

            <Field label="Method">
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={fieldClass}>
                {["UPI", "Cash", "Bank transfer", "Card", "Cheque", "Other"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Reference" hint="Transaction ID, cheque number, anything you want on record.">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={fieldClass}
                placeholder="Optional"
              />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
