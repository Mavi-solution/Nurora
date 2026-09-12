"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, fieldClass } from "@/components/ui";
import { saveBooking } from "@/lib/actions/interests";
import { formatMoney } from "@/lib/format";
import type {
  AppointmentTag,
  AttachmentKind,
  ClientSummary,
  ClientType,
  CounsellorSummary,
  Service,
  SessionMode,
} from "@/lib/types";
import type { Slot } from "@/lib/time";

const MODES: { value: SessionMode; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "offline_walk_in", label: "Offline - Walk-in" },
];

const ATTACHMENTS: { value: AttachmentKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "recording", label: "Recording" },
  { value: "voice_note", label: "Voice note" },
  { value: "note", label: "Note" },
];

const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];

const STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In session" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
] as const;

/**
 * One dialog, two outcomes.
 *
 * Interest and Booked are not cosmetic variants: an interest records a
 * lead who has NOT paid and deliberately holds no slot, so it needs no
 * time and cannot collide with anything. A booking takes a real slot,
 * raises an invoice and messages the client. The form makes that
 * difference visible rather than burying it in a flag.
 */
export function BookingDialog({
  open,
  onClose,
  counsellors,
  clients,
  services,
  tags,
  defaultCounsellorId,
  defaultStartsAt,
  dateKey,
  tz,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  counsellors: CounsellorSummary[];
  clients: ClientSummary[];
  services: Service[];
  tags: AppointmentTag[];
  defaultCounsellorId?: string;
  defaultStartsAt?: string;
  dateKey: string;
  tz: string;
  onSaved: (result: { kind: "interest" | "booked"; id: string }) => void;
}) {
  const [bookingStatus, setBookingStatus] = useState<"interest" | "booked">("booked");
  const [clientType, setClientType] = useState<ClientType>("new");
  const [clientId, setClientId] = useState("");

  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  const [serviceId, setServiceId] = useState("");
  const [counsellorId, setCounsellorId] = useState(defaultCounsellorId ?? "");
  const [date, setDate] = useState(dateKey);
  const [startsAt, setStartsAt] = useState(defaultStartsAt ?? "");
  const [mode, setMode] = useState<SessionMode>("offline");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [attachment, setAttachment] = useState<AttachmentKind>("none");
  const [attachmentNote, setAttachmentNote] = useState("");
  const [advancePaid, setAdvancePaid] = useState(false);
  const [status, setStatus] = useState<(typeof STATUSES)[number]["value"]>("scheduled");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const service = services.find((s) => s.id === serviceId);
  const isInterest = bookingStatus === "interest";

  // Group the price list the way the dropdown reads best.
  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of services) {
      const key = s.category ?? "Other";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [services]);

  // Reset each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setBookingStatus("booked");
    setClientType("new");
    setClientId("");
    setFullName("");
    setGender("");
    setAge("");
    setWhatsapp("");
    setServiceId("");
    setCounsellorId(defaultCounsellorId ?? "");
    setDate(defaultStartsAt ? defaultStartsAt.slice(0, 10) : dateKey);
    setStartsAt(defaultStartsAt ?? "");
    setMode("offline");
    setTagIds([]);
    setAttachment("none");
    setAttachmentNote("");
    setAdvancePaid(false);
    setStatus("scheduled");
    setError(null);
  }, [open, defaultCounsellorId, defaultStartsAt, dateKey]);

  // Picking a returning client fills their details in.
  useEffect(() => {
    if (clientType !== "follow_up" || !clientId) return;
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    setFullName(c.full_name);
    setAge(c.age != null ? String(c.age) : "");
    setWhatsapp(c.phone ?? "");
  }, [clientType, clientId, clients]);

  // Slots only matter for a booking — an interest holds nothing.
  useEffect(() => {
    if (!open || isInterest || !counsellorId || !service) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setLoadingSlots(true);

    fetch(
      `/api/slots?counsellor=${counsellorId}&date=${date}&duration=${service.duration_minutes}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, isInterest, counsellorId, date, service]);

  function toggleTag(id: string) {
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  function submit() {
    setError(null);

    if (clientType === "follow_up" && !clientId) return setError("Pick the returning client.");
    if (fullName.trim().length < 2) return setError("Enter the client's name.");
    if (!serviceId) return setError("Choose a service.");
    if (!counsellorId) return setError("Choose a counsellor.");
    if (!isInterest && !startsAt) return setError("Pick a time slot.");

    startTransition(async () => {
      const result = await saveBooking({
        bookingStatus,
        clientType,
        clientId: clientType === "follow_up" ? clientId : null,
        fullName,
        gender: gender || null,
        age: age ? Number(age) : null,
        whatsapp: whatsapp || null,
        serviceId,
        counsellorId,
        onDate: date,
        startsAt: isInterest ? null : startsAt,
        mode,
        tagIds,
        attachment,
        attachmentNote: attachmentNote || null,
        status: isInterest ? undefined : status,
        advancePaid: isInterest ? undefined : advancePaid,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="34rem"
      title={isInterest ? "New interest" : "New appointment"}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={submit} disabled={pending}>
            {pending
              ? "Saving…"
              : isInterest
                ? "Save as Interest"
                : "Book appointment"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {/* ------------------------------------------------ client type */}
        <fieldset>
          <legend className="text-[12px] text-muted mb-2">Client type</legend>
          <div className="rounded-xl border border-hairline overflow-hidden">
            {(["new", "follow_up"] as ClientType[]).map((t) => (
              <label
                key={t}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-hairline last:border-0 ${
                  clientType === t ? "bg-card-muted" : "hover:bg-card-muted/60"
                }`}
              >
                <input
                  type="radio"
                  name="clientType"
                  checked={clientType === t}
                  onChange={() => {
                    setClientType(t);
                    if (t === "new") {
                      setClientId("");
                      setFullName("");
                      setAge("");
                      setWhatsapp("");
                    }
                  }}
                  className="size-4 accent-brand-600"
                />
                <span className="text-[14px] font-medium">
                  {t === "new" ? "New client" : "Follow-up"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* --------------------------------------------- booking status */}
        <fieldset>
          <legend className="text-[12px] text-muted mb-2">Booking status</legend>
          <div className="grid grid-cols-2 gap-3">
            {(["interest", "booked"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setBookingStatus(s)}
                aria-pressed={bookingStatus === s}
                className={`h-11 rounded-xl border text-[14px] font-medium transition-colors ${
                  bookingStatus === s
                    ? "bg-brand-700 border-brand-700 text-white"
                    : "border-hairline hover:bg-card-muted"
                }`}
              >
                {s === "interest" ? "Interest" : "Booked"}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted mt-2">
            {isInterest
              ? "They haven't paid yet — this won't hold the slot."
              : "Payment confirmed, this locks the slot."}
          </p>
        </fieldset>

        {/* ------------------------------------------------- the client */}
        {clientType === "follow_up" && (
          <Field label="Returning client" required>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                  {c.age ? ` · ${c.age}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Client name" required>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className={fieldClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Gender">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={fieldClass}
            >
              <option value="">Select gender</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label="Age">
            <input
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Age"
              className={fieldClass}
            />
          </Field>
        </div>

        {/* ------------------------------------------------- the service */}
        <Field
          label="Service / Category"
          required
          hint={service ? `${formatMoney(service.price_cents, service.currency)} · ${service.duration_minutes} minutes` : undefined}
        >
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setStartsAt("");
            }}
            className={fieldClass}
          >
            <option value="">Select service</option>
            {grouped.map(([category, list]) => (
              <optgroup key={category} label={category}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {formatMoney(s.price_cents, s.currency)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setStartsAt("");
              }}
              className={fieldClass}
            />
          </Field>
          <Field label="Counsellor" required>
            <select
              value={counsellorId}
              onChange={(e) => {
                setCounsellorId(e.target.value);
                setStartsAt("");
              }}
              className={fieldClass}
            >
              <option value="">Select counsellor</option>
              {counsellors.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* ---------------------------------------------------- the slot */}
        {!isInterest && (
          <div>
            <span className="block text-[13px] font-medium mb-1.5 is-required">
              Time
            </span>
            {!serviceId || !counsellorId ? (
              <p className="text-[13px] text-muted py-2">
                Choose a service and counsellor to see open times.
              </p>
            ) : loadingSlots ? (
              <p className="text-[13px] text-muted py-2">Checking availability…</p>
            ) : slots.length === 0 ? (
              <p className="text-[13px] text-muted py-2">
                No open slots that day. Try another date — or save this as an
                Interest, which holds nothing.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto pr-1">
                {slots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    onClick={() => setStartsAt(slot.startsAt)}
                    className={`h-9 rounded-lg border text-[13px] tabular-nums transition-colors ${
                      slot.startsAt === startsAt
                        ? "bg-brand-600 border-brand-600 text-white font-medium"
                        : "border-hairline bg-card hover:bg-card-muted text-muted"
                    }`}
                  >
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: tz,
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(slot.startsAt))}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- the mode */}
        <fieldset>
          <legend className="text-[13px] font-medium mb-1.5">Mode</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                aria-pressed={mode === m.value}
                className={`h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                  mode === m.value
                    ? "bg-brand-700 border-brand-700 text-white font-medium"
                    : "border-hairline hover:bg-card-muted"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="WhatsApp number" hint="Confirmations and reminders go here.">
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="e.g. 98400 11223"
            inputMode="tel"
            className={fieldClass}
          />
        </Field>

        {/* ---------------------------------------------------- the tags */}
        {tags.length > 0 && (
          <fieldset>
            <legend className="text-[13px] font-medium mb-1.5">Tags</legend>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  aria-pressed={tagIds.includes(t.id)}
                  className={`h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                    tagIds.includes(t.id)
                      ? "bg-brand-700 border-brand-700 text-white font-medium"
                      : "border-hairline hover:bg-card-muted"
                  }`}
                >
                  {t.label} <span className="opacity-60">({t.abbreviation})</span>
                </button>
              ))}
            </div>
            <p className="text-[12px] text-faint mt-1.5">
              Select any that apply — shown to the counsellor under the client&apos;s name.
            </p>
          </fieldset>
        )}

        {/* ---------------------------------------------- the attachment */}
        <fieldset>
          <legend className="text-[13px] font-medium mb-1.5">Attachment</legend>
          <div className="flex flex-wrap gap-2">
            {ATTACHMENTS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAttachment(a.value)}
                aria-pressed={attachment === a.value}
                className={`h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                  attachment === a.value
                    ? "bg-brand-700 border-brand-700 text-white font-medium"
                    : "border-hairline hover:bg-card-muted"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-faint mt-1.5">
            Optional. Automatically deleted after 30 days.
          </p>

          {attachment === "note" && (
            <textarea
              value={attachmentNote}
              onChange={(e) => setAttachmentNote(e.target.value)}
              rows={3}
              placeholder="Type the note…"
              className={`${fieldClass} resize-y mt-2`}
            />
          )}

          {(attachment === "recording" || attachment === "voice_note") && (
            <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl px-3 py-2">
              The {attachment === "recording" ? "recording" : "voice note"} is
              recorded against this booking and expires in 30 days, but file
              upload is not wired up yet — attach the file separately for now.
            </p>
          )}
        </fieldset>

        {/* ------------------------------------------- booking-only bits */}
        {!isInterest && (
          <>
            <fieldset>
              <legend className="text-[13px] font-medium mb-1.5">Advance payment</legend>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={advancePaid}
                  onChange={(e) => setAdvancePaid(e.target.checked)}
                  className="size-4 rounded accent-brand-600"
                />
                <span className="text-[13px]">Advance received</span>
              </label>
              <p className="text-[12px] text-faint mt-1.5">
                Mark it paid directly. Uploading proof is not wired up yet.
              </p>
            </fieldset>

            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className={fieldClass}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
