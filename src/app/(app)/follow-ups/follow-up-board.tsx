"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import {
  Alert, Button, Card, CardHeader, EmptyState, Field, Pill, Stat, fieldClass,
} from "@/components/ui";
import {
  completeFollowUp, createCommitment, createFollowUp, deleteCommitment,
  deleteFollowUp, prepareFollowUpMessage, reopenFollowUp, sendFollowUpNow,
  toggleCommitment,
} from "@/lib/actions/ops";
import type { ClientSummary, Commitment, FollowUp } from "@/lib/types";

type FollowUpRow = FollowUp & {
  client: { id: string; full_name: string; phone: string | null } | null;
};

/**
 * Two tabs, as the guide describes them.
 *
 * Follow-up is "send this thing to this client", and completing one
 * opens WhatsApp rather than simply ticking a box — you cannot
 * fake-complete it without sending something. Completing without
 * sending is still possible (a client may have no number) but is
 * recorded as 'manual', so the difference stays visible afterwards.
 *
 * Commitments is a plain task tracker with no such requirement.
 */
export function FollowUpBoard({
  tab, profileId, followUps, commitments, clients,
}: {
  tab: "follow-up" | "commitments";
  profileId: string;
  followUps: FollowUpRow[];
  commitments: Commitment[];
  clients: ClientSummary[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [newOpen, setNewOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [clientId, setClientId] = useState("");
  const [dueOn, setDueOn] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");

  const [sending, setSending] = useState<{
    id: string;
    href: string;
    text: string;
    canSendAutomatically: boolean;
  } | null>(null);

  // Optimistic tick. Controlled purely by server state the box snaps
  // back until the refresh lands, which reads as the click doing
  // nothing. Keyed overrides, cleared whenever fresh props arrive.
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  useEffect(() => setDoneOverride({}), [commitments]);
  const isDone = (c: Commitment) =>
    doneOverride[c.id] ?? Boolean(c.done_at);

  const openFollowUps = followUps.filter((f) => !f.completed_at);
  const openCommitments = commitments.filter((c) => !c.done_at);
  const today = new Date().toISOString().slice(0, 10);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
    onFail?: () => void,
  ) {
    setError(null); setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setError(r.error ?? "Something went wrong."); onFail?.(); }
      else {
        setNotice(ok); setNewOpen(false); setSending(null);
        setWhat(""); setTitle(""); setDetail(""); setClientId("");
        router.refresh();
      }
    });
  }

  function startSend(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await prepareFollowUpMessage(id);
      if (!r.ok) setError(r.error);
      else setSending({
        id,
        href: r.data.href,
        text: r.data.text,
        canSendAutomatically: r.data.canSendAutomatically,
      });
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Follow-up &amp; Commitments
          </h1>
          <p className="text-[13px] text-muted mt-0.5">
            {tab === "follow-up"
              ? "Things to send to clients. Completing one opens WhatsApp."
              : "A general task and promise tracker."}
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          {tab === "follow-up" ? "New follow-up" : "New commitment"}
        </Button>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}

      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { v: "follow-up", label: "Follow-up" },
          { v: "commitments", label: "Commitments" },
        ].map((t) => (
          <Link
            key={t.v}
            href={t.v === "follow-up" ? "/follow-ups" : "/follow-ups?tab=commitments"}
            className={`h-9 px-4 grid place-items-center rounded-full border text-[13px] transition-colors ${
              tab === t.v
                ? "bg-brand-700 border-brand-700 text-white font-medium"
                : "border-hairline hover:bg-card-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Open follow-ups" value={String(openFollowUps.length)} />
        <Stat
          label="Overdue"
          value={String(openFollowUps.filter((f) => f.due_on < today).length)}
        />
        <Stat label="Open commitments" value={String(openCommitments.length)} />
      </div>

      {tab === "follow-up" ? (
        <Card className="overflow-hidden">
          <CardHeader title={`${followUps.length} follow-up${followUps.length === 1 ? "" : "s"}`} />
          {followUps.length === 0 ? (
            <EmptyState title="Nothing to send" description="Add one to get started." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {followUps.map((f) => (
                <li key={f.id} className={`px-5 py-4 ${f.completed_at ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">{f.what}</p>
                      <p className="text-[12px] text-muted mt-1">
                        {f.client?.full_name ?? "No client"} · due {f.due_on}
                        {!f.completed_at && f.due_on < today && (
                          <span className="text-red-600 font-medium"> · overdue</span>
                        )}
                      </p>
                      {f.completed_at && (
                        <p className="text-[12px] mt-1">
                          <Pill>
                            {f.completed_via === "whatsapp"
                              ? "Sent on WhatsApp"
                              : "Marked done without sending"}
                          </Pill>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!f.completed_at ? (
                        <>
                          <Button size="sm" disabled={pending} onClick={() => startSend(f.id)}>
                            Send &amp; complete
                          </Button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(() => completeFollowUp(f.id, "manual"), "Marked done.")}
                            className="text-[12px] text-muted hover:text-body"
                            title="Records that it was closed without sending anything"
                          >
                            Done without sending
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => reopenFollowUp(f.id), "Reopened.")}
                          className="text-[12px] text-muted hover:text-body"
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteFollowUp(f.id), "Removed.")}
                        className="text-[12px] text-faint hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader title={`${commitments.length} commitment${commitments.length === 1 ? "" : "s"}`} />
          {commitments.length === 0 ? (
            <EmptyState title="Nothing tracked" description="Add a promise or task." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {commitments.map((c) => (
                <li key={c.id} className={`px-5 py-4 ${isDone(c) ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isDone(c)}
                      disabled={pending}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setDoneOverride((prev) => ({ ...prev, [c.id]: next }));
                        run(
                          () => toggleCommitment(c.id, next),
                          next ? "Done." : "Reopened.",
                          () => setDoneOverride((prev) => ({ ...prev, [c.id]: !next })),
                        );
                      }}
                      className="size-4 mt-0.5 rounded accent-brand-600"
                      aria-label={c.title}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14px] font-medium ${isDone(c) ? "line-through" : ""}`}>
                        {c.title}
                      </p>
                      {c.detail && <p className="text-[13px] text-muted mt-0.5">{c.detail}</p>}
                      {c.due_on && (
                        <p className="text-[12px] text-faint mt-1">
                          due {c.due_on}
                          {!isDone(c) && c.due_on < today && (
                            <span className="text-red-600 font-medium"> · overdue</span>
                          )}
                        </p>
                      )}
                      {c.owner_id !== profileId && <Pill className="mt-1">someone else&apos;s</Pill>}
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => deleteCommitment(c.id), "Removed.")}
                      className="text-[12px] text-faint hover:text-red-600 shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ------------------------------------------- WhatsApp hand-off */}
      <Dialog
        open={sending !== null}
        onClose={() => setSending(null)}
        title="Send it, then complete"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setSending(null)}>
              Cancel
            </Button>
            {sending?.canSendAutomatically ? (
              <Button
                className="flex-1"
                disabled={pending}
                onClick={() => sending && run(() => sendFollowUpNow(sending.id), "Sent and completed.")}
              >
                {pending ? "Sending…" : "Send it now"}
              </Button>
            ) : (
              <Button
                className="flex-1"
                disabled={pending}
                onClick={() => sending && run(() => completeFollowUp(sending.id, "whatsapp"), "Marked as sent.")}
              >
                Mark as sent
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted leading-relaxed">
            {sending?.canSendAutomatically
              ? "Send it from Nurora, or open WhatsApp and send it yourself. A free-text message only reaches a client who wrote in the last 24 hours — if it is refused, use the link."
              : "Open WhatsApp with this prefilled, send it, then mark it done. Completing without sending is recorded differently."}
          </p>
          <pre className="text-[12px] whitespace-pre-wrap break-words bg-card-muted border border-hairline rounded-xl p-3">
            {sending?.text}
          </pre>
          {sending && (
            <a
              href={sending.href}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center h-10 px-5 rounded-full text-sm font-medium transition-colors ${
                sending.canSendAutomatically
                  ? "border border-[var(--border-strong)] bg-card hover:bg-card-muted"
                  : "bg-brand-600 text-white hover:bg-brand-700"
              }`}
            >
              Open in WhatsApp
            </a>
          )}
        </div>
      </Dialog>

      {/* ------------------------------------------------------- new */}
      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={tab === "follow-up" ? "New follow-up" : "New commitment"}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={pending || (tab === "follow-up" ? what.trim().length < 3 : title.trim().length < 3)}
              onClick={() =>
                tab === "follow-up"
                  ? run(() => createFollowUp({ what, clientId: clientId || null, dueOn }), "Follow-up added.")
                  : run(() => createCommitment({ title, detail, dueOn }), "Commitment added.")
              }
            >
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {tab === "follow-up" ? (
            <>
              <Field label="What to send" required>
                <input value={what} onChange={(e) => setWhat(e.target.value)} className={fieldClass} placeholder="the exercise sheet we discussed" />
              </Field>
              <Field label="Client">
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={fieldClass}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Commitment" required>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} placeholder="Call the landlord about the lease" />
              </Field>
              <Field label="Detail">
                <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} className={`${fieldClass} resize-y`} />
              </Field>
            </>
          )}
          <Field label="Due">
            <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={fieldClass} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
