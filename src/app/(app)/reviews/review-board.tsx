"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import {
  Alert, Button, Card, CardHeader, EmptyState, Field, Pill, Stat, fieldClass,
} from "@/components/ui";
import { deleteReview, logReview } from "@/lib/actions/ops";
import type { CounsellorSummary, Review } from "@/lib/types";

/**
 * Google Reviews, logged by hand with a monthly milestone count per
 * counsellor and team-wide. The target comes from clinic settings, so
 * "milestone" means whatever the practice decided rather than a number
 * baked into the code.
 */
export function ReviewBoard({
  reviews, counsellors, monthKey, target, isAdmin,
}: {
  reviews: Review[];
  counsellors: CounsellorSummary[];
  monthKey: string;
  target: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [counsellorId, setCounsellorId] = useState("");
  const [rating, setRating] = useState("5");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");

  const byCounsellor = new Map<string, number>();
  for (const r of reviews) {
    if (!r.counsellor_id) continue;
    byCounsellor.set(r.counsellor_id, (byCounsellor.get(r.counsellor_id) ?? 0) + 1);
  }

  const rated = reviews.filter((r) => r.rating != null);
  const average = rated.length
    ? (rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(1)
    : "—";

  function shiftMonth(by: number) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    router.push(`/reviews?month=${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setError(null); setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        setNotice(ok); setOpen(false);
        setClientName(""); setBody(""); setUrl("");
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Google Reviews</h1>
          <p className="text-[13px] text-muted mt-0.5">
            Logged reviews and the monthly milestone per counsellor.
            {target === 0 && " No monthly target set — see Clinic settings."}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Log a review</Button>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}

      <div className="flex items-center gap-1 mb-5">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month"
          className="size-9 grid place-items-center rounded-full border border-hairline hover:bg-card-muted transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span className="font-display text-lg font-semibold px-2 min-w-44 text-center">
          {new Date(`${monthKey}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
        </span>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month"
          className="size-9 grid place-items-center rounded-full border border-hairline hover:bg-card-muted transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Reviews" value={String(reviews.length)} sub="this month" />
        <Stat label="Average rating" value={average} sub={`${rated.length} rated`} />
        <Stat
          label="Team target"
          value={target ? `${reviews.length}/${target * counsellors.length}` : "—"}
          sub={target ? `${target} per counsellor` : "not set"}
        />
      </div>

      <Card className="mb-4 overflow-hidden">
        <CardHeader title="Monthly milestone by counsellor" />
        {counsellors.length === 0 ? (
          <EmptyState title="No counsellors" />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {counsellors.map((c) => {
              const count = byCounsellor.get(c.id) ?? 0;
              const hit = target > 0 && count >= target;
              return (
                <li key={c.id} className="px-5 py-3 flex items-center gap-3">
                  <span className="flex-1 text-[14px] font-medium">{c.full_name}</span>
                  {target > 0 && (
                    <span className="h-1.5 w-32 rounded-full bg-card-muted overflow-hidden">
                      <span
                        className={`block h-full ${hit ? "bg-emerald-500" : "bg-brand-500"}`}
                        style={{ width: `${Math.min(100, target ? (count / target) * 100 : 0)}%` }}
                      />
                    </span>
                  )}
                  <span className="text-[14px] tabular-nums w-16 text-right">
                    {target > 0 ? `${count}/${target}` : count}
                  </span>
                  {hit && <Pill>milestone</Pill>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={`${reviews.length} logged`} />
        {reviews.length === 0 ? (
          <EmptyState title="Nothing this month" description="Log one as they come in." />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {reviews.map((r) => (
              <li key={r.id} className="px-5 py-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">
                    {r.client_name}
                    {r.rating != null && (
                      <span className="ml-2 text-amber-600">{"★".repeat(r.rating)}</span>
                    )}
                  </p>
                  {r.body && <p className="text-[13px] text-muted mt-1 leading-relaxed">{r.body}</p>}
                  <p className="text-[12px] text-faint mt-1">
                    {r.reviewed_on}
                    {r.counsellor_id && ` · ${counsellors.find((c) => c.id === r.counsellor_id)?.full_name ?? ""}`}
                  </p>
                </div>
                <div className="shrink-0 text-right space-y-1">
                  {r.review_url && (
                    <a href={r.review_url} target="_blank" rel="noreferrer"
                      className="block text-[12px] text-brand-700 dark:text-brand-300 hover:underline">
                      Open
                    </a>
                  )}
                  {isAdmin && (
                    <button type="button" disabled={pending}
                      onClick={() => run(() => deleteReview(r.id), "Removed.")}
                      className="text-[12px] text-faint hover:text-red-600">
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Log a Google review"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={pending || clientName.trim().length < 2}
              onClick={() => run(() => logReview({
                clientName, counsellorId: counsellorId || null,
                rating: rating ? Number(rating) : null, body, reviewUrl: url,
              }), "Review logged.")}>
              Log it
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Client name" required>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={fieldClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Counsellor">
              <select value={counsellorId} onChange={(e) => setCounsellorId(e.target.value)} className={fieldClass}>
                <option value="">Unattributed</option>
                {counsellors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </Field>
            <Field label="Rating">
              <select value={rating} onChange={(e) => setRating(e.target.value)} className={fieldClass}>
                <option value="">Not given</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}
              </select>
            </Field>
          </div>
          <Field label="What they wrote">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${fieldClass} resize-y`} />
          </Field>
          <Field label="Link">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={fieldClass} placeholder="https://…" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
