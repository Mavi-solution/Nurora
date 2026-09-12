import { z } from "zod";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The shared shape behind the booking dialog. The same form submits
 * either an interest or a booking; `bookingStatus` decides which, and
 * the two differ in one crucial way — an interest never holds a slot,
 * so it has no start time and never touches `appointments`.
 */
export const bookingFormSchema = z.object({
  bookingStatus: z.enum(["interest", "booked"]),
  clientType: z.enum(["new", "follow_up"]),

  /** Required for a follow-up; ignored for a new client. */
  clientId: z.string().uuid().optional().nullable(),

  fullName: z.string().trim().min(2).max(120),
  gender: z.string().trim().max(40).optional().nullable(),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  whatsapp: z.string().trim().max(40).optional().nullable(),

  serviceId: z.string().uuid(),
  counsellorId: z.string().uuid(),
  onDate: z.string().regex(DATE_KEY, "Pick a date."),

  /** Only a booking needs a time — an interest holds nothing. */
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),

  mode: z.enum(["online", "offline", "offline_walk_in"]),
  tagIds: z.array(z.string().uuid()).max(20).optional(),

  attachment: z.enum(["none", "recording", "voice_note", "note"]).optional(),
  attachmentNote: z.string().trim().max(4000).optional().nullable(),

  status: z
    .enum(["scheduled", "in_progress", "completed", "cancelled", "no_show"])
    .optional(),

  /** Booking only: the desk confirmed the advance was received. */
  advancePaid: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type BookingFormInput = z.input<typeof bookingFormSchema>;
