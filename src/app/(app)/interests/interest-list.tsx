"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Pill,
  fieldClass,
} from "@/components/ui";
import {
  convertInterest,
  deleteInterest,
  dropInterest,
} from "@/lib/actions/interests";
import { formatMoney } from "@/lib/format";
import type { AppointmentTag, InterestRow } from "@/lib/types";

const MODE_LABEL: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  offline_walk_in: "Walk-in",
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Open" },
  { value: "converted", label: "Booked" },
  { value: "dropped", label: "Dropped" },
] as const;

/**
 * Leads who have shown interest but not paid.
 *
 * Nothing here holds a slot — that is the point of the list. Booking one
 * in is the moment a time is actually reserved.
 */
export function InterestList({
  interests,
  tags,
  status,
  isAdmin,
}: {
  interests: InterestRow[];
  tags: AppointmentTag[];
  status: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [converting, setConverting] = useState<InterestRow | null>(null);
  const [when, setWhen] = useState("");

  const tagById = new Map(tags.map((t) => [t.id, t]));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setNotice(ok ?? "Saved.");
      setConverting(null);
      setWhen("");
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Interest &amp; Booked
        </h1>
        <p className="text-[13px] text-muted mt-0.5">
          Callers who showed interest before paying. None of these hold a slot —
          booking one in is what reserves the time.
        </p>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/interests" : `/interests?status=${f.value}`}
            className={`h-9 px-4 grid place-items-center rounded-full border text-[13px] transition-colors ${
              status === f.value
                ? "bg-brand-700 border-brand-700 text-white font-medium"
                : "border-hairline hover:bg-card-muted"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`${interests.length} lead${interests.length === 1 ? "" : "s"}`} />

        {interests.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Save a booking as an Interest and it lands in this list."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {interests.map((i) => (
              <li key={i.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{i.full_name}</span>
                      {i.age != null && <Pill>{i.age}</Pill>}
                      {i.client_type === "follow_up" && <Pill>Follow-up</Pill>}
                      {i.status === "converted" && (
                        <span className="text-[11px] font-medium text-sage-700 dark:text-sage-300">
                          Booked
                        </span>
                      )}
                      {i.status === "dropped" && (
                        <span className="text-[11px] font-medium text-red-600">Dropped</span>
                      )}
                    </div>

                    <p className="text-[13px] text-muted mt-1">
                      {i.service?.name ?? "No service chosen"}
                      {i.service && ` · ${formatMoney(i.service.price_cents, i.service.currency)}`}
                      {i.counsellor && ` · ${i.counsellor.full_name}`}
                    </p>

                    <p className="text-[12px] text-faint mt-1">
                      {i.on_date ?? "no date"} · {MODE_LABEL[i.mode] ?? i.mode}
                      {i.whatsapp && ` · ${i.whatsapp}`}
                    </p>

                    {i.tag_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {i.tag_ids.map((id) => {
                          const tag = tagById.get(id);
                          if (!tag) return null;
                          return (
                            <Pill key={id}>
                              {tag.label} ({tag.abbreviation})
                            </Pill>
                          );
                        })}
                      </div>
                    )}

                    {i.attachment !== "none" && (
                      <p className="text-[12px] text-faint mt-1.5">
                        Attachment: {i.attachment.replace("_", " ")}
                        {i.attachment_expires_at &&
                          ` · expires ${new Date(i.attachment_expires_at).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {i.status === "scheduled" && (
                      <>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setConverting(i);
                            setWhen(`${i.on_date ?? ""}T10:00`);
                          }}
                        >
                          Book it in
                        </Button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => dropInterest(i.id), "Lead dropped.")}
                          className="text-[12px] text-muted hover:text-red-600"
                        >
                          Drop
                        </button>
                      </>
                    )}

                    {i.converted_appointment_id && (
                      <Link
                        href={`/appointments/${i.converted_appointment_id}`}
                        className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
                      >
                        Open session
                      </Link>
                    )}

                    {isAdmin && i.status !== "converted" && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteInterest(i.id), "Lead deleted.")}
                        className="text-[12px] text-faint hover:text-red-600"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={converting !== null}
        onClose={() => setConverting(null)}
        title={`Book in ${converting?.full_name ?? ""}`}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConverting(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending || !when}
              onClick={() =>
                converting &&
                run(
                  () => convertInterest(converting.id, new Date(when).toISOString()),
                  "Booked — the slot is now held.",
                )
              }
            >
              {pending ? "Booking…" : "Book appointment"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] text-muted leading-relaxed">
            This creates a real appointment, raises the invoice and messages the
            client. The slot is held from this point.
          </p>
          <Field label="Date and time" required>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={fieldClass}
            />
          </Field>
          {converting?.service && (
            <p className="text-[12px] text-faint">
              {converting.service.name} ·{" "}
              {formatMoney(converting.service.price_cents, converting.service.currency)}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
