"use client";

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
  Stat,
  fieldClass,
} from "@/components/ui";
import {
  createService,
  createTag,
  deleteService,
  retireTag,
  updateService,
} from "@/lib/actions/services";
import { formatMoney } from "@/lib/format";
import type { AppointmentTag, Service } from "@/lib/types";

type Draft = {
  id?: string;
  name: string;
  category: string;
  price: string;
  durationMinutes: string;
  sortOrder: string;
  isActive: boolean;
};

const BLANK: Draft = {
  name: "",
  category: "",
  price: "",
  durationMinutes: "60",
  sortOrder: "0",
  isActive: true,
};

/**
 * The clinic price list.
 *
 * One price per service, deliberately: the advance owed is DERIVED from
 * the price by the tiered rule, so there is no per-service advance field
 * to set here. Adding one is the mistake the handoff warns against.
 */
export function ServicesAdmin({
  services,
  tags,
}: {
  services: Service[];
  tags: AppointmentTag[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagLabel, setTagLabel] = useState("");
  const [tagAbbr, setTagAbbr] = useState("");

  const active = services.filter((s) => s.is_active);
  const categories = [...new Set(services.map((s) => s.category).filter(Boolean))];

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; data?: { message?: string } }>,
    ok?: string,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setNotice(result.data?.message ?? ok ?? "Saved.");
      setDraft(null);
      setConfirmDelete(null);
      setTagOpen(false);
      setTagLabel("");
      setTagAbbr("");
      router.refresh();
    });
  }

  function save() {
    if (!draft) return;
    const payload = {
      name: draft.name,
      category: draft.category || null,
      price: draft.price,
      durationMinutes: draft.durationMinutes,
      sortOrder: draft.sortOrder,
      isActive: draft.isActive,
    };
    run(
      () => (draft.id ? updateService(draft.id, payload) : createService(payload)),
      draft.id ? "Service updated." : "Service added.",
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Services &amp; pricing
          </h1>
          <p className="text-[13px] text-muted mt-0.5">
            The clinic price list. One price per service — the advance owed is
            worked out from it, so there is nothing to set per service.
          </p>
        </div>
        <Button onClick={() => setDraft({ ...BLANK })}>Add service</Button>
      </div>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="On the list" value={String(active.length)} sub={`${services.length - active.length} retired`} />
        <Stat label="Categories" value={String(categories.length)} />
        <Stat
          label="Price range"
          value={
            active.length
              ? `${formatMoney(Math.min(...active.map((s) => s.price_cents)))} – ${formatMoney(Math.max(...active.map((s) => s.price_cents)))}`
              : "—"
          }
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Price list"
          description="Shown in the booking dialog, grouped by category."
        />

        {services.length === 0 ? (
          <EmptyState title="No services yet" description="Add the first one to start booking." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-[0.08em] text-faint">
                  <th className="px-5 py-2.5 font-medium">Service</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium text-right">Price</th>
                  <th className="px-3 py-2.5 font-medium text-right">Minutes</th>
                  <th className="px-5 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b border-hairline last:border-0 ${s.is_active ? "" : "opacity-55"}`}
                  >
                    <td className="px-5 py-3">
                      <span className="font-medium">{s.name}</span>
                      {!s.is_active && <Pill className="ml-2">Retired</Pill>}
                    </td>
                    <td className="px-3 py-3 text-muted">{s.category ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      {formatMoney(s.price_cents, s.currency)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">
                      {s.duration_minutes}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            setDraft({
                              id: s.id,
                              name: s.name,
                              category: s.category ?? "",
                              price: String(s.price_cents / 100),
                              durationMinutes: String(s.duration_minutes),
                              sortOrder: String(s.sort_order),
                              isActive: s.is_active,
                            })
                          }
                          className="text-[12px] text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => updateService(s.id, { isActive: !s.is_active }),
                              s.is_active ? "Service retired." : "Service restored.",
                            )
                          }
                          className="text-[12px] text-muted hover:text-body"
                        >
                          {s.is_active ? "Retire" : "Restore"}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setConfirmDelete(s)}
                          className="text-[12px] text-faint hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------- tags */}
      <Card className="mt-4">
        <CardHeader
          title="Appointment tags"
          description="Short labels shown to the counsellor under the client's name."
          action={
            <Button variant="secondary" size="sm" onClick={() => setTagOpen(true)}>
              Add tag
            </Button>
          }
        />
        <div className="px-5 py-4 flex flex-wrap gap-2">
          {tags.length === 0 && (
            <p className="text-[13px] text-muted">No tags yet.</p>
          )}
          {tags.map((t) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] ${
                t.is_active ? "border-hairline" : "border-hairline opacity-50"
              }`}
            >
              {t.label}
              <span className="text-faint">({t.abbreviation})</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => retireTag(t.id, !t.is_active),
                    t.is_active ? "Tag retired." : "Tag restored.",
                  )
                }
                className="text-[11px] text-muted hover:text-body"
              >
                {t.is_active ? "Retire" : "Restore"}
              </button>
            </span>
          ))}
        </div>
        <p className="px-5 pb-4 text-[12px] text-faint">
          Tags are retired rather than deleted — bookings store tag ids, so
          removing one outright would leave past appointments referring to
          nothing.
        </p>
      </Card>

      {/* ------------------------------------------------------- dialogs */}
      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit service" : "Add a service"}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={save}
              disabled={pending || !draft?.name.trim() || draft?.price === ""}
            >
              {pending ? "Saving…" : draft?.id ? "Save changes" : "Add service"}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Name" required>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Child Therapy"
                className={fieldClass}
                autoFocus
              />
            </Field>

            <Field label="Category" hint="Groups the booking dropdown.">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder="Child & adolescent"
                list="service-categories"
                className={fieldClass}
              />
              <datalist id="service-categories">
                {categories.map((c) => (
                  <option key={c} value={c ?? ""} />
                ))}
              </datalist>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (₹)" required>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  placeholder="2000"
                  className={fieldClass}
                />
              </Field>
              <Field label="Minutes" required>
                <input
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={draft.durationMinutes}
                  onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })}
                  className={fieldClass}
                />
              </Field>
            </div>

            <Field label="Sort order" hint="Lower numbers appear first.">
              <input
                type="number"
                min={0}
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                className={fieldClass}
              />
            </Field>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                className="size-4 rounded accent-brand-600"
              />
              <span className="text-[13px]">Offer this service when booking</span>
            </label>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ?? "service"}?`}
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={pending}
              onClick={() => confirmDelete && run(() => deleteService(confirmDelete.id))}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted leading-relaxed">
          If this service is already on a booking it will be <strong>retired</strong>
          {" "}instead of deleted, so past sessions still say what they were for.
          Only an unused service is removed outright.
        </p>
      </Dialog>

      <Dialog
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        title="Add a tag"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setTagOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending || !tagLabel.trim() || !tagAbbr.trim()}
              onClick={() => run(() => createTag(tagLabel, tagAbbr), "Tag added.")}
            >
              Add tag
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Label" required>
            <input
              value={tagLabel}
              onChange={(e) => setTagLabel(e.target.value)}
              placeholder="Gestalt"
              className={fieldClass}
              autoFocus
            />
          </Field>
          <Field label="Short form" required hint="Shown in brackets, e.g. (Ges).">
            <input
              value={tagAbbr}
              onChange={(e) => setTagAbbr(e.target.value)}
              placeholder="Ges"
              maxLength={8}
              className={fieldClass}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
