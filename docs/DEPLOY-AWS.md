# Deploying Cleanify to AWS

The app is one Next.js server in a Docker container. The database, logins,
photo storage and the every-minute scheduler stay on Supabase; AWS only runs
the web app.

---

## 1. Choose the region: Mumbai (`ap-south-1`)

The Supabase project is in **ap-south-1**. Every page makes several database
calls, so the app must run in the same region. In another region each page is
several times slower.

## 2. Pick a service

Any service that runs a container on port 3000 works. Simplest first:

| Service | When |
|---|---|
| **AWS App Runner** | Easiest: give it the image, it handles HTTPS, scaling and restarts. Recommended to start. |
| ECS on Fargate + Application Load Balancer | More control, same image. |
| Lightsail containers / EC2 | Cheapest fixed cost; you manage HTTPS (Caddy or an ALB). |

Whatever you choose, the site must be on **HTTPS with a real domain**
(for example `app.cleanify.in`). Phones only allow the camera, location,
installing the app and notifications on HTTPS.

## 3. Build the image

`NEXT_PUBLIC_*` values are compiled into the phone app, so they are passed
when the image is **built**:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=<push public key> \
  -t cleanify .
```

Push it to Amazon ECR and point the service at it.

## 4. Environment variables (set on the service, not in the image)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as the build arg |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as the build arg |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | same as the build arg |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API. **Secret.** |
| `VAPID_PRIVATE_KEY` | the push private key. **Secret.** |
| `VAPID_SUBJECT` | `mailto:` an address you read, e.g. `mailto:ops@cleanify.in` |
| `DISPATCH_SECRET` | a long random string. **Secret.** Generate with `openssl rand -hex 32` |

Store the three secrets in AWS Secrets Manager or SSM Parameter Store and
reference them from the service; do not type them into a plain env field that
others can read.

**Keep the push keys the same forever.** Every phone's alert subscription is
tied to the public key; changing it silently stops alerts on every device
until each person enables alerts again. Use the keys already in `.env.local`
(or generate new ones once, before anyone enables alerts on the live site).

## 5. Point the scheduler at the live app

The database calls the app every minute to send notifications. In Supabase →
SQL editor, once the site is live:

```sql
select vault.create_secret('https://app.cleanify.in/api/dispatch', 'cleanify_dispatch_url');
select vault.create_secret('<the same DISPATCH_SECRET>',            'cleanify_dispatch_secret');
```

(To change one later: `select vault.update_secret(id, 'new value') from vault.secrets where name = '...';`)

Check it works: `select * from net._http_response order by created desc limit 3;`
should show status 200 within two minutes.

## 6. Test notifications on real phones

1. **iPhone:** open the site in Safari → Share → **Add to Home Screen** → open
   Cleanify from the new icon → sign in. iPhones only deliver alerts to the
   installed app, never to a Safari tab.
   **Android:** Chrome is enough; installing is optional.
2. Sign in as a sales rep or admin → tap **Enable alerts** on the banner → Allow.
3. On another phone, check in as a supervisor.
4. Within a minute the approver's phone shows *"Ravi checked in"*. Leave it
   unapproved: reminders arrive at 10 and 30 minutes. Approve it: the
   supervisor gets *"Check-in approved"*, and the remaining reminders stop.

The same happens for before photos, after photos, and new staff sign-ups
(admins only).

## 7. Before real staff use it

- [ ] Change the test passwords (`admin`, `priya`, `ravi`) or delete those accounts.
- [ ] Delete the test jobs (internal note "automated test") and the
      "Test Worker Two" and other test sign-ups.
- [ ] Set every supervisor's real depot (Users → approve with the right depot,
      or `npm run seed:users` with `SEED_DEPOT_*`). Until then every check-in
      is flagged *far from depot*.
- [ ] Ask workers to upload a **masked Aadhaar** (downloadable from UIDAI;
      the first 8 digits are hidden). Aadhaar copies are regulated personal
      data; confirm your handling with someone qualified.
- [ ] Every approver enables alerts on their phone (section 6).
- [ ] Bookmark the admin Dashboard: a red *"Scheduler is not running"* banner
      there means no reminders or alerts are going out.

## 8. Updating

Build and push a new image; App Runner / ECS rolls it out. Database changes go
first, with `npm run db:push` from a machine with `SUPABASE_DB_URL` set. The
service worker is served uncached, so phones pick up app changes on their next
open.
