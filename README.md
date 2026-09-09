# Nurora

Counselling practice console — scheduling, session time tracking and payments,
with reminders that reach both the counsellor and the client three days before
every appointment.

Next.js 15 (App Router) · Supabase (Postgres + Auth + Realtime) · Vercel.

Sign-up and sign-in use **email and password**. The first account created
becomes a **counsellor with admin rights** — a lane on the schedule plus
full control of the practice.

---

## What it does

**Booking desk** — clients do not book themselves. They call, and whoever
picks up works a three-step flow: find the caller (by phone digits, so
repeat callers never get duplicated), capture their details and what they
need help with, then match them to a counsellor **by specialism and
language** and take a slot from real availability. If the day is full it
offers the next days that are not, so nobody is turned away on the phone.
Every booking records who took it and how it arrived (phone, walk-in,
referral, online).

**Schedule board** — the day's sessions grouped into a lane per counsellor.
A 7-day strip expands to a full month. Each row shows the time, the client,
an inline age chip, and a Start button. Open slots in a counsellor's
availability appear as bookable gaps.

**Two independent timers**
- *Attendance* — "Tap to check in" opens a staff shift; tapping again closes it.
- *Session* — Start opens a confirmation dialog showing the base session fee,
  then runs a live billed timer. End stops it, completes the session and
  stamps the tracked minutes onto the invoice.

**Payments** — every booking raises an invoice. Settle it by hand (UPI, cash,
bank transfer, card, cheque) with a method and reference, refund it, waive it,
or re-price it from the time actually tracked. No payment gateway is wired in.

**Reminders, three days out** — a daily Vercel Cron job finds every session
exactly three days away and notifies **both parties** by email (Resend),
WhatsApp/SMS (Twilio) and in-app. Sends are idempotent: a ledger row per
(appointment, recipient, channel) means re-running the job never double-sends,
while a channel that *failed* is retried the next day.

**Team channel** — a realtime staff-only chat, with a floating composer on the
schedule board that also carries Quick Book and voice dictation (the browser's
built-in SpeechRecognition — no external service, hidden where unsupported).

**Roles**
| Role | Sees |
| --- | --- |
| admin *(a flag)* | Everything: every lane, all clients, payments, roles |
| `counsellor` | The shared board; starts/ends only their own sessions; their own session notes |
| `support` | The booking desk: clients, bookings, counsellors, availability, payments — **but no session notes and no session timers** |
| `client` | Read-only view of their own sessions |

Admin is a **flag rather than a role**, so one person can run sessions as a
counsellor *and* administer the practice.

**Clinical notes are separated by design.** Reception has to read
appointment rows to run the diary, and row-level security cannot hide a
single column — so session notes live in their own `session_notes` table
whose policy admits only the treating counsellor and admins. Support sees
the booking notes from the call; never the case notes.

**Counsellors are added by the practice, not by self-service.** Support or
an admin creates them with a specialism set, the languages they work in, a
fee and a session length, and hands over a temporary password. Their
working hours are then fed in under Availability, which is what makes them
appear in the desk's slot search.

Clients are **records first**: staff create them with a name, age, contact
details, preferred language and what they are calling about. A client only
gets a login if they sign in with the same email or phone, at which point
their account links automatically — and even then it is read-only.

---

## Setup

### 1. Supabase

Create a project, then in **SQL Editor** run:

1. `supabase/migrations/0001_init.sql` — schema, row-level security, triggers
2. `supabase/seed.sql` — *optional* demo data (5 counsellors, clients, a day of
   sessions, and one session exactly 3 days out so the cron has something to send)

**Authentication → Sign In / Providers**:

- **Email** is the only provider Nurora needs. Leave it enabled.
- Turn **Confirm email** *off* if you want new accounts to reach the app
  immediately. Left on, sign-up shows a "check your inbox" screen and the
  account cannot sign in until the link is clicked — that is Supabase's
  behaviour, not a bug in the app, and Nurora handles both cases.
- Nurora ships with a **minimum password length of 8**; raise it under
  Password Requirements if you want, the form will surface the error.

**Google sign-in is off by default.** The button is hidden unless you set
`NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true`, because an unconfigured provider
gives users a button that always fails. To turn it on: create a Google
Cloud OAuth client whose redirect URI is
`https://<project>.supabase.co/auth/v1/callback`, paste the client ID and
secret into **Authentication → Providers → Google**, then set that
environment variable.

In **Authentication → URL Configuration**, add your site URL and
`https://your-app.vercel.app/auth/callback` as a redirect URL.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in the Supabase URL and keys. Everything else is optional — reminders
degrade cleanly, recording a `skipped` delivery rather than failing, when
Resend or Twilio are not configured.

### 3. Run

```bash
npm install
npm run dev
```

**The first account to sign up becomes a counsellor with admin rights.** It
gets its own lane on the schedule and can manage everyone else. Later
sign-ups choose Counsellor or Client on the form and are never admins; an
existing admin grants that from **Settings → People**, where the Admin
checkbox is independent of role — so a counsellor can be an admin too.

Signing in with the demo seed:

| Email | Password | |
| --- | --- | --- |
| `anisha@nurora.demo` | `nurora1234` | counsellor **with admin rights** |
| `shefrin@nurora.demo` | `nurora1234` | counsellor |
| `ramya@nurora.demo` | `nurora1234` | counsellor |
| `mahek@nurora.demo` | `nurora1234` | counsellor |
| `saranya@nurora.demo` | `nurora1234` | counsellor |
| `support@nurora.demo` | `nurora1234` | **booking desk** (support role) |

Sign in as `support@nurora.demo` to see the desk exactly as reception does:
no timesheet, no session notes, disabled Start buttons, but full control of
bookings, clients, counsellors and availability.

### 4. Deploy

Push to GitHub, import into Vercel, add the same environment variables, deploy.
`vercel.json` registers the cron:

```json
{ "crons": [{ "path": "/api/cron/reminders", "schedule": "0 3 * * *" }] }
```

That is 03:00 UTC — 08:30 IST. Set `CRON_SECRET` in Vercel and the endpoint
rejects anything without a matching bearer token.

---

## Checks

```bash
npm run typecheck    # tsc --noEmit
npm run build        # production build
npm run test:logic   # timezone, slot and reminder arithmetic (no services needed)
npm run test:e2e     # full browser walkthrough against a local Supabase stack
npm run test:signup  # first-account bootstrap: counsellor + admin, on an empty DB
npm run test:desk    # the booking desk, driven as reception: lookup → capture → match → book
```

`test:e2e` needs Docker and the local stack (`npx supabase start`). It checks
sign-up validation, rejects a wrong password, signs in properly, then checks
in, starts a session, watches the timer tick, ends it, and confirms the tracked
minutes reached the invoice. It resets the database first, since the
walkthrough completes a session. Screenshots of every step land in
`screenshots/`.

`test:signup` empties the database and signs up through the UI, asserting the
first account really is a counsellor with `is_admin` set, lands on the
schedule, gets a default working week, and that a *second* sign-up is not
made an admin.

`test:desk` signs in as reception and books a session end to end, then checks
what reached the database: the booking channel, the call notes, that the
matched counsellor genuinely holds the requested specialism, that an invoice
was raised, and that reception can read the booking notes but **not** the
session notes.

The logic checks cover DST transitions in both directions, month and year
boundaries, partial-day blocks, and the case where a late-evening IST session
belongs to a different UTC date than its local one.

Trigger the reminder job by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

It returns `{ scanned, due, sent, failed, skipped }`.

---

## Notes on the design

**Double-booking is prevented in the database**, not in application code — a
Postgres exclusion constraint over `(counsellor_id, tstzrange(starts_at, ends_at))`
for live statuses. Two simultaneous bookings for the same slot cannot both win.
Likewise, partial unique indexes enforce at most one running timer per
appointment and per counsellor, and one open shift per staff member.

**Availability is stored as local wall time** (weekday + `time`) in the
counsellor's timezone, and converted to real instants at read time via `Intl`.
Storing UTC instants instead would silently shift working hours across DST.

**Row-level security is the authorisation boundary.** Clients cannot read the
team channel or another client's sessions even if the UI were bypassed;
`is_staff()` and `is_admin()` are `SECURITY DEFINER` so policies can consult
`profiles` without recursing through its own policy.
