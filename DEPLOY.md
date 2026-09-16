# Deploying Nurora to Vercel

The app talks to Supabase over PostgREST, so it needs a **hosted Supabase
project** — the local Docker stack on `127.0.0.1:54321` is not reachable
from Vercel. That is the only genuine prerequisite; everything else is
configuration.

Two steps need your accounts and cannot be done for you: creating the
Supabase project, and logging into Vercel.

---

## 1. Create the hosted Supabase project

1. New project at <https://supabase.com/dashboard> — pick a region close
   to your clients (Mumbai `ap-south-1` for an Indian clinic).
2. Save the database password it gives you.
3. From **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only —
     it bypasses row-level security, never expose it to the browser**)

## 2. Apply the migrations

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push            # applies 0001 … 0009 in order
```

`db push` runs the same nine migrations the local stack uses, so the
hosted schema matches exactly — including row-level security, the
realtime publication and the seeded service catalogue.

Do **not** run `supabase/seed.sql` against production: it creates six
demo accounts that all share the password `nurora1234`.

## 3. Point Supabase auth at the deployed domain

**Authentication → URL Configuration**:

- Site URL: `https://<your-app>.vercel.app`
- Redirect URLs: add `https://<your-app>.vercel.app/**`

Skip this and sign-in appears to work while confirmation and
password-reset links bounce to `localhost`.

## 4. Deploy

```bash
vercel login
vercel link          # or: vercel --prod to create and deploy in one go
vercel --prod
```

Vercel builds with `next build`. `vercel.json` already registers the
daily reminder cron at 03:00 UTC.

## 5. Put the functions in the same region as the database

`vercel.json` pins them to `bom1` (Mumbai), matching a Supabase project
in `ap-south-1`.

This is not a micro-optimisation. Serving from Washington (`iad1`) while
the database sits in Mumbai measured **419ms per query** against ~38ms
locally, and every page pays that on every query it makes. `/api/health`
reports the figure and names the likely cause:

```json
"latency": { "slowestQueryMs": 419, "vercelRegion": "iad1",
             "verdict": "SLOW — the functions are probably in a
                         different region from the database." }
```

**If you move the Supabase project, change this too.** The region codes:

| Supabase | Vercel |
| --- | --- |
| `ap-south-1` Mumbai | `bom1` |
| `ap-southeast-1` Singapore | `sin1` |
| `us-east-1` N. Virginia | `iad1` |
| `eu-west-2` London | `lhr1` |
| `eu-central-1` Frankfurt | `fra1` |

Static assets still come from Vercel's global CDN; only the server
functions are pinned, and they are the ones talking to the database.

## 6. Environment variables

Set these in **Vercel → Settings → Environment Variables** (Production,
and Preview if you want previews working). `.env.example` documents
every one with its purpose.

**Required — the app will not work without these**

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | from step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only |
| `CRON_SECRET` | `openssl rand -hex 32`. Vercel sends it as `Authorization: Bearer …`; the reminder route rejects anything else |

**Required before taking real bookings — these decide what clients pay**

`BILLING_ADVANCE_TIER_THRESHOLD`, `BILLING_ADVANCE_AT_OR_BELOW`,
`BILLING_ADVANCE_ABOVE`, `BILLING_GRACE_MINUTES`,
`BILLING_EXTENSION_BLOCK_PRICE`, `BILLING_GRACE_MODE`

Left unset the advance tiers are **zero**, so only Online and Walk-in
bookings ask for anything upfront. See `src/lib/business/billing.ts`.

**Messaging — skipped cleanly when unset**

| Variable | Notes |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+…` |
| `TWILIO_SMS_FROM` | SMS fallback |
| `TWILIO_WHATSAPP_TEMPLATE_BOOKED` | **needed in production** — see below |
| `TWILIO_WHATSAPP_TEMPLATE_RESCHEDULED`, `_CANCELLED` | |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | email |

**Optional**

`NEXT_PUBLIC_APP_URL` (falls back to the Vercel deployment URL),
`NEXT_PUBLIC_PRACTICE_NAME`, `NOTIFY_DEFAULT_COUNTRY_CODE` (default
`+91`), `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH`.

## 7. WhatsApp templates — the one thing that silently breaks

Meta blocks free-form business-initiated WhatsApp messages outside a
24-hour customer-service window. A booking confirmation is *always*
business-initiated, so **in production the free-form path will be
rejected** even though it works in the Twilio sandbox.

Register the approved confirmation template with exactly the copy in
`src/lib/notify/message-templates.ts` and these two variables, in order:

```
{{1}} client name    {{2}} date and time
```

then set `TWILIO_WHATSAPP_TEMPLATE_BOOKED` to its Content SID (`HX…`).

## 8. First sign-in

The **first account to sign up becomes the admin** automatically
(`handle_new_user()` in migration 0002). So: deploy, visit `/signup`,
create the practice owner's account, then add counsellors from
**Counsellors** and set prices under **Services & pricing**.

---

## If the deployed app feels slow

Check `https://<your-app>.vercel.app/api/health` — it reports how long a
trivial query actually takes from the deployment:

```json
"latency": { "slowestQueryMs": 12, "verdict": "good", "vercelRegion": "iad1" }
```

Under about 60ms the functions and database are close together. Much
above that and they are almost certainly in different regions, which no
amount of query tuning will fix: every single query pays the round trip.

Find the Supabase region under **Settings -> General**, then pin Vercel's
functions to match it in `vercel.json`:

```json
{ "regions": ["bom1"] }
```

`bom1` is Mumbai — the right choice for a project in `ap-south-1`. Vercel
defaults to `iad1` (Washington DC), so an Indian clinic on a Mumbai
database pays roughly 250ms on every query until this is set.

## Known limitations at deploy time

- **File uploads are not wired.** Attachment kinds (recording, voice
  note) and advance-payment proof record their intent and a 30-day
  expiry, but there is no storage bucket yet and nothing sweeps
  `attachment_expires_at`. Plain-text notes work fully.
- **The reminder cron needs a paid plan for sub-daily runs.** Hobby
  allows one run per day, which is what `vercel.json` schedules.
- **`maxDuration = 60`** on `/api/cron/reminders` sits at the Hobby
  ceiling. A very large practice may need Pro for headroom.
- Build installs devDependencies, including the `supabase` CLI and
  Playwright. Harmless but slow on a cold cache.
