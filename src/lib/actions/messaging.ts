"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  unknownPlaceholders,
  messageStats,
} from "@/lib/business/render-message";
import { createClient } from "@/lib/supabase/server";
import type {
  MessageSchedule,
  MessageTemplateWithSchedules,
} from "@/lib/types";
import {
  describeDbError,
  fail,
  profileIsAdmin,
  requireStaffProfile,
} from "./shared";

async function requireAdmin() {
  const profile = await requireStaffProfile();
  if (!profileIsAdmin(profile)) throw new Error("Admin access required");
  return profile;
}

export async function listTemplates(): Promise<MessageTemplateWithSchedules[]> {
  await requireStaffProfile();
  const supabase = await createClient();

  const [{ data: templates }, { data: schedules }] = await Promise.all([
    supabase.from("message_templates").select("*").order("is_system", { ascending: false }).order("name"),
    supabase.from("message_schedules").select("*").order("offset_minutes"),
  ]);

  const byTemplate = new Map<string, MessageSchedule[]>();
  for (const s of (schedules ?? []) as MessageSchedule[]) {
    byTemplate.set(s.template_id, [...(byTemplate.get(s.template_id) ?? []), s]);
  }

  return ((templates ?? []) as MessageTemplateWithSchedules[]).map((t) => ({
    ...t,
    schedules: byTemplate.get(t.id) ?? [],
  }));
}

const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullable().optional(),
  channel: z.enum(["whatsapp", "sms", "email", "in_app"]),
  body: z.string().trim().min(5).max(4000),
  contentSid: z.string().trim().max(64).nullable().optional(),
  variables: z.array(z.string()).max(10).optional(),
  isActive: z.boolean().optional(),
});

/** Checks that apply wherever a template is written. */
function vetBody(body: string, channel: string): string | null {
  const unknown = unknownPlaceholders(body);
  if (unknown.length > 0) {
    return `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown
      .map((u) => `{{${u}}}`)
      .join(", ")}. Check the list of available ones.`;
  }
  const stats = messageStats(body);
  if (channel === "whatsapp" && stats.overWhatsAppLimit) {
    return `WhatsApp allows 1024 characters; this is ${stats.characters}.`;
  }
  return null;
}

export async function updateTemplate(id: string, input: unknown) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change message templates.");
  }

  const parsed = templateSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("message_templates")
    .select("channel, body")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return fail("That template no longer exists.");

  const body = v.body ?? (existing.body as string);
  const channel = v.channel ?? (existing.channel as string);
  const problem = vetBody(body, channel);
  if (problem) return fail(problem);

  const patch: Record<string, unknown> = {};
  if (v.name !== undefined) patch.name = v.name;
  if (v.description !== undefined) patch.description = v.description || null;
  if (v.channel !== undefined) patch.channel = v.channel;
  if (v.body !== undefined) patch.body = v.body;
  if (v.contentSid !== undefined) patch.content_sid = v.contentSid || null;
  if (v.variables !== undefined) patch.variables = v.variables;
  if (v.isActive !== undefined) patch.is_active = v.isActive;

  if (Object.keys(patch).length === 0) return fail("Nothing to change.");

  const { error } = await supabase.from("message_templates").update(patch).eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/messages");
  return { ok: true as const };
}

export async function createTemplate(input: unknown) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can add message templates.");
  }

  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const problem = vetBody(v.body, v.channel);
  if (problem) return fail(problem);

  const key = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (!key) return fail("Give the template a name with some letters in it.");

  const supabase = await createClient();
  const { error } = await supabase.from("message_templates").insert({
    key,
    name: v.name,
    description: v.description || null,
    channel: v.channel,
    body: v.body,
    content_sid: v.contentSid || null,
    variables: v.variables ?? [],
    is_active: v.isActive ?? true,
    is_system: false,
  });

  if (error) {
    if (error.code === "23505") return fail("A template with that name already exists.");
    return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/messages");
  return { ok: true as const };
}

export async function deleteTemplate(id: string) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can remove message templates.");
  }

  const supabase = await createClient();
  const { data: t } = await supabase
    .from("message_templates")
    .select("is_system, name")
    .eq("id", id)
    .maybeSingle();

  if (!t) return fail("That template no longer exists.");
  if (t.is_system) {
    return fail(
      `${t.name} is built in — the app sends it by name, so removing it would break sending silently. Switch it off instead.`,
    );
  }

  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/messages");
  return { ok: true as const };
}

/* ------------------------------------------------------------ schedules */

const scheduleSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  trigger: z.enum([
    "before_appointment",
    "after_appointment",
    "on_booking",
    "on_reschedule",
    "on_cancel",
  ]),
  offsetMinutes: z.coerce.number().int().min(0).max(60 * 24 * 60),
  audience: z.enum(["client", "counsellor", "both"]),
  isActive: z.boolean().optional(),
});

export async function createSchedule(input: unknown) {
  let profile;
  try {
    profile = await requireAdmin();
  } catch {
    return fail("Only an admin can schedule messages.");
  }

  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  // An offset only means something for the two relative triggers; the
  // on_* kinds fire the moment the thing happens.
  const relative =
    v.trigger === "before_appointment" || v.trigger === "after_appointment";
  if (relative && v.offsetMinutes === 0) {
    return fail("Say how long before or after the appointment to send it.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("message_schedules").insert({
    template_id: v.templateId,
    name: v.name,
    trigger: v.trigger,
    offset_minutes: relative ? v.offsetMinutes : 0,
    audience: v.audience,
    is_active: v.isActive ?? true,
    created_by: profile.id,
  });

  if (error) {
    if (error.code === "23505") {
      return fail("That template already has a schedule at exactly that moment.");
    }
    return fail(describeDbError(error.message, error.code));
  }

  revalidatePath("/messages");
  return { ok: true as const };
}

export async function setScheduleActive(id: string, isActive: boolean) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can change schedules.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("message_schedules")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/messages");
  return { ok: true as const };
}

export async function deleteSchedule(id: string) {
  try {
    await requireAdmin();
  } catch {
    return fail("Only an admin can remove schedules.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("message_schedules").delete().eq("id", id);
  if (error) return fail(describeDbError(error.message, error.code));

  revalidatePath("/messages");
  return { ok: true as const };
}
