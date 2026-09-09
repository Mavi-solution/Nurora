# Nurora

Counselling practice console — scheduling, session time tracking and payments,
with reminders that reach both the counsellor and the client three days before
every appointment.

Next.js 15 (App Router) · Supabase (Postgres + Auth + Realtime) · Vercel.

---

## What it does

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
| `admin` | Every counsellor's lane, all clients, payments, everyone's roles |
| `counsellor` | The shared board; starts/ends only their own sessions |
| `client` | Their own sessions only, and can book into open slots |

Clients are **records first**: staff create them with a name, age and contact
details. A client only gets a login if they sign in with the same email or
phone, at which point their account links automatically.

---

## Setup

### 1. Supabase

Create a project, then in **SQL Editor** run:

1. `supabase/migrations/0001_init.sql` — schema, row-level security, triggers
2. `supabase/seed.sql` — *optional* demo data (5 counsellors, clients, a day of
   sessions, and one session exactly 3 days out so the cron has something to send)

**Authentication → Email Templates → Magic Link** — paste the contents of
`supabase/templates/magic-link.html`.

> This step is not optional. Nurora's sign-in screen asks for a **6-digit
> code**, but Supabase's stock template emails only a magic *link* and never
> renders `{{ .Token }}`. Without this template there is no code to type and
> email sign-in cannot complete. (The local stack picks the template up
> automatically from `supabase/config.toml`.)

Then **Authentication → Providers**:
- **Google** — enable it, paste the client ID and secret from a Google Cloud
  OAuth client whose redirect URI is
  `https://<project>.supabase.co/auth/v1/callback`
- **Email** — on by default; this powers the 6-digit email OTP
- **Phone** — enable and connect an SMS provider (Twilio/MSG91) for phone OTP

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

**The first account to sign in becomes the admin.** Everyone after that starts
as a client; promote them from **Settings → People**.

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
```

`test:e2e` needs Docker and the local stack (`npx supabase start`). It signs in
through the real email-OTP flow — reading the code out of Mailpit, the local
mail catcher — then checks in, starts a session, watches the timer tick, ends
it, and confirms the tracked minutes reached the invoice. It resets the
database first, since the walkthrough completes a session. Screenshots of every
step land in `screenshots/`.

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
