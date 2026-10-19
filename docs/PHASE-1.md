# Cleanify Operations — Phase 1

Stable version: **`v1.0-phase1`** (git tag) · 20 October 2026

Phase 1 is the full working day of the field team, from booking a job to
checking out in the evening, with photo evidence and approvals at every step.
Nothing in this document is planned work; everything below is built and has
been tested against the live Supabase project.

---

## 1. Who uses it

| Role | Signs in as (test) | Home screen | Does |
|---|---|---|---|
| **Sales executive** | `priya` | Today (day timetable) | Books jobs, approves photos |
| **Supervisor** (cleaning staff) | `ravi` | Today (their own day) | Checks in, does the jobs, checks out |
| **Admin** | `admin` | Dashboard | Sees everything, can approve anything |

Sign-in is **username + password**; the app adds `@cleanify.internal` itself.
Test passwords are in the README (section 6). Change them before real staff use
the app.

---

## 2. The supervisor's day

```
Morning      Check in: selfie + scooter km photo + km number
               └─ waits for approval (sales or admin)
             Jobs unlock: location, Navigate, I've reached
On each job  I've reached  (records where they really are, never blocks)
             Before photo of every tank + confirm tank details
               └─ Send for approval → waits
             Start cleaning
             After photo of every tank (+ optional note)
               └─ Send for approval → job closes when approved
Evening      Check out: selfie + scooter km photo + km number
```

### 2.1 Morning check-in

Screen: **Today → Start check-in** (`/s/checkin`)

- **Selfie** (front camera, face inside the outline).
- **Scooter km reading** photo (back camera).
- **Km reading** typed in. Required.
- **Check in** sends it. A late check-in is accepted and marked **Late**,
  never refused.
- The screen then shows **"Waiting for approval"** and updates by itself.
  Jobs, the job location and the Reached button stay locked until a sales
  executive or admin approves.
- If the photos are rejected, the reason is shown and the supervisor retakes
  and resends. The morning km reading is kept.

### 2.2 On each job

Screen: tap the job on **Today** (`/s/jobs/<id>`). Each job card on Today
says what to do next.

1. **I've reached the site** — the main button as soon as the check-in is
   approved, whether or not *Start trip* was tapped. It records the phone's
   location and the distance from the booked pin, but never blocks: the
   client's shared pin is often wrong and is corrected over a phone call.
   *Start trip* is there too, optionally.
2. **Before photos** — one per tank (or bathroom / area), with the tank
   details from the booking shown below each one. The supervisor corrects
   anything that is different on site (capacity, tank type, stand or plain
   terrace…). **Send for approval** is enabled once every tank has a photo.
3. **Start cleaning** — unlocks when the before photos are approved.
4. **After photos** — one per tank. A note is **optional**.
   **Send for approval**; the job is **completed** when it is approved.

Any rejection shows the reason; retake and send again.

**Navigate there** opens Google Maps at the exact pin the sales executive
placed (often pasted from the client's WhatsApp location), not the typed
address.

### 2.3 Evening check-out

Screen: **Today → Check out** (`/s/checkout`)

- Available any time after checking in. It becomes the main button once all
  of the day's jobs are finished.
- **Selfie** + **scooter km reading** photo + **km reading** typed in.
- The km must not be lower than the morning's reading. The screen shows
  *"N km today"* as it is typed.
- Jobs still open are allowed: the screen warns, and the office can see it was
  left open. Nobody approves a check-out.

---

## 3. The sales executive

### 3.1 Booking a job — `New job`

Six steps; tap any step already reached to jump back to it (nothing typed is
lost).

| Step | What it asks |
|---|---|
| Client | Existing (search by phone or name) or new: name, address (required); phone, locality (optional). No pincode. |
| Location | **Paste a location from WhatsApp** (Google Maps link, `maps.app.goo.gl` short link, or coordinates) and the pin moves there; or drag the map. Site address required, landmark optional. |
| Service | Water Tank Cleaning, Solar Panel Cleaning, Bathroom Cleaning, Interlock Cleaning, Pressure Washing |
| Details | **How many tanks?** (1–5, 6+), then one card per tank: capacity, tank type, where it is; **on a stand or plain terrace** appears when the tank is overhead. Other services count bathrooms / areas the same way. |
| Schedule | Date (defaults to **tomorrow**), time, supervisor, quoted amount, notes |
| Review | Summary → **Create job** |

### 3.2 Approvals — `Approvals`

Shows **only what is waiting**, oldest first, and refreshes itself every
15 seconds. A card disappears once it is decided.

| Card | Shows | Decision |
|---|---|---|
| Depot check-in | Selfie, scooter km photo, the km typed (check it against the photo), flags such as *late* or *far from depot* | Approve unlocks the supervisor's jobs |
| Before photos | Each tank's before photo with the details confirmed on site, and how far from the pin "Reached" was tapped | Approve unlocks *Start cleaning* |
| After photos | Each tank's **before and after side by side**, and the note if any | **Approve and close job** |

Rejecting always needs a reason, which the supervisor sees.

Sales executives and admins can decide all three. The admin does not need to
approve anything.

---

## 4. The admin

- **Dashboard** — jobs today, completed, late, *awaiting review*, not checked
  in, flagged check-ins, and **Supervisors today**: check-in time (and late),
  check-out time, start → end km and **km driven**.
- **Approvals** — the same page as sales, linked from the admin menu.
- **Users / Services** — read-only in Phase 1.

---

## 5. Rules the system enforces

These are checked in the database, so they hold no matter which screen or
device is used.

| Rule | Message the user sees |
|---|---|
| Jobs locked until the depot check-in is approved | *Your depot check-in is waiting for approval* |
| Check-in needs the selfie, the km photo and the km number | *Both the selfie and the scooter km photo are required* / *Enter the km reading from the scooter* |
| Before photos for every tank before sending | *N item(s) still need a before photo* |
| Tank details must be valid (e.g. capacity 100 L or more) | *Invalid Tank 2 details: …* |
| Tank details locked once the before photos are approved | *Details can only be changed on site, before the photos are approved* |
| No cleaning before the before photos are approved | *The before photos need approval before you start* |
| A job is completed only by approving its after photos | *The after photos need admin approval* |
| Check-out needs both photos and a km reading not below the morning's | *The km reading is lower than this morning (N km)* |
| One check-in and one check-out per day | *You have already checked in / out today* |

Every action is written to the job history (`job_events`) with who did it
and when, using the **server's** clock.

---

## 6. Photos

- Taken **only with the live camera** inside the app; there is no way to pick
  a photo from the gallery.
- Each photo needs a single-use, 5-minute capture token issued by the server,
  and is fingerprinted so the same picture used twice is flagged.
- No signal? Photos are saved on the phone and uploaded automatically when
  signal returns; the screens wait for them before sending anything.
- Retakes keep the old photo in the database, marked as replaced, so the
  record is complete; screens show only the current one.
- Photos are stored privately. Sales and admin see them through links that
  last one hour.

---

## 7. Testing it (development)

| Where | Link | Notes |
|---|---|---|
| iPhone / phone on the same Wi-Fi | `https://<mac-ip>:3000` (currently `https://192.168.1.3:3000`) | Tap past the "not private" warning once. https is needed for the camera and location. |
| The Mac | `http://localhost:3001` | |

Start the servers with the `cleanify-dev-https` launch configuration, then
`cleanify-mac` (or `npm run dev:https` and `npm run dev:mac`). The phone link
changes if the Mac gets a new Wi-Fi address; the self-signed certificate
expires around **18 November 2026** and covers only the current address.

Test data in the database: jobs whose internal note is **"automated test"**
(30–31 December, and one each on 17 and 19 September) were created by the
automated tests and can be ignored or cancelled.

---

## 8. Database changes in Phase 1

Applied to Supabase with `npm run db:push`, in this order:

| Migration | What it does |
|---|---|
| `20261019000100` | Bathroom, Interlock and Pressure Washing services; *stand or plain terrace* for overhead tanks |
| `20261019000200` | Unique photo paths; resubmitting a rejected check-in |
| `20261019000300` | Retaking a photo marks the old one replaced |
| `20261019000400` | **Bug fix:** any check-in that earned a flag was refused |
| `20261019000500` | Interlock and Pressure Washing count "areas" so they get site photos |
| `20261019000600` | Approval gates: depot → reached → before → cleaning → after |
| `20261019000700` | **Bug fix:** the scheduler created no roster for a day with a warning (e.g. overlapping jobs) |
| `20261019000800` | The after-photo note is optional |
| `20261020000100` | Sales executives can approve after photos |
| `20261020000200` / `0300` | Scooter km photos, km readings, and check-out |

---

## 9. Not in Phase 1

Known gaps, in rough priority order:

1. **Hosting.** It runs on the Mac. Putting it on Vercel gives a permanent
   https link that works anywhere, with no certificate warning and faster
   pages (no development compiling).
2. **Real depot locations.** Supervisors' depots are still the default
   Hyderabad point, so every check-in is flagged *far from depot*. Set them
   with `npm run seed:users` and the `SEED_DEPOT_*` variables.
3. **Maps provider.** Travel times are straight-line estimates until a Maps
   API key is added; deadlines are marked as estimated.
4. **Notifications.** Push and WhatsApp alerts need VAPID keys and approved
   WhatsApp templates.
5. **Admin self-service.** Adding staff and editing service questions from
   the app (today: script / database).
6. **Reports.** Km per supervisor per month, jobs per day, approval times.
