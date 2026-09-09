export type UserRole = "client" | "counsellor" | "admin" | "support";
export type BookingChannel = "phone" | "walk_in" | "online" | "referral";

export type AppointmentStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type InvoiceStatus = "draft" | "unpaid" | "paid" | "refunded" | "waived";
export type TimeEntrySource = "timer" | "manual";
export type NotifyChannel = "email" | "sms" | "whatsapp" | "in_app";

export type Profile = {
  id: string;
  role: UserRole;
  /** Admin powers, independent of role: a counsellor can also be an admin. */
  is_admin: boolean;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  timezone: string;
  headline: string | null;
  bio: string | null;
  hourly_rate_cents: number;
  default_session_fee_cents: number;
  default_duration_minutes: number;
  currency: string;
  is_active: boolean;
  onboarded: boolean;
  notify_email: boolean;
  notify_sms: boolean;
  notify_whatsapp: boolean;
  /** Languages this counsellor can hold a session in. */
  languages: string[];
  created_at: string;
  updated_at: string;
};

export type Specialism = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

/** Clinical notes live apart from the appointment so reception cannot read them. */
export type SessionNote = {
  id: string;
  appointment_id: string;
  counsellor_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type Client = {
  id: string;
  user_id: string | null;
  full_name: string;
  age: number | null;
  email: string | null;
  phone: string | null;
  counsellor_id: string | null;
  notes: string | null;
  gender: string | null;
  preferred_language: string | null;
  /** What the caller said they need help with, in their own words. */
  presenting_concern: string | null;
  preferred_specialism_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceType = {
  id: string;
  counsellor_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  currency: string;
  is_active: boolean;
  created_at: string;
};

export type AvailabilityRule = {
  id: string;
  counsellor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: string;
};

export type AvailabilityException = {
  id: string;
  counsellor_id: string;
  on_date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
};

export type Appointment = {
  id: string;
  counsellor_id: string;
  client_id: string;
  service_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  title: string;
  location: string | null;
  meeting_url: string | null;
  client_notes: string | null;
  channel: BookingChannel;
  booking_notes: string | null;
  price_cents: number;
  currency: string;
  booked_by: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TimeEntry = {
  id: string;
  appointment_id: string;
  counsellor_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  source: TimeEntrySource;
  note: string | null;
  created_at: string;
};

export type StaffShift = {
  id: string;
  staff_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  duration_minutes: number | null;
  note: string | null;
};

export type Invoice = {
  id: string;
  appointment_id: string;
  counsellor_id: string;
  client_id: string;
  number: string;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  billed_minutes: number | null;
  issued_at: string;
  due_at: string | null;
  paid_at: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
};

export type TeamMessage = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: Pick<Profile, "id" | "full_name" | "avatar_url" | "role"> | null;
};

export type Notification = {
  id: string;
  user_id: string;
  appointment_id: string | null;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type CounsellorSummary = Pick<
  Profile,
  | "id"
  | "full_name"
  | "avatar_url"
  | "headline"
  | "timezone"
  | "role"
  | "default_session_fee_cents"
  | "default_duration_minutes"
  | "currency"
  | "languages"
>;

/** A counsellor plus what they help with — what the booking desk matches on. */
export type CounsellorWithSkills = CounsellorSummary & {
  email: string | null;
  phone: string | null;
  is_active: boolean;
  specialisms: Specialism[];
};

/** One bookable slot, resolved against a specific counsellor. */
export type MatchedSlot = {
  counsellorId: string;
  counsellorName: string;
  startsAt: string;
  endsAt: string;
  label: string;
};

export type ClientSummary = Pick<
  Client,
  | "id"
  | "full_name"
  | "age"
  | "email"
  | "phone"
  | "user_id"
  | "preferred_language"
  | "presenting_concern"
  | "counsellor_id"
>;

/** An appointment joined with the parties, its open timer and its invoice. */
export type AppointmentRow = Appointment & {
  client: ClientSummary | null;
  counsellor: CounsellorSummary | null;
  time_entries: TimeEntry[];
  invoice: Invoice | null;
};

/** One counsellor's lane on the schedule board. */
export type ScheduleLane = {
  counsellor: CounsellorSummary;
  appointments: AppointmentRow[];
  openSlots: { startsAt: string; endsAt: string; label: string }[];
  isOnShift: boolean;
  activeAppointmentId: string | null;
};
