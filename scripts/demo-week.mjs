#!/usr/bin/env node
/**
 * A week of demo work, driven through the app's real rules.
 *
 *   npm run demo:week             add 6–12 Nov 2026: 3–4 jobs a day, ₹5,000–7,000 a day
 *   npm run demo:week -- --remove take every demo record out again
 *
 * Nothing is written straight into the tables. The sales rep (priya) and the
 * supervisor (ravi) sign in with their own passwords and call the same
 * functions the screens call, so every permission, approval gate and payment
 * rule is exercised exactly as it would be on a phone:
 *
 *   sales rep   adds the client, books the job with a map pin and the tank details
 *   supervisor  checks in at the depot (selfie + km photo), reaches each site,
 *               sends before photos, starts, sends after photos with a note,
 *               marks the payment and who worked with them, checks out
 *   sales rep   approves the check-in, the before photos and the after photos
 *
 * The only direct writes come last: the work really happened today, so its
 * times are moved back to the day it was booked for, and the payments into
 * the week they belong to. Without that every job would land in this week.
 * The job history (job_events) is append-only and keeps the real run time.
 *
 * Demo records are marked: clients end in "(Demo)", jobs carry the internal
 * note "demo week", workers start with "Demo". --remove relies on those marks.
 *
 * Needs SEED_SALES_PASSWORD, SEED_SUPERVISOR_PASSWORD, SUPABASE_DB_URL and the
 * Supabase keys in .env.local. Run with node --env-file=.env.local.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const env = process.env;
const DOMAIN = env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? "cleanify.internal";
const DEMO_NOTE = "demo week";
const REMOVE = process.argv.includes("--remove");

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "SEED_SALES_PASSWORD", "SEED_SUPERVISOR_PASSWORD"]) {
  if (!env[k]) {
    console.error(`Set ${k} in .env.local.`);
    process.exit(1);
  }
}

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

if (REMOVE) {
  await removeDemo();
  await db.end();
  process.exit(0);
}

/* ------------------------------------------------------------------ people */

async function signIn(username, password) {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email: `${username}@${DOMAIN}`, password });
  if (error) throw new Error(`${username} could not sign in: ${error.message}`);
  return { sb, id: data.user.id };
}

const sales = await signIn("priya", env.SEED_SALES_PASSWORD);
const sup = await signIn("ravi", env.SEED_SUPERVISOR_PASSWORD);

async function rpc(who, fn, args) {
  const { data, error } = await who.sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const { rows: [depot] } = await db.query(
  `select st_y(base_location::geometry) lat, st_x(base_location::geometry) lng from public.profiles where id = $1`,
  [sup.id],
);

/* ------------------------------------------------------------------ photos */

// A real JPEG for every shot, each one different so none is flagged as reused.
// Colours stand in for the subject: brown before, blue after.
const scratch = mkdtempSync(join(tmpdir(), "cleanify-demo-"));
const COLOURS = {
  PPE_SELFIE: [222, 196, 160], ODOMETER: [90, 96, 110],
  CHECKOUT_SELFIE: [222, 196, 160], CHECKOUT_ODOMETER: [90, 96, 110],
  SITE_BEFORE: [120, 92, 60], SITE_AFTER: [70, 150, 210],
};
function makeJpeg(kind) {
  const w = 480, h = 360;
  const [r, g, b] = COLOURS[kind];
  const px = Buffer.alloc(w * h * 3);
  const noise = randomBytes(w * h);
  for (let i = 0; i < w * h; i++) {
    const n = (noise[i] % 40) - 20;
    px[i * 3] = Math.max(0, Math.min(255, r + n));
    px[i * 3 + 1] = Math.max(0, Math.min(255, g + n));
    px[i * 3 + 2] = Math.max(0, Math.min(255, b + n));
  }
  const ppm = join(scratch, "shot.ppm");
  const jpg = join(scratch, "shot.jpg");
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), px]));
  execFileSync("sips", ["-s", "format", "jpeg", ppm, "--out", jpg], { stdio: "ignore" });
  return { bytes: readFileSync(jpg), w, h };
}

async function shoot(kind, ids, at) {
  const token = await rpc(sup, "issue_capture_token", {
    p_kind: kind, p_roster_id: ids.roster ?? null, p_job_id: ids.job ?? null, p_job_line_item_id: ids.item ?? null,
  });
  const img = makeJpeg(kind);
  const up = await sup.sb.storage.from("checkin-photos").upload(token.storage_path, img.bytes, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`upload ${kind}: ${up.error.message}`);
  await rpc(sup, "record_photo", {
    p_token_id: token.id,
    p_sha256: createHash("sha256").update(img.bytes).digest("hex"),
    p_mime_type: "image/jpeg",
    p_bytes: img.bytes.length,
    p_width: img.w,
    p_height: img.h,
    p_camera_facing: kind.includes("SELFIE") ? "user" : "environment",
    p_capture_latency_ms: 2500,
    p_client_clock: new Date().toISOString(),
    p_lat: at.lat,
    p_lng: at.lng,
    p_accuracy_m: 12,
  });
}

/* ---------------------------------------------------------------- the week */

const { rows: services } = await db.query(
  `select s.id, s.name from public.services s where s.is_active`,
);
const svc = Object.fromEntries(services.map((s) => [s.name, s.id]));

// Two workers who go out with the supervisor. Added the way calling staff add
// them, on Payments → Team %.
async function ensureWorker(name, phone) {
  const { rows } = await db.query(`select id from public.pay_staff where full_name = $1`, [name]);
  if (rows[0]) return rows[0].id;
  const w = await rpc(sales, "upsert_pay_staff", {
    p_id: null, p_full_name: name, p_phone: phone, p_joined_on: "2026-08-01",
    p_start_percent: 14, p_fixed_percent: null, p_is_active: true, p_team_supervisor_id: sup.id,
  });
  return w.id;
}
const workers = [
  await ensureWorker("Demo Worker Suresh", "+919000000101"),
  await ensureWorker("Demo Worker Kiran", "+919000000102"),
];

// Hyderabad west, a few km from the depot.
const PLACES = [
  ["Lakshmi Nilayam (Demo)", "Plot 12, Madhapur", 17.4483, 78.3915],
  ["Sri Sai Apartments (Demo)", "Road 3, Kondapur", 17.4622, 78.3568],
  ["Green Park Villas (Demo)", "Gachibowli", 17.4401, 78.3489],
  ["Rao Residence (Demo)", "Jubilee Hills Road 36", 17.4326, 78.4071],
  ["Vasavi Heights (Demo)", "Miyapur", 17.4968, 78.3614],
  ["Krishna Solar Farm (Demo)", "Kokapet", 17.3934, 78.3378],
  ["Anand Bhavan (Demo)", "Manikonda", 17.4053, 78.3866],
  ["Sunrise Towers (Demo)", "Hitech City", 17.4504, 78.3808],
  ["Reddy Farmhouse (Demo)", "Narsingi", 17.3846, 78.3583],
  ["Skyline Enclave (Demo)", "Nanakramguda", 17.4192, 78.3436],
];

const tank = (type, litres, mount) => ({ tank_type: type, capacity_litres: litres, tank_mounting: mount, location_on_site: mount === "stand" ? "overhead" : "ground" });
const solar = (panels) => ({ panel_count: panels, mounting: "rooftop" });

// Each day: [time, place, service, items, quoted ₹, paid {upi, cash}, workers, payment note]
const WEEK = {
  "2026-11-06": [
    ["09:00", 0, "Water Tank Cleaning", [tank("synthetic", 1000, "stand"), tank("synthetic", 500, "stand")], 1800, { upi: 1800 }, [0]],
    ["11:30", 1, "Water Tank Cleaning", [tank("concrete", 5000, "terrace")], 2200, { cash: 2200 }, [0, 1]],
    ["15:00", 2, "Bathroom Cleaning", [{}, {}], 1600, { upi: 1000, cash: 600 }, [1]],
  ],
  "2026-11-07": [
    ["09:00", 3, "Water Tank Cleaning", [tank("synthetic", 2000, "stand")], 1500, { upi: 1500 }, [0]],
    ["11:00", 4, "Water Tank Cleaning", [tank("concrete", 10000, "terrace"), tank("synthetic", 1000, "stand")], 2600, { upi: 2600 }, [0, 1]],
    ["14:30", 5, "Solar Panel Cleaning", [solar(24)], 1800, { cash: 1800 }, [1]],
    ["16:30", 6, "Bathroom Cleaning", [{}], 900, { cash: 900 }, []],
  ],
  "2026-11-08": [
    ["09:30", 7, "Water Tank Cleaning", [tank("synthetic", 1000, "stand"), tank("synthetic", 1000, "stand"), tank("synthetic", 500, "stand")], 2400, { upi: 2400 }, [0]],
    ["12:30", 8, "Solar Panel Cleaning", [solar(40)], 2800, { upi: 2000, cash: 800 }, [0, 1]],
    ["16:00", 9, "Water Tank Cleaning", [tank("concrete", 3000, "terrace")], 1500, { cash: 1500 }, [1]],
  ],
  "2026-11-09": [
    ["09:00", 1, "Water Tank Cleaning", [tank("synthetic", 2000, "stand")], 1500, { upi: 1500 }, [0]],
    ["11:00", 3, "Bathroom Cleaning", [{}, {}, {}], 2100, { upi: 2100 }, [1]],
    ["14:00", 5, "Solar Panel Cleaning", [solar(30)], 2200, { cash: 2200 }, [0, 1]],
    ["16:30", 7, "Water Tank Cleaning", [tank("synthetic", 500, "stand")], 800, { cash: 800 }, []],
  ],
  "2026-11-10": [
    ["09:00", 0, "Water Tank Cleaning", [tank("concrete", 8000, "terrace")], 2500, { upi: 2500 }, [0, 1]],
    ["12:00", 2, "Water Tank Cleaning", [tank("synthetic", 1000, "stand"), tank("synthetic", 1000, "stand")], 1800, { cash: 1800 }, [0]],
    ["15:30", 4, "Bathroom Cleaning", [{}, {}], 1400, { upi: 1400 }, [1]],
  ],
  "2026-11-11": [
    ["09:30", 6, "Solar Panel Cleaning", [solar(20)], 1600, { upi: 1600 }, [0]],
    ["11:30", 8, "Water Tank Cleaning", [tank("concrete", 5000, "terrace"), tank("synthetic", 1000, "stand")], 2600, { upi: 1600, cash: 1000 }, [0, 1]],
    ["14:30", 9, "Water Tank Cleaning", [tank("synthetic", 2000, "stand")], 1500, { cash: 1500 }, [1]],
    ["16:30", 3, "Bathroom Cleaning", [{}], 900, { upi: 900 }, []],
  ],
  // Thursday: the supervisor types ₹1,000 for a ₹2,000 job, for the sales rep
  // to correct on the Payments screen.
  "2026-11-12": [
    ["09:00", 5, "Water Tank Cleaning", [tank("synthetic", 1000, "stand"), tank("synthetic", 1000, "stand")], 2000, { cash: 1000 }, [0], "Customer paid part"],
    ["11:30", 9, "Solar Panel Cleaning", [solar(36)], 2400, { upi: 2400 }, [0, 1]],
    ["15:00", 1, "Water Tank Cleaning", [tank("concrete", 4000, "terrace")], 1800, { upi: 1800 }, [1]],
  ],
};

const { rows: [{ n: already }] } = await db.query(
  `select count(*)::int n from public.jobs where internal_notes = $1`, [DEMO_NOTE],
);
if (already) {
  console.log(`\n  ${already} demo jobs are already there. Run with --remove first to start again.\n`);
  await db.end();
  process.exit(0);
}

const clientIds = {};
const keptRosters = new Set();
let lastKm = 12000;
const summary = [];

for (const [day, jobs] of Object.entries(WEEK)) {
  // 1. Sales rep books the day.
  const booked = [];
  for (const [time, place, service, items, quote, paid, crew, payNote] of jobs) {
    const [name, address, lat, lng] = PLACES[place];
    const payload = {
      service_id: svc[service],
      site: { lat, lng, address, landmark: null },
      scheduled_start: new Date(`${day}T${time}:00+05:30`).toISOString(),
      supervisor_id: sup.id,
      service_details: service === "Solar Panel Cleaning" ? { roof_access: "stairs", water_source_available: true } : { water_source_available: true },
      quoted_amount: quote,
      internal_notes: DEMO_NOTE,
      line_items: items.map((details, i) => ({ label: `${service === "Solar Panel Cleaning" ? "Array" : service === "Bathroom Cleaning" ? "Bathroom" : "Tank"} ${i + 1}`, details })),
    };
    if (clientIds[name]) payload.client_id = clientIds[name];
    else payload.client = { name, phone: `+9198${String(4000000 + place * 1111).padStart(8, "0")}`, address_line: address, city: "Hyderabad", location_source: "map_pin", lat, lng };
    const job = await rpc(sales, "create_job", { p_payload: payload });
    clientIds[name] = job.client_id;
    booked.push({ job, lat, lng, quote, paid, crew, payNote, time, name, service });
  }

  // 2. Supervisor checks in at the depot; sales rep approves.
  // The day's roster is built by the every-minute scheduler. Run that step now
  // rather than wait for it.
  await db.query("select public.recompute_day($1, $2::date)", [sup.id, day]);

  // A day that already has a check-in from earlier testing keeps it.
  const { data: roster, error: rErr } = await sup.sb.from("day_rosters").select("id, submitted_at, checked_out_at, approval_status, start_odometer_km")
    .eq("supervisor_id", sup.id).eq("roster_date", day).is("voided_at", null).single();
  if (rErr) throw new Error(`roster ${day}: ${rErr.message}`);
  // The scooter's km only goes up, carrying on from any real reading.
  const startKm = roster.start_odometer_km ? Number(roster.start_odometer_km) : lastKm + 15;
  lastKm = startKm + 38 + jobs.length * 6;
  if (!roster.submitted_at) {
    await shoot("PPE_SELFIE", { roster: roster.id }, depot);
    await shoot("ODOMETER", { roster: roster.id }, depot);
    await rpc(sup, "submit_checkin", {
      p_roster_date: day, p_lat: depot.lat, p_lng: depot.lng, p_accuracy_m: 12,
      p_client_clock: new Date().toISOString(), p_user_agent: "demo-week", p_odometer_km: startKm,
    });
  }
  if (roster.approval_status !== "APPROVED") {
    await rpc(sales, "review_roster", { p_roster_id: roster.id, p_approve: true });
  }
  if (roster.submitted_at) keptRosters.add(day);

  // 3. Each job, start to finish.
  for (const b of booked) {
    const id = b.job.id;
    const at = { lat: b.lat, lng: b.lng };
    await rpc(sup, "advance_job_status", { p_job_id: id, p_to: "CHECKED_IN", p_meta: {} });
    await rpc(sup, "advance_job_status", { p_job_id: id, p_to: "EN_ROUTE", p_meta: {} });
    await rpc(sup, "advance_job_status", { p_job_id: id, p_to: "ON_SITE", p_meta: { lat: b.lat, lng: b.lng, accuracy_m: 12 } });

    const { data: items } = await sup.sb.from("job_line_items").select("id").eq("job_id", id).order("position");
    for (const it of items) await shoot("SITE_BEFORE", { job: id, item: it.id }, at);
    await rpc(sup, "submit_site_photos", { p_job_id: id, p_stage: "before" });
    await rpc(sales, "review_site_photos", { p_job_id: id, p_stage: "before", p_approve: true });

    await rpc(sup, "advance_job_status", { p_job_id: id, p_to: "IN_PROGRESS", p_meta: {} });
    for (const it of items) await shoot("SITE_AFTER", { job: id, item: it.id }, at);
    await rpc(sup, "submit_site_photos", { p_job_id: id, p_stage: "after", p_note: "Drained, scrubbed, disinfected and rinsed. Customer checked it." });
    await rpc(sales, "review_site_photos", { p_job_id: id, p_stage: "after", p_approve: true });

    await rpc(sup, "record_job_payment", {
      p_job_id: id, p_upi_amount: b.paid.upi ?? 0, p_cash_amount: b.paid.cash ?? 0,
      p_worker_ids: b.crew.map((i) => workers[i]), p_note: b.payNote ?? null,
    });
    // Approving the after photos completes the job; only finish it by hand if not.
    const { data: now } = await sup.sb.from("jobs").select("status").eq("id", id).single();
    if (now.status !== "COMPLETED") await rpc(sup, "advance_job_status", { p_job_id: id, p_to: "COMPLETED", p_meta: {} });
    summary.push([day, b.time, b.job.job_number, b.name, b.service, b.quote, (b.paid.upi ?? 0) + (b.paid.cash ?? 0)]);
  }

  // 4. Evening check-out.
  if (roster.checked_out_at) {
    console.log(`  ok   ${day}  ${booked.length} jobs (kept the earlier check-in)`);
    continue;
  }
  await shoot("CHECKOUT_SELFIE", { roster: roster.id }, depot);
  await shoot("CHECKOUT_ODOMETER", { roster: roster.id }, depot);
  await rpc(sup, "submit_checkout", {
    p_roster_date: day, p_odometer_km: lastKm,
    p_lat: depot.lat, p_lng: depot.lng, p_accuracy_m: 12, p_client_clock: new Date().toISOString(),
  });
  console.log(`  ok   ${day}  ${booked.length} jobs`);
}

/* ------------------------------------------- move the times back to the day */

await db.query("begin");
// Each job's timeline, relative to when it was booked for.
await db.query(`
  update public.jobs j set
    actual_departure_at = j.scheduled_start - interval '20 minutes',
    arrived_at          = j.scheduled_start - interval '5 minutes',
    before_submitted_at = j.scheduled_start + interval '5 minutes',
    before_reviewed_at  = j.scheduled_start + interval '9 minutes',
    actual_start_at     = j.scheduled_start + interval '10 minutes',
    after_submitted_at  = j.scheduled_start + interval '85 minutes',
    after_reviewed_at   = j.scheduled_start + interval '92 minutes',
    actual_end_at       = j.scheduled_start + interval '95 minutes',
    completed_at        = j.scheduled_start + interval '100 minutes',
    is_late = false, late_marked_at = null
  where j.internal_notes = $1`, [DEMO_NOTE]);
// Payments into the day, and so into the week, the money came in.
await db.query(`
  update public.payments p set
    collected_at = j.scheduled_start + interval '97 minutes',
    week_start   = public.ist_week_start(j.scheduled_start + interval '97 minutes')
  from public.jobs j
  where j.id = p.job_id and j.internal_notes = $1`, [DEMO_NOTE]);
await db.query(`
  update public.job_earnings e set week_start = public.ist_week_start(j.scheduled_start)
  from public.jobs j
  where j.id = e.job_id and j.internal_notes = $1`, [DEMO_NOTE]);
// The day's check-in and check-out.
await db.query(`
  update public.day_rosters r set
    submitted_at   = (r.roster_date + time '08:15') at time zone 'Asia/Kolkata',
    approved_at    = (r.roster_date + time '08:22') at time zone 'Asia/Kolkata',
    checked_out_at = (r.roster_date + time '18:40') at time zone 'Asia/Kolkata'
  where r.supervisor_id = $1 and r.roster_date = any($2::date[])`,
  [sup.id, Object.keys(WEEK).filter((d) => !keptRosters.has(d))]);
await db.query("commit");

console.table(summary.map(([day, time, number, client, service, quote, paid]) => ({ day, time, number, client, service, quote, paid })));
const byDay = Object.entries(WEEK).map(([day, jobs]) => ({
  day, jobs: jobs.length,
  received: jobs.reduce((n, j) => n + (j[5].upi ?? 0) + (j[5].cash ?? 0), 0),
}));
console.table(byDay);
await db.end();

/* ------------------------------------------------------------------ remove */

async function removeDemo() {
  const svcRole = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { rows: jobs } = await db.query(`select id, service_date, assigned_supervisor_id from public.jobs where internal_notes = $1`, [DEMO_NOTE]);
  if (!jobs.length) {
    console.log("\n  No demo jobs found.\n");
    return;
  }
  const jobIds = jobs.map((j) => j.id);
  const days = [...new Set(jobs.map((j) => j.service_date.toISOString().slice(0, 10)))];
  const supId = jobs[0].assigned_supervisor_id;

  const { rows: rosters } = await db.query(
    `select r.id from public.day_rosters r
      where r.supervisor_id = $1 and r.roster_date = any($2::date[])
        and not exists (select 1 from public.jobs j
                         where j.assigned_supervisor_id = r.supervisor_id and j.service_date = r.roster_date
                           and j.internal_notes is distinct from $3)`, [supId, days, DEMO_NOTE]);
  const rosterIds = rosters.map((r) => r.id);
  const { rows: photos } = await db.query(
    `select storage_path from public.photos where job_id = any($1) or roster_id = any($2)`, [jobIds, rosterIds]);

  await db.query("begin");
  const { rows: staff } = await db.query(`select id from public.pay_staff where full_name like 'Demo Worker %'`);
  const staffIds = staff.map((s) => s.id);
  const { rows: weeks } = await db.query(
    `select distinct week_start from public.job_earnings where job_id = any($1)`, [jobIds]);
  await db.query(`delete from public.payouts where staff_id = any($1) or (week_start = any($2::date[]) and staff_id in (select id from public.pay_staff where profile_id = $3))`,
    [staffIds, weeks.map((w) => w.week_start), supId]);
  await db.query(`delete from public.job_earnings where job_id = any($1)`, [jobIds]);
  await db.query(`delete from public.jobs where id = any($1)`, [jobIds]);
  await db.query(`delete from public.photos where roster_id = any($1)`, [rosterIds]);
  await db.query(`delete from public.day_rosters where id = any($1)`, [rosterIds]);
  await db.query(`delete from public.clients where name like '% (Demo)' and not exists (select 1 from public.jobs j where j.client_id = clients.id)`);
  await db.query(`delete from public.pay_staff where id = any($1)`, [staffIds]);
  await db.query("commit");

  for (let i = 0; i < photos.length; i += 100) {
    await svcRole.storage.from("checkin-photos").remove(photos.slice(i, i + 100).map((p) => p.storage_path));
  }
  console.log(`\n  Removed ${jobIds.length} demo jobs, ${rosterIds.length} days of check-ins, ${photos.length} photos and ${staffIds.length} demo workers.\n`);
}
