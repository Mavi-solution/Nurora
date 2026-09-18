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
export type SessionMode = "online" | "offline" | "offline_walk_in";
export type AttachmentKind = "none" | "recording" | "voice_note" | "note";
export type InterestStatus = "scheduled" | "converted" | "dropped";
export type ClientType = "new" | "follow_up";

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
  /** Which of those they would rather work in. */
  preferred_language: string | null;
  /** Freelance counsellor: paid per completed session, not salaried. */
  is_nulancer: boolean;
  nulancer_individual_cents: number | null;
  nulancer_couple_cents: number | null;
  /** Probation window on an issued temporary password. */
  tpin_expires_at: string | null;
  signup_completed_at: string | null;
  must_change_password: boolean;
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
  mode: SessionMode;
  client_type: ClientType;
  tag_ids: string[];
  attachment: AttachmentKind;
  attachment_note: string | null;
  attachment_path: string | null;
  attachment_expires_at: string | null;
  /* --- the five milestones (see business/milestones.ts) --------------
   * Step 3 has no column: it is derived from `status`, so the tracker
   * can never disagree with what the session timer actually did. */
  message_sent_at: string | null;
  call_made_at: string | null;
  nubill_at: string | null;
  persona_at: string | null;
  /** Advance owed upfront, from the tiered rule in business/billing.ts. */
  advance_cents: number;
  advance_paid_at: string | null;
  advance_proof_path: string | null;
  /** 'moved' once superseded by rescheduled_to_id; null otherwise. */
  reschedule_status: "moved" | null;
  /** The appointment that replaced this one. */
  rescheduled_to_id: string | null;
  /** The appointment this one replaced. */
  rescheduled_from_id: string | null;
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

/** One side of a 1:1 staff thread. Threads are identified by the pair. */
export type DirectMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

/** A colleague you can message, plus the state of your thread with them. */
export type StaffMate = Pick<
  Profile,
  "id" | "full_name" | "avatar_url" | "role" | "is_admin"
> & {
  unread: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

/** One line on the clinic's price list. A service has ONE price. */
export type Service = {
  id: string;
  name: string;
  category: string | null;
  price_cents: number;
  currency: string;
  duration_minutes: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** A short label shown to the counsellor under the client's name. */
export type AppointmentTag = {
  id: string;
  label: string;
  abbreviation: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

/**
 * A lead who has not paid. Deliberately holds no slot — see migration
 * 0008: it lives outside `appointments` so the overlap constraint
 * cannot reserve a time for it.
 */
export type Interest = {
  id: string;
  client_id: string | null;
  client_type: ClientType;
  full_name: string;
  gender: string | null;
  age: number | null;
  whatsapp: string | null;
  service_id: string | null;
  counsellor_id: string | null;
  on_date: string | null;
  mode: SessionMode;
  tag_ids: string[];
  attachment: AttachmentKind;
  attachment_note: string | null;
  attachment_path: string | null;
  attachment_expires_at: string | null;
  status: InterestStatus;
  notes: string | null;
  converted_appointment_id: string | null;
  converted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InterestRow = Interest & {
  service: Pick<Service, "id" | "name" | "price_cents" | "currency"> | null;
  counsellor: Pick<Profile, "id" | "full_name" | "avatar_url"> | null;
};

/** Booked / Reschedule / Interest / Cancelled — the BRIC tabs. */
export type BricTab = "booked" | "reschedule" | "interest" | "cancelled";

/** One row in the BRIC view, flattened from appointments or interests. */
export type BricRow = {
  id: string;
  client: string;
  /** Null for non-admins — the counsellor view is stripped of contacts. */
  phone: string | null;
  counsellor: string | null;
  service: string | null;
  when: string | null;
  status: string;
  detail: string;
  href: string;
  /**
   * The replacement session, on a row under Reschedule. Lets the board
   * link straight to where a moved session went instead of only saying
   * that it moved.
   */
  movedToId?: string | null;
  /** This row is a live booking that can still be moved. */
  canReschedule?: boolean;
};

/** The clinic's one configuration row. */
export type ClinicSettings = {
  id: boolean;
  practice_name: string;
  advance_tier_threshold_cents: number;
  advance_at_or_below_cents: number;
  advance_above_cents: number;
  full_payment_modes: string[];
  included_minutes: number;
  grace_minutes: number;
  extension_block_minutes: number;
  extension_block_cents: number;
  grace_mode: "gate" | "deduct";
  clinic_latitude: number | null;
  clinic_longitude: number | null;
  check_in_radius_m: number;
  check_out_radius_m: number;
  geofence_enforced: boolean;
  confirmation_template: string | null;
  signin_quote: string | null;
  designer_credit_url: string | null;
  nulancer_individual_cents: number;
  nulancer_couple_cents: number;
  review_monthly_target: number;
  /** Weekdays the clinic opens at all, 0 = Sunday. */
  open_weekdays: number[];
  updated_by: string | null;
  updated_at: string;
};

/** Per-feature switches. An absent row means everything is on. */
export type CounsellorPermissions = {
  counsellor_id: string;
  attendance: boolean;
  nubills: boolean;
  persona: boolean;
  bric: boolean;
  reviews: boolean;
  follow_ups: boolean;
  my_summary: boolean;
  week_offs: boolean;
  updated_at: string;
};

export type PermissionKey = keyof Omit<
  CounsellorPermissions,
  "counsellor_id" | "updated_at"
>;

export type Review = {
  id: string;
  counsellor_id: string | null;
  client_id: string | null;
  client_name: string;
  rating: number | null;
  body: string | null;
  review_url: string | null;
  reviewed_on: string;
  logged_by: string | null;
  created_at: string;
};

/** "Send this thing to this client." */
export type FollowUp = {
  id: string;
  client_id: string | null;
  counsellor_id: string | null;
  what: string;
  due_on: string;
  completed_at: string | null;
  /** How it was finished — 'whatsapp' means it was actually sent. */
  completed_via: "whatsapp" | "manual" | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Commitment = {
  id: string;
  owner_id: string;
  title: string;
  detail: string | null;
  due_on: string | null;
  done_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Benefit = {
  id: string;
  counsellor_id: string;
  name: string;
  detail: string | null;
  value_cents: number | null;
  granted_on: string;
  expires_on: string | null;
  granted_by: string | null;
  created_at: string;
};

export type MessageTrigger =
  | "before_appointment"
  | "after_appointment"
  | "on_booking"
  | "on_reschedule"
  | "on_cancel";

export type MessageAudience = "client" | "counsellor" | "both";

export type MessageTemplate = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  channel: NotifyChannel;
  body: string;
  /** Approved Meta template, needed for business-initiated sends. */
  content_sid: string | null;
  /** Which placeholders map to {{1}}, {{2}} … in that Meta template. */
  variables: string[];
  is_active: boolean;
  /** Referred to by key in code — editable, but never deletable. */
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type MessageSchedule = {
  id: string;
  template_id: string;
  name: string;
  trigger: MessageTrigger;
  offset_minutes: number;
  audience: MessageAudience;
  is_active: boolean;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageTemplateWithSchedules = MessageTemplate & {
  schedules: MessageSchedule[];
};

export type LeaveKind = "planned" | "sick" | "unpaid" | "auto";

/** An org-wide closure. Applies to everyone. */
export type Holiday = {
  id: string;
  on_date: string;
  name: string;
  created_by: string | null;
  created_at: string;
};

/** A counsellor's own planned day off, counted against the month's quota. */
export type WeekOff = {
  id: string;
  staff_id: string;
  on_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** Any other day off, including one auto-marked from a missed check-in. */
export type Leave = {
  id: string;
  staff_id: string;
  on_date: string;
  kind: LeaveKind;
  reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  appointment_id: string | null;
  kind: string;
  title: string;
  body: string;
  /** In-app path to open. Takes precedence over appointment_id. */
  link: string | null;
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
  | "preferred_language"
> & {
  /**
   * What they specialise in, as plain names.
   *
   * Carried on the summary rather than fetched per screen because
   * every booking surface has to show it: QA reported the counsellor
   * dropdowns as unusable precisely because a list of bare names gives
   * the desk nothing to choose ON. Optional so a caller that has not
   * joined the table yet still type-checks.
   */
  specialisms?: string[];
};

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
  /** No longer on the active roster, but still has bookings to honour. */
  offRoster?: boolean;
};
