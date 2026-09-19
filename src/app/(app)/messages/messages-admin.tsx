"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import {
  Alert, Button, Card, CardHeader, EmptyState, Field, Pill, fieldClass,
} from "@/components/ui";
import {
  createSchedule, createTemplate, deleteSchedule, deleteTemplate,
  setScheduleActive, updateTemplate,
} from "@/lib/actions/messaging";
import {
  PLACEHOLDERS, messageStats, renderTemplate, sampleVars, unknownPlaceholders,
} from "@/lib/business/render-message";
import type {
  MessageAudience, MessageTemplateWithSchedules, MessageTrigger,
} from "@/lib/types";

const TRIGGERS: { value: MessageTrigger; label: string; relative: boolean }[] = [
  { value: "before_appointment", label: "Before the appointment", relative: true },
  { value: "after_appointment", label: "After the appointment", relative: true },
  { value: "on_booking", label: "When it is booked", relative: false },
  { value: "on_reschedule", label: "When it is moved", relative: false },
  { value: "on_cancel", label: "When it is cancelled", relative: false },
];

const AUDIENCES: { value: MessageAudience; label: string }[] = [
  { value: "client", label: "The client" },
  { value: "counsellor", label: "The counsellor" },
  { value: "both", label: "Both" },
];

/** Minutes as something a person would say. */
function humanOffset(minutes: number): string {
  if (minutes === 0) return "immediately";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const bits = [
    d ? `${d} day${d > 1 ? "s" : ""}` : "",
    h ? `${h} hour${h > 1 ? "s" : ""}` : "",
    m ? `${m} min` : "",
  ].filter(Boolean);
  return bits.join(" ");
}

/**
 * Message templates and when they go out.
 *
 * The preview is the point of this screen: a placeholder typo is
 * invisible in the raw text and obvious the moment you see the message
 * as the client will.
 */
export function MessagesAdmin({
  templates, whatsappReady, whatsappProblems,
}: {
  templates: MessageTemplateWithSchedules[];
  whatsappReady: boolean;
  /** Which variable is wrong and how — never the value itself. */
  whatsappProblems: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<MessageTemplateWithSchedules | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftSid, setDraftSid] = useState("");
  const [creating, setCreating] = useState(false);

  const [schedFor, setSchedFor] = useState<MessageTemplateWithSchedules | null>(null);
  const [schedName, setSchedName] = useState("");
  const [schedTrigger, setSchedTrigger] = useState<MessageTrigger>("before_appointment");
  const [schedDays, setSchedDays] = useState("1");
  const [schedHours, setSchedHours] = useState("0");
  const [schedAudience, setSchedAudience] = useState<MessageAudience>("client");

  const preview = useMemo(
    () => renderTemplate(draftBody, sampleVars()),
    [draftBody],
  );
  const unknown = useMemo(() => unknownPlaceholders(draftBody), [draftBody]);
  const stats = useMemo(() => messageStats(draftBody), [draftBody]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setError(null); setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setError(r.error ?? "Something went wrong."); return; }
      setNotice(ok);
      setEditing(null); setCreating(false); setSchedFor(null);
      router.refresh();
    });
  }

  function openEditor(t: MessageTemplateWithSchedules) {
    setEditing(t); setDraftBody(t.body); setDraftName(t.name);
    setDraftSid(t.content_sid ?? ""); setError(null);
  }

  const relative = TRIGGERS.find((t) => t.value === schedTrigger)?.relative ?? false;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Messages</h1>
          <p className="text-[13px] text-muted mt-0.5">
            What the practice sends, and when. Admin only.
          </p>
        </div>
        <Button onClick={() => {
          setCreating(true); setDraftName(""); setDraftBody("Hi {{client_name}},\n\n");
          setDraftSid(""); setError(null);
        }}>
          New template
        </Button>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}
      {!whatsappReady && (
        <div className="mb-4">
          <Alert tone="error">
            <span className="block font-medium">
              WhatsApp is not connected, so nothing here will actually send.
            </span>
            {whatsappProblems.length > 0 ? (
              <>
                {/* Naming the variable matters: the commonest cause is one
                    created in Vercel with an EMPTY value, which appears
                    set in every listing and sends nothing. */}
                <ul className="mt-2 space-y-1">
                  {whatsappProblems.map((p) => (
                    <li key={p} className="text-[13px]">
                      <code className="font-mono text-[12px]">{p.split(":")[0]}</code>
                      {" — "}
                      {p.slice(p.indexOf(":") + 1).trim()}
                    </li>
                  ))}
                </ul>
                <span className="block text-[13px] mt-2">
                  Fix it in the project&apos;s environment variables and
                  redeploy. /api/health reports the same detail.
                </span>
              </>
            ) : (
              <span className="block text-[13px] mt-1">
                Set the Twilio variables and redeploy.
              </span>
            )}
          </Alert>
        </div>
      )}

      <div className="space-y-4">
        {templates.length === 0 && (
          <Card><EmptyState title="No templates yet" description="Add one to get started." /></Card>
        )}

        {templates.map((t) => (
          <Card key={t.id} className="overflow-hidden">
            <CardHeader
              title={t.name}
              description={t.description ?? undefined}
              action={
                <div className="flex items-center gap-2">
                  <Pill>{t.channel}</Pill>
                  {t.is_system && <Pill>built in</Pill>}
                  {!t.is_active && <Pill>off</Pill>}
                  <Button size="sm" variant="secondary" onClick={() => openEditor(t)}>
                    Edit
                  </Button>
                </div>
              }
            />

            <div className="px-5 py-4">
              <pre className="text-[12px] whitespace-pre-wrap break-words bg-card-muted border border-hairline rounded-xl p-3 max-h-40 overflow-y-auto">
                {t.body}
              </pre>

              {t.channel === "whatsapp" && !t.content_sid && (
                <p className="text-[12px] text-blush-800 dark:text-blush-300 mt-2">
                  No approved template registered. Meta rejects free-form
                  business-initiated messages outside a 24-hour window, so this
                  may work in testing and fail in production.
                </p>
              )}

              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-hairline">
                <span className="text-[13px] font-medium">
                  {t.schedules.length === 0
                    ? "Not scheduled"
                    : `${t.schedules.length} schedule${t.schedules.length > 1 ? "s" : ""}`}
                </span>
                <Button size="sm" variant="secondary" onClick={() => {
                  setSchedFor(t); setSchedName(""); setSchedTrigger("before_appointment");
                  setSchedDays("1"); setSchedHours("0"); setSchedAudience("client"); setError(null);
                }}>
                  Add a schedule
                </Button>
              </div>

              {t.schedules.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {t.schedules.map((s) => {
                    const trig = TRIGGERS.find((x) => x.value === s.trigger);
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          checked={s.is_active}
                          disabled={pending}
                          onChange={(e) =>
                            run(() => setScheduleActive(s.id, e.target.checked),
                              e.target.checked ? "Schedule on." : "Schedule off.")}
                          className="size-4 rounded accent-brand-600"
                          aria-label={`${s.name} active`}
                        />
                        <span className={s.is_active ? "" : "opacity-55"}>
                          <strong>{s.name}</strong> — {trig?.relative
                            ? `${humanOffset(s.offset_minutes)} ${s.trigger === "before_appointment" ? "before" : "after"}`
                            : trig?.label.toLowerCase()}
                          {" · to "}
                          {AUDIENCES.find((a) => a.value === s.audience)?.label.toLowerCase()}
                        </span>
                        <span className="flex-1" />
                        {s.last_run_at && (
                          <span className="text-[11px] text-faint">
                            last swept {new Date(s.last_run_at).toLocaleDateString()}
                          </span>
                        )}
                        <button type="button" disabled={pending}
                          onClick={() => run(() => deleteSchedule(s.id), "Schedule removed.")}
                          className="text-[12px] text-faint hover:text-red-600">
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* ------------------------------------------------ editor */}
      <Dialog
        open={editing !== null || creating}
        onClose={() => { setEditing(null); setCreating(false); }}
        width="40rem"
        title={creating ? "New template" : `Edit ${editing?.name ?? ""}`}
        footer={
          <>
            <Button variant="secondary" className="flex-1"
              onClick={() => { setEditing(null); setCreating(false); }}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={pending || unknown.length > 0 || draftBody.trim().length < 5}
              onClick={() => creating
                ? run(() => createTemplate({
                    name: draftName, channel: "whatsapp", body: draftBody,
                    contentSid: draftSid || null,
                  }), "Template added.")
                : editing && run(() => updateTemplate(editing.id, {
                    name: draftName, body: draftBody, contentSid: draftSid || null,
                  }), "Template saved.")}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)}
              className={fieldClass} placeholder="Session reminder" />
          </Field>

          <Field label="Message" required>
            <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)}
              rows={9} className={`${fieldClass} resize-y font-mono text-[12px]`} />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <button key={p.key} type="button"
                onClick={() => setDraftBody((b) => `${b}{{${p.key}}}`)}
                title={p.label}
                className="text-[11px] px-2 py-1 rounded-full border border-hairline hover:bg-card-muted font-mono">
                {`{{${p.key}}}`}
              </button>
            ))}
          </div>

          {unknown.length > 0 && (
            <Alert tone="error">
              Unknown placeholder{unknown.length > 1 ? "s" : ""}:{" "}
              {unknown.map((u) => `{{${u}}}`).join(", ")} — these would be sent
              to the client exactly as written.
            </Alert>
          )}

          <div>
            <span className="block text-[13px] font-medium mb-1.5">
              How the client will see it
            </span>
            <pre className="text-[12px] whitespace-pre-wrap break-words bg-sage-50 dark:bg-sage-500/10 border border-sage-200 dark:border-sage-500/25 rounded-xl p-3 max-h-56 overflow-y-auto">
              {preview}
            </pre>
            <p className="text-[12px] text-faint mt-1.5">
              {stats.characters} characters
              {stats.overWhatsAppLimit && " — over WhatsApp's 1024 limit"}
              {` · about ${stats.smsSegments} SMS segment${stats.smsSegments === 1 ? "" : "s"} if it falls back to SMS`}
            </p>
          </div>

          <Field label="Approved WhatsApp template (Content SID)"
            hint="From Twilio's Content Template Builder. Needed in production.">
            <input value={draftSid} onChange={(e) => setDraftSid(e.target.value)}
              className={fieldClass} placeholder="HX…" />
          </Field>

          {editing && !editing.is_system && (
            <button type="button" disabled={pending}
              onClick={() => run(() => deleteTemplate(editing.id), "Template deleted.")}
              className="text-[12px] text-faint hover:text-red-600">
              Delete this template
            </button>
          )}
        </div>
      </Dialog>

      {/* ---------------------------------------------- schedule */}
      <Dialog
        open={schedFor !== null}
        onClose={() => setSchedFor(null)}
        title={`Schedule ${schedFor?.name ?? ""}`}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setSchedFor(null)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={pending || schedName.trim().length < 2}
              onClick={() => schedFor && run(() => createSchedule({
                templateId: schedFor.id, name: schedName, trigger: schedTrigger,
                offsetMinutes: Number(schedDays) * 1440 + Number(schedHours) * 60,
                audience: schedAudience,
              }), "Schedule added.")}>
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name it" required hint="So you can tell schedules apart later.">
            <input value={schedName} onChange={(e) => setSchedName(e.target.value)}
              className={fieldClass} placeholder="Three days before" />
          </Field>

          <Field label="When">
            <select value={schedTrigger} onChange={(e) => setSchedTrigger(e.target.value as MessageTrigger)}
              className={fieldClass}>
              {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          {relative && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Days">
                <input type="number" min={0} max={60} value={schedDays}
                  onChange={(e) => setSchedDays(e.target.value)} className={fieldClass} />
              </Field>
              <Field label="Hours">
                <input type="number" min={0} max={23} value={schedHours}
                  onChange={(e) => setSchedHours(e.target.value)} className={fieldClass} />
              </Field>
            </div>
          )}

          <Field label="Send to">
            <select value={schedAudience} onChange={(e) => setSchedAudience(e.target.value as MessageAudience)}
              className={fieldClass}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </Field>

          <p className="text-[12px] text-faint leading-relaxed">
            Scheduled messages go out with the daily sweep. Every schedule
            hangs off a real appointment — WhatsApp treats messaging everyone
            on a recurring basis as marketing, which needs its own approval
            and opt-in.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
