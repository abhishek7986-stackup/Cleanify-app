# Cleanify Operations

Internal field-operations PWA for a cleaning services company. One installable
app, three roles: **admin**, **sales rep**, **supervisor**.

A job is traced end to end — sales rep takes the lead call and books it with a
map pin, the supervisor checks in at the depot with equipment and PPE photos
before a deadline derived from travel time, and every tank gets a before and
after photo that could not have come from the phone's gallery.

> **v1 is an operations tool, not a CRM.** No sales pipeline, no invoicing.
> Lead tracking and worker-level logins are v2.

---

## What is built

**Phase 1 is complete** — tag `v1.0-phase1`. The full day of the field team
works end to end; see **[docs/PHASE-1.md](docs/PHASE-1.md)** for how every
screen works, the rules enforced, and what is left.

| Milestone | State |
|---|---|
| **M0 — Foundations** | Done. Auth, roles, RLS, proxy routing, PWA shell, install gate. |
| **M1 — Jobs** | Done. Booking wizard (paste a WhatsApp location, tank count, five services), schema-driven forms, map pin, day timetable, job detail, reschedule and cancel with reasons, audit trail. |
| **M2 — Check-in + photos** | Done. Morning check-in (selfie + scooter km), approvals, Reached, before/after photos per tank with approval, evening check-out with km driven. |
| **M3 — Travel + deadlines** | Engine is done and running. Needs a Maps provider; currently falls back to straight-line distance and marks it `deadline_state = 'failed'` rather than inventing an ETA. |
| **M4 — Notifications** | Outbox, sweeps and cron are live. Needs VAPID keys and WhatsApp templates. |
| **M5 — Admin self-service** | Services and Users are read-only views. The field builder is not built — but the model behind it is, so a new service can be added by inserting rows today. |

---|---|
| **M0 — Foundations** | Done. Auth, roles, RLS, proxy routing, PWA shell, install gate. |
| **M1 — Jobs** | Done. Booking wizard, schema-driven forms, map pin, day timetable, job detail, reschedule and cancel with reasons, audit trail. |
| **M2 — Check-in + photos** | Camera component, capture tokens, offline queue and storage policy are all built and tested. The screen that wires them together is not. |
| **M3 — Travel + deadlines** | Engine is done and running. Needs a Maps provider; currently falls back to straight-line distance and marks it `deadline_state = 'failed'` rather than inventing an ETA. |
| **M4 — Notifications** | Outbox, sweeps and cron are live. Needs VAPID keys and WhatsApp templates. |
| **M5 — Admin self-service** | Services and Users are read-only views. The field builder is not built — but the model behind it is, so a new service can be added by inserting rows today. |

---

## Stack

| | |
|---|---|
| App | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 |
| Data | Supabase — Postgres + PostGIS, Auth, Storage, Realtime, RLS |
| Scheduler | `pg_cron` + `pg_net` inside Postgres |
| Alerts | Web Push (VAPID) with WhatsApp escalation |
| Hosting | Vercel |

---

## Setting up

### 1. Create a Supabase project

Production must be on the **Pro** plan: the free tier pauses a project after
about a week of inactivity and has no daily backups. Neither is survivable for
a dispatch system.

Enable these extensions (Dashboard → Database → Extensions): `postgis`,
`pg_cron`, `pg_net`, `pgcrypto`.

### 2. Apply the migrations

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

They are ordered and must be applied in filename order. Without the Supabase
CLI, paste each file from `supabase/migrations/` into the SQL editor in order.

### 3. Register the access-token hook

Dashboard → Authentication → Hooks → **Custom Access Token** →
`public.custom_access_token_hook`.

This mirrors `profiles.role` into the JWT. Every RLS policy reads the role from
the token, so **the app will not authorise correctly until this is set**.

### 4. Configure the app

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run dev
```

### 5. Give the scheduler its credentials

The two sweeps (`sweep_late`, `drain_recompute_queue`) are pure SQL and already
run. Only the dispatch step reaches outside the database:

```sql
select vault.create_secret('https://YOUR_REF.supabase.co', 'cleanify_project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY',        'cleanify_service_key');
```

Until both exist, `trigger_dispatch()` is a deliberate no-op — the database
keeps working and nothing is sent.

### 6. Create the test accounts

```bash
npm run seed:users
```

This creates three staff accounts through the Admin API (raw SQL cannot be used
— Supabase needs the password hashed and an `auth.identities` row written, or
sign-in silently fails). Re-running it updates the accounts rather than erroring.

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `CleanifyAdmin#2026` |
| Sales rep | `priya` | `CleanifySales#2026` |
| Supervisor | `ravi` | `CleanifySuper#2026` |

Sign in with the **username only** — the login form appends
`@cleanify.internal`. Override any password with `SEED_ADMIN_PASSWORD`,
`SEED_SALES_PASSWORD` or `SEED_SUPERVISOR_PASSWORD`.

> **Development credentials.** Change every one of them before this reaches
> anyone outside your team.

**Set the depot before you test timings.** The supervisor's check-in deadline is
derived entirely from the travel time between the depot and their first job, so
a placeholder depot makes every deadline meaningless:

```bash
SEED_DEPOT_LAT=17.4401 SEED_DEPOT_LNG=78.3489 \
SEED_DEPOT_ADDRESS="Your real depot address" npm run seed:users
```

### 7. Add demo data (optional)

Run `supabase/seed-demo.sql` in the SQL editor. It creates two clients and three
jobs: a chained two-job day for the supervisor — which exercises travel chaining
from the previous *site* rather than the depot — and one solar job, which proves
the dynamic schema renders a completely different field set with no code change.

The file ends with a query showing the computed sequence, travel minutes and
check-in deadline for each job, so you can see the scheduler's output directly.

### Troubleshooting

**Sign-in works but everything is empty or forbidden** — the Custom Access Token
hook (step 3) is not registered. Role lives in the JWT and every RLS policy
reads it from there.

**No deadlines appear** — check `select value from app_settings where key =
'scheduler.last_tick'`. If it is stale or missing, `pg_cron` is not running.
The admin dashboard shows this too.

**Every ETA says `fallback_haversine`** — no Maps provider is configured, so the
system is using great-circle distance over an urban-India average speed. Jobs
are marked `deadline_state = 'failed'` and land on the admin attention list,
which is the intended honest behaviour rather than a fabricated ETA.

---

## How the scheduling works

Read this before changing anything in `supabase/migrations/2026091500080*`.

**One depot check-in per day, anchored to the first job.** A supervisor loads
the van once and then does two to four jobs. Re-photographing the machinery in
a client's driveway at job #3 proves nothing, so the equipment and PPE photos
hang off the *day* (`day_rosters`), while each *job* gets its own arrival
expectation chained from the previous job's site.

```
required_checkin_at = first_job.scheduled_start − travel − 30 min
reminder_at         = required_checkin_at − 15 min
```

Three properties hold this together:

- **The arithmetic lives in exactly one function**, `public.compute_deadline()`.
  Swapping the check-in policy is then a row in `checkin_policies`, not a
  rewrite. The TypeScript mirror in `src/lib/domain/checkin-policy.ts` is named
  `previewDeadline` because it is only ever allowed to drive a preview.
- **Recompute a whole day, never a single job.** Cancelling job 2 changes job
  3's travel origin and therefore its deadline. `recompute_day()` takes an
  advisory lock on `(supervisor, date)` so two concurrent reschedules cannot
  interleave.
- **Maps is never called on the save path.** A job is written immediately with
  `deadline_state = 'pending'`; a worker fills the travel time and the UI
  updates over Realtime. A Google timeout must never be able to break job
  creation.

### Lateness has two escape hatches

`is_late` is a flag with a waiver, never a state — a job can be simultaneously
checked-in and late, which is exactly what the on-time report needs.

1. **Admin waiver** (`waive_late`). Fully automatic ETAs *will* be wrong
   sometimes. The flag clears; the original detection stays in `job_events`.
2. **The blameless rule.** When job N overruns, job N+1 is physically
   unreachable. It is still recorded as late, but `late_blameless` is set, the
   alerts to the sales rep and admin are **suppressed**, and the supervisor
   sees "Previous job running over" rather than "You're late".

Deadlines are never moved silently to paper over either case — that would
destroy the audit trail. Every recomputation is logged to `job_events` with
old and new values, which is the only thing that settles "yesterday it said
06:40".

---

## Camera-only capture

There is **no `<input type="file">` anywhere in the capture flow**, and there
must never be one. `<input capture>` is not used either: iOS Safari has
historically ignored it and offered the photo library anyway.

The UI is not the control, though. A camera-only screen is theatre if the
upload endpoint accepts any blob. The actual guarantee is a chain:

1. `issue_capture_token()` mints a single-use, ~5-minute token **and chooses
   the object path**. The client never picks where bytes land.
2. The storage policy accepts an upload only if a live token names that exact
   path.
3. `record_photo()` consumes the token and stamps the **server** clock. The
   device's claimed time is stored beside it, so skew is visible rather than
   authoritative.

Everything else is detection, not prevention: `sha256` is indexed so the same
bytes submitted twice anywhere are flagged; shutter latency and camera facing
are recorded; GPS distance is compared against where the person should have
been.

**Flag, never hard-block.** GPS drifts 50–200 m between mid-rise buildings and
dies in basements, so the fence is widened by the reported accuracy
(`distance − accuracy > radius`), and a poor fix is recorded as `low_accuracy`
(*unusable*) rather than `far_from_expected` (*suspicious*). Those are very
different accusations. A false block on a rooftop at 6 a.m. costs a job and the
team's trust; the sales rep's review queue is the real control.

---

## Things that will bite you

- **iOS Web Push only works from an installed PWA** (16.4+), there is no
  `beforeinstallprompt`, and the failure is invisible server-side. Onboarding a
  supervisor is a physical step. `InstallGate` nags until the app is
  standalone, and the countdown deliberately never depends on push.
- **Background Sync does not exist on iOS.** The offline photo queue flushes on
  app foreground, driven by the page, not by the browser.
- **Set a hard Maps quota cap in Google Cloud Console on day one.** A recompute
  loop is the realistic way that bill runs away. Estimates are cached by
  `(origin cell, dest cell, weekday, hour)`.
- **Submit WhatsApp templates in week one.** Approval takes days and gates both
  OTP login and late escalation. That is why M0 ships password login — flip
  `NEXT_PUBLIC_AUTH_MODE=otp` when the templates clear. Routing OTP over
  WhatsApp also sidesteps India's DLT registration for SMS sender IDs.
- **A scheduler that dies quietly is the worst failure mode here** — nothing is
  sent and the app looks completely fine. Every sweep writes
  `app_settings['scheduler.last_tick']`; the admin dashboard shows it, and an
  external monitor should alert if it goes stale past five minutes.
- **Never add a table without RLS.** The anon-key REST endpoint is publicly
  reachable. `select * from public.assert_rls_everywhere()` must return zero
  rows; wire it into CI.
- **Field field keys are immutable once published.** Answers are stored keyed
  by `key`, so a rename orphans history. Archive, never delete; publish a new
  schema version instead.

---

## Layout

```
supabase/migrations/     ordered migrations — schema, RLS, RPCs, scheduler, seed
docs/PHASE-1.md          how the whole Phase 1 day works, rules, what is left
src/proxy.ts             session refresh + optimistic role routing (Next 16 renamed
                         Middleware to Proxy)
src/lib/supabase/        browser, server and service-role clients
src/lib/domain/          types, and the deadline mirror
src/lib/data/            server-side DAL; auth is checked here, per page, not in
                         a layout (layouts do not re-render on navigation)
src/lib/upload-queue.ts  IndexedDB offline photo queue
src/components/          LiveCameraCapture, InstallGate, shell
public/sw.js             push handling, notification replace-not-stack, queue flush
```

## Commands

```bash
npm run dev      # Turbopack dev server
npm run dev:https # same, over https so phones can use the camera (Wi-Fi testing)
npm run dev:mac  # http://localhost:3001 into the https server, for this Mac
npm run build    # production build + typecheck
npm run lint
```
