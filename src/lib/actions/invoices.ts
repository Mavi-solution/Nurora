"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceStatus } from "@/lib/types";
import { describeDbError, fail, requireStaffProfile } from "./shared";

export async function setInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus,
  method?: string,
  reference?: string,
) {
  await requireStaffProfile();
  const supabase = await createClient();

  const patch: Record<string, unknown> = { status };
  if (status === "paid") {
    patch.paid_at = new Date().toISOString();
    patch.method = method?.trim() || null;
    patch.reference = reference?.trim() || null;
  } else {
    patch.paid_at = null;
  }

  const { error } = await supabase.from("invoices").update(patch).eq("id", invoiceId);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/payments");
  revalidatePath("/schedule");
  return { ok: true as const };
}

export async function setInvoiceAmount(invoiceId: string, amountCents: number) {
  await requireStaffProfile();

  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return fail("Enter a valid amount.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ amount_cents: amountCents })
    .eq("id", invoiceId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/payments");
  return { ok: true as const };
}

/** Re-price an invoice from the time actually tracked. */
export async function rebillFromTrackedTime(invoiceId: string) {
  const profile = await requireStaffProfile();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, appointment_id, counsellor_id, billed_minutes")
    .eq("id", invoiceId)
    .single();

  if (!invoice) return fail("Invoice not found.");

  const { data: counsellor } = await supabase
    .from("profiles")
    .select("hourly_rate_cents")
    .eq("id", invoice.counsellor_id)
    .single();

  const rate = counsellor?.hourly_rate_cents ?? profile.hourly_rate_cents;
  if (!rate) return fail("Set an hourly rate on the counsellor's profile first.");

  const { data: entries } = await supabase
    .from("time_entries")
    .select("duration_minutes")
    .eq("appointment_id", invoice.appointment_id)
    .not("ended_at", "is", null);

  const minutes = (entries ?? []).reduce(
    (sum, e) => sum + (e.duration_minutes ?? 0),
    0,
  );

  if (minutes === 0) return fail("No tracked time on this session yet.");

  const amount = Math.round((rate * minutes) / 60);

  const { error } = await supabase
    .from("invoices")
    .update({ amount_cents: amount, billed_minutes: minutes })
    .eq("id", invoiceId);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/payments");
  return { ok: true as const, data: { amount, minutes } };
}
