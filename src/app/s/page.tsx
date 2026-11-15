import Link from "next/link";
import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { AppShell } from "@/components/AppShell";
import { InstallGate } from "@/components/InstallGate";
import { TravelRefresh } from "@/components/TravelRefresh";
import { CheckinCountdown } from "@/components/CheckinCountdown";
import { AutoRefresh } from "@/components/AutoRefresh";
import { TripAction } from "@/components/TripAction";
import { parseEwkbPoint } from "@/lib/location-link";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";
import type { DayRoster, Job } from "@/lib/domain/database";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

type DayJob = Job & { client: { name: string; phone: string | null } | null };

/** Jobs that no longer need the supervisor: approved, cancelled or no-show. */
const FINISHED: Job["status"][] = ["COMPLETED", "CANCELLED", "NO_SHOW", "DRAFT"];

/**
 * The shift, the way a delivery-partner app shows it: status in the app bar,
 * the current stop and its one next step, a quiet list of what comes next,
 * and a fixed action bar that always names the next thing to do.
 */
export default async function SupervisorToday() {
  // In parallel: the user id comes from the JWT locally, so the day's data
  // need not wait for the profile row.
  const userId = (await getSessionUserId()) ?? "";
  const [profile, day] = await Promise.all([requireRole("supervisor"), getSupervisorDay(userId)]);
  const roster = day.roster;
  const jobs = day.jobs as DayJob[];

  const approved = roster?.approval_status === "APPROVED";
  const currentIndex = jobs.findIndex((j) => !FINISHED.includes(j.status));
  const current = currentIndex >= 0 ? jobs[currentIndex] : null;
  const doneCount = jobs.filter((j) => j.status === "COMPLETED").length;
  const later = jobs.filter((_, i) => i !== currentIndex);

  const phase: Phase = !roster
    ? "none"
    : !roster.submitted_at
      ? "checkin"
      : roster.approval_status === "REJECTED"
        ? "rejected"
        : roster.approval_status === "PENDING"
          ? "pending"
          : roster.checked_out_at
            ? "off"
            : current
              ? "working"
              : "finished";

  return (
    <AppShell
      profile={profile}
      title="Today"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/payments", label: "Payments" },
      ]}
      status={<ShiftStrip date={day.date} roster={roster} phase={phase} done={doneCount} total={jobs.length} />}
      action={
        // No bar when there is nothing to tap: no jobs, day finished, or on
        // the way (the stop's tiles hold the actions then).
        phase === "none" || phase === "off" || (phase === "working" && current?.status === "EN_ROUTE") ? undefined : (
          <ActionBar phase={phase} current={current} />
        )
      }
    >
      {jobs.length ? <TravelRefresh days={[{ supervisorId: userId, date: day.date }]} /> : null}
      {jobs.some((j) => j.before_review === "PENDING" || j.after_review === "PENDING") ? <AutoRefresh seconds={10} /> : null}
      {phase === "pending" ? <AutoRefresh seconds={8} /> : null}

      <div className="-mx-4 -mt-4">
        {/* ------------------------------------------------ the one thing now */}
        {phase === "none" ? (
          <Empty title="No jobs today" body={`Nothing is booked for you on ${formatIstDate(day.date)}.`} />
        ) : phase === "checkin" ? (
          <section className="sheet border-t-0 px-4 py-5">
            <p className="section-label">Depot check-in</p>
            <div className="mt-3">
              <CheckinCountdown deadline={roster!.required_checkin_at ?? null} submittedAt={null} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Selfie in uniform, a photo of the scooter&apos;s km, and the km reading. Your jobs open once the office approves.
            </p>
          </section>
        ) : phase === "pending" ? (
          <section className="sheet border-t-0 px-4 py-5">
            <p className="section-label">Depot check-in</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <span className="size-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
              Waiting for the office to approve
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Sent at {formatIstTime(roster!.submitted_at!)}. Your first job opens as soon as it is approved. This screen updates by itself.
            </p>
          </section>
        ) : phase === "rejected" ? (
          <section className="sheet border-t-0 px-4 py-5">
            <p className="section-label text-danger-700">Check-in not approved</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">Retake your depot photos</p>
            {roster!.rejection_reason ? <p className="mt-1 text-sm text-slate-600">Office: {roster!.rejection_reason}</p> : null}
          </section>
        ) : phase === "working" && current ? (
          <CurrentStop job={current} index={currentIndex + 1} total={jobs.length} unlocked={approved} />
        ) : phase === "finished" ? (
          <Empty title="All jobs done" body="Take a selfie and the scooter km photo to check out and end your day." />
        ) : (
          <Empty
            title="Day finished"
            body={`Checked out at ${formatIstTime(roster!.checked_out_at!)}${kmToday(roster!)}. See you tomorrow.`}
          />
        )}

        {/* ------------------------------------------------- the rest of the day */}
        {later.length ? (
          <section className="mt-5">
            <p className="section-label px-4 pb-2">{phase === "working" ? "Rest of today" : "Today's jobs"}</p>
            <ol className="sheet divide-y divide-brand-950/[0.07]">
              {later.map((job) => {
                const i = jobs.indexOf(job);
                return (
                  <li key={job.id}>
                    <JobRow job={job} index={i + 1} waitingFor={currentIndex >= 0 && i > currentIndex ? currentIndex + 1 : null} />
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {phase === "working" ? (
          <p className="flex items-center gap-2 px-4 pt-4 text-sm text-slate-500">
            <Glyph small d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" />
            Check-out opens after your last job is approved.
          </p>
        ) : null}

        <div className="px-4 pt-5">
          <InstallGate />
        </div>
      </div>
    </AppShell>
  );
}

type Phase = "none" | "checkin" | "pending" | "rejected" | "working" | "finished" | "off";

/** Shift state in the app bar: check-in, progress, and when to leave. */
function ShiftStrip({
  date,
  roster,
  phase,
  done,
  total,
}: {
  date: string;
  roster: DayRoster | null;
  phase: Phase;
  done: number;
  total: number;
}) {
  const checkin =
    phase === "checkin" ? "Not yet" : phase === "pending" ? "Waiting" : phase === "rejected" ? "Retake" : phase === "none" ? "—" : "Approved";
  const dot =
    phase === "checkin" || phase === "rejected" ? "bg-amber-400" : phase === "pending" ? "bg-amber-400 animate-pulse" : phase === "none" ? "bg-white/40" : "bg-emerald-400";
  return (
    <dl className="grid grid-cols-3 divide-x divide-white/15 rounded-lg bg-white/[0.08] py-2 text-white">
      <div className="px-3">
        <dt className="text-[0.6875rem] font-medium text-white/60">{formatIstDate(date)}</dt>
        <dd className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] font-semibold">
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          {checkin}
        </dd>
      </div>
      <div className="px-3">
        <dt className="text-[0.6875rem] font-medium text-white/60">Jobs done</dt>
        <dd className="mt-0.5 text-[0.9375rem] font-semibold tabular-nums">
          {done}/{total}
        </dd>
      </div>
      <div className="px-3">
        <dt className="text-[0.6875rem] font-medium text-white/60">{roster?.checked_out_at ? "Checked out" : "Leave depot"}</dt>
        <dd className="mt-0.5 text-[0.9375rem] font-semibold tabular-nums">
          {roster?.checked_out_at ? formatIstTime(roster.checked_out_at) : roster?.depart_by ? formatIstTime(roster.depart_by) : "—"}
        </dd>
      </div>
    </dl>
  );
}

/** The current stop: where, when, its one next step, and the two field tools. */
function CurrentStop({ job, index, total, unlocked }: { job: DayJob; index: number; total: number; unlocked: boolean }) {
  const pin = parseEwkbPoint(job.site_location);
  const step = nextStep(job, unlocked);
  return (
    <section className="sheet border-t-0 px-4 pb-4 pt-5">
      <p className="text-sm font-medium tabular-nums text-slate-600">
        Stop {index} of {total} · {formatIstTime(job.scheduled_start)}
      </p>
      <h2 className="mt-1 text-[1.375rem] font-semibold leading-snug tracking-[-0.01em] text-slate-950">
        {job.client?.name ?? "Client"}
      </h2>
      <p className="mt-0.5 text-[0.9375rem] text-slate-600">{job.site_address}</p>
      <p className="mt-1 text-sm text-slate-500">
        {job.travel_minutes != null ? `~${job.travel_minutes} min ride` : null}
        {job.is_late && !job.late_blameless ? <span className="font-semibold text-danger-700"> · Late</span> : null}
        {job.late_blameless ? <span className="font-semibold text-warn-700"> · Previous job ran over</span> : null}
      </p>

      {step ? (
        <p className="mt-4 flex items-center gap-2.5 text-lg font-semibold leading-snug text-slate-900">
          <span
            className={`size-2.5 shrink-0 rounded-full ${
              step.tone === "wait" ? "animate-pulse bg-amber-500" : step.tone === "bad" ? "bg-danger-600" : "bg-brand-950"
            }`}
            aria-hidden
          />
          {step.text}
        </p>
      ) : null}

      {job.status === "EN_ROUTE" && unlocked ? (
        /* On the way: three equal tiles; I've reached is the filled one. */
        <div className="mt-4 grid grid-cols-3 gap-2">
          {pin ? (
            <a href={mapsUrlFor(pin)} target="_blank" rel="noreferrer" className={tileOutline}>
              <Glyph d="m3 11 18-8-8 18-2-8-8-2Z" />
              Navigate
            </a>
          ) : (
            <span className={`${tileOutline} text-slate-500`}>No pin</span>
          )}
          <TripAction tile jobId={job.id} status={job.status} mapsUrl={null} className={tileFilled} />
          {job.client?.phone ? (
            <a href={`tel:${job.client.phone}`} className={tileOutline}>
              <Glyph d="M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
              Call
            </a>
          ) : (
            <span className={`${tileOutline} text-slate-500`}>No phone</span>
          )}
        </div>
      ) : job.client?.phone ? (
        <a href={`tel:${job.client.phone}`} className={`mt-4 ${tileOutline} h-12 flex-row`}>
          <Glyph d="M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
          Call
        </a>
      ) : null}
    </section>
  );
}

/** One later (or finished) job as a list row. */
function JobRow({ job, index, waitingFor }: { job: DayJob; index: number; waitingFor: number | null }) {
  const done = job.status === "COMPLETED";
  const off = job.status === "CANCELLED" || job.status === "NO_SHOW";
  return (
    <Link href={`/s/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          done ? "bg-ok-600 text-white" : off ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-700"
        }`}
      >
        {done ? <Glyph small d="m5 12.5 4.5 4.5L19 7.5" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${done || off ? "text-slate-500" : "text-slate-900"}`}>{job.client?.name ?? "Client"}</p>
        <p className="truncate text-sm text-slate-500">
          {done
            ? "Done"
            : off
              ? job.status === "NO_SHOW"
                ? "No-show"
                : "Cancelled"
              : waitingFor
                ? `Opens after stop ${waitingFor}`
                : job.site_address}
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{formatIstTime(job.scheduled_start)}</span>
      <Glyph small d="m9 5 7 7-7 7" />
    </Link>
  );
}

const tileBase = "flex h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-lg text-sm font-semibold";
const tileOutline = `${tileBase} border border-brand-950/15 text-brand-950 active:bg-brand-50`;
const tileFilled = `${tileBase} bg-brand-950 text-white active:bg-brand-900 disabled:opacity-60`;

function mapsUrlFor(pin: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}&travelmode=two-wheeler`;
}

/** The fixed bar above the tabs: one full-width button for the next step. */
function ActionBar({ phase, current }: { phase: Phase; current: DayJob | null }) {
  const primary = "flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-950 text-base font-semibold text-white active:bg-brand-900";
  const quiet = "flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-slate-100 text-[0.9375rem] font-semibold text-slate-500";
  switch (phase) {
    case "checkin":
      return (
        <Link href="/s/checkin" className={primary}>
          <Glyph d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8ZM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
          Start check-in
        </Link>
      );
    case "rejected":
      return (
        <Link href="/s/checkin" className={primary}>
          Retake depot photos
        </Link>
      );
    case "pending":
      return <span className={quiet}>Waiting for approval</span>;
    case "working": {
      if (!current) return null;
      // On the way: the stop's own tiles carry Navigate / I've reached / Call.
      if (current.status === "EN_ROUTE") return null;
      if (["ASSIGNED", "CHECKED_IN"].includes(current.status)) {
        const pin = parseEwkbPoint(current.site_location);
        return (
          <TripAction
            jobId={current.id}
            status={current.status}
            mapsUrl={pin ? `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}&travelmode=two-wheeler` : null}
            className={`${primary} disabled:opacity-60`}
          />
        );
      }
      const label = actionLabel(current);
      return (
        <Link href={`/s/jobs/${current.id}`} className={label.waiting ? quiet : `${primary} justify-between px-5`}>
          <span className="text-left leading-tight">
            <span className={`block text-xs font-medium ${label.waiting ? "text-slate-500" : "text-white/70"}`}>Open job</span>
            <span className="block">Next: {label.text}</span>
          </span>
          {label.waiting ? null : <Glyph d="M5 12h14M13 6l6 6-6 6" />}
        </Link>
      );
    }
    case "finished":
      return (
        <Link href="/s/checkout" className={primary}>
          Check out
        </Link>
      );
    default:
      return null;
  }
}

/** The bar names the step itself; the job screen has the same button in the same place. */
function actionLabel(job: Job): { text: string; waiting?: boolean } {
  switch (job.status) {
    case "ASSIGNED":
    case "CHECKED_IN":
      return { text: "Start trip" };
    case "EN_ROUTE":
      return { text: "I've reached the site" };
    case "ON_SITE":
      if (job.before_review === "PENDING") return { text: "Waiting for approval", waiting: true };
      if (job.before_review === "APPROVED") return { text: "Start cleaning" };
      return { text: "Take before photos" };
    case "IN_PROGRESS":
      if (job.after_review === "PENDING") return { text: "Waiting for approval", waiting: true };
      return { text: "Take after photos" };
    default:
      return { text: "Open job" };
  }
}

/** The one thing to do next on the current job. */
function nextStep(job: Job, unlocked: boolean): { text: string; tone: "go" | "wait" | "bad" } | null {
  switch (job.status) {
    case "ASSIGNED":
    case "CHECKED_IN":
      return unlocked ? { text: "Tap Start trip when you leave. It opens the map to the site.", tone: "go" } : null;
    case "EN_ROUTE":
      return { text: "On the way. Tap I've reached the site when you arrive", tone: "go" };
    case "ON_SITE":
      if (job.before_review === "PENDING") return { text: "Before photos sent, waiting for approval", tone: "wait" };
      if (job.before_review === "APPROVED") return { text: "Before photos approved: start cleaning", tone: "go" };
      if (job.before_review === "REJECTED") return { text: "Before photos rejected: retake them", tone: "bad" };
      return { text: "Take the before photos", tone: "go" };
    case "IN_PROGRESS":
      if (job.after_review === "PENDING") return { text: "After photos sent, waiting for approval", tone: "wait" };
      if (job.after_review === "REJECTED") return { text: "After photos rejected: retake them", tone: "bad" };
      return { text: "When it's clean, take the after photos", tone: "go" };
    default:
      return null;
  }
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <section className="sheet border-t-0 px-4 py-6">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </section>
  );
}

function kmToday(r: DayRoster): string {
  return r.start_odometer_km != null && r.end_odometer_km != null
    ? ` · ${Number(r.end_odometer_km) - Number(r.start_odometer_km)} km today`
    : "";
}

/** A line icon; `d` is the SVG path. */
function Glyph({ d, small }: { d: string; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${small ? "size-4" : "size-5"} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
