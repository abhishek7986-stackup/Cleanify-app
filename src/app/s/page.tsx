import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { AppShell } from "@/components/AppShell";
import { InstallGate } from "@/components/InstallGate";
import { TravelRefresh } from "@/components/TravelRefresh";
import { CheckinCountdown } from "@/components/CheckinCountdown";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";
import type { DayRoster, Job } from "@/lib/domain/database";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function SupervisorToday() {
  // In parallel: the user id comes from the JWT locally, so the day's data
  // need not wait for the profile row.
  const userId = (await getSessionUserId()) ?? "";
  const [profile, day] = await Promise.all([requireRole("supervisor"), getSupervisorDay(userId)]);
  const needsCheckin = day.roster && !day.roster.submitted_at;

  return (
    <AppShell
      profile={profile}
      title="Today"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
        { href: "/s/payments", label: "Payments" },
      ]}
    >
      <div className="space-y-4">
        <InstallGate />
        {day.jobs.length ? <TravelRefresh days={[{ supervisorId: userId, date: day.date }]} /> : null}
        {day.jobs.some((j) => j.before_review === "PENDING" || j.after_review === "PENDING") ? (
          <AutoRefresh seconds={10} />
        ) : null}

        {/* The hero: one card, one next action. */}
        {!day.roster ? (
          <section className="card p-5 text-center">
            <p className="text-lg font-bold text-slate-900">No check-in today</p>
            <p className="mt-1 text-sm text-slate-500">You have no jobs booked for {formatIstDate(day.date)}.</p>
          </section>
        ) : needsCheckin ? (
          <section className="rounded-3xl bg-brand-950 p-6 text-white">
            <div className="relative">
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Icon d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />
                  Depot check-in
                </span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
                  {formatIstDate(day.date)}
                </span>
              </div>

              <CheckinCountdown tone="hero" deadline={day.roster.required_checkin_at ?? null} submittedAt={null} />

              {day.roster.depart_by ? (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-white/85">
                  <Icon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" small />
                  Leave the depot by{" "}
                  <span className="font-semibold text-white">{formatIstTime(day.roster.depart_by)}</span>
                </p>
              ) : null}

              <a
                href="/s/checkin"
                className="tap-lg mt-5 flex items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-brand-800 active:scale-[0.98]"
              >
                <Icon d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8ZM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
                Start check-in
              </a>
            </div>
          </section>
        ) : day.roster.approval_status === "REJECTED" ? (
          <section className="rounded-3xl bg-danger-50 p-5 ring-1 ring-danger-100">
            <p className="flex items-center gap-2 font-bold text-danger-700">
              <Icon d="M12 8v5M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
              Check-in photos rejected
            </p>
            {day.roster.rejection_reason ? (
              <p className="mt-1.5 text-sm text-danger-700">&ldquo;{day.roster.rejection_reason}&rdquo;</p>
            ) : null}
            <a
              href="/s/checkin"
              className="tap-lg mt-4 flex items-center justify-center rounded-2xl bg-danger-600 font-bold text-white active:scale-[0.98]"
            >
              Retake photos
            </a>
          </section>
        ) : day.roster.approval_status === "PENDING" ? (
          <section className="card p-5">
            <AutoRefresh seconds={8} />
            <div className="flex items-center gap-3">
              <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <span className="absolute inset-0 animate-ping rounded-full bg-brand-200/60" aria-hidden />
                <Icon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-slate-900">Waiting for approval</p>
                <p className="text-sm text-slate-500">
                  {day.roster.submitted_at ? `Checked in at ${formatIstTime(day.roster.submitted_at)}. ` : ""}
                  Jobs unlock once approved.
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex items-center gap-3 rounded-3xl bg-ok-50 p-4 ring-1 ring-ok-100">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ok-600 text-white">
              <Icon d="m5 12.5 4.5 4.5L19 7.5" />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-ok-700">Checked in · approved</p>
              <p className="text-sm text-ok-700">
                {day.roster.submitted_at ? `At ${formatIstTime(day.roster.submitted_at)}. ` : ""}
                Open a job when you get there.
              </p>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2.5 flex items-baseline justify-between px-1">
            <span className="text-lg font-bold text-slate-900">Today&apos;s jobs</span>
            <span className="text-sm font-medium text-slate-500">
              {day.jobs.length} job{day.jobs.length === 1 ? "" : "s"}
            </span>
          </h2>

          {day.jobs.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
              Nothing scheduled. Enjoy it.
            </p>
          ) : (
            <ol className="space-y-3">
              {day.jobs.map((job, i) => (
                <li key={job.id}>
                  <JobCard job={job} index={i + 1} unlocked={day.roster?.approval_status === "APPROVED"} />
                </li>
              ))}
            </ol>
          )}
        </section>

        {day.roster?.submitted_at ? <CheckoutCard roster={day.roster} jobs={day.jobs} /> : null}
      </div>
    </AppShell>
  );
}

/**
 * End of the day. Always available once checked in; it becomes the main
 * button when every job is finished, and stays a quieter one before that.
 */
function CheckoutCard({ roster, jobs }: { roster: DayRoster; jobs: Job[] }) {
  if (roster.checked_out_at) {
    const km =
      roster.start_odometer_km != null && roster.end_odometer_km != null
        ? Number(roster.end_odometer_km) - Number(roster.start_odometer_km)
        : null;
    return (
      <p className="rounded-3xl bg-ok-50 p-4 text-sm font-semibold text-ok-700 ring-1 ring-ok-100">
        Checked out at {formatIstTime(roster.checked_out_at)}
        {km != null ? ` · ${km} km today` : ""}.
      </p>
    );
  }
  const open = jobs.filter((j) => !["COMPLETED", "CANCELLED", "NO_SHOW", "DRAFT"].includes(j.status)).length;
  return (
    <section className="space-y-2 card p-5">
      <p className="text-lg font-bold text-slate-900">End of the day</p>
      <p className="text-sm text-slate-600">
        {open === 0
          ? "All jobs done. Take a selfie and the scooter km reading to check out."
          : `${open} job${open === 1 ? "" : "s"} still open. Check out after your last job if you can.`}
      </p>
      <a
        href="/s/checkout"
        className={`tap-lg flex items-center justify-center rounded-2xl font-semibold ${
          open === 0 ? "bg-brand-900 text-white" : "border-2 border-slate-300 text-slate-700"
        }`}
      >
        Check out
      </a>
    </section>
  );
}

function JobCard({
  job,
  index,
  unlocked,
}: {
  job: Job & { client: { name: string; phone: string | null } | null };
  index: number;
  unlocked: boolean;
}) {
  const next = nextStep(job, unlocked);
  const conflict = job.itinerary_flags?.includes("itinerary_conflict");
  const upstream = job.itinerary_flags?.includes("upstream_overrun");

  const done = job.status === "COMPLETED";
  const time = formatIstTime(job.scheduled_start);
  const [clock, meridiem] = [time.replace(/\s?(am|pm)$/i, ""), /pm$/i.test(time) ? "pm" : "am"];

  return (
    <a
      href={`/s/jobs/${job.id}`}
      className={`block card overflow-hidden active:scale-[0.99] ${
        done ? "opacity-70" : ""
      }`}
    >
      <div className="flex gap-3 p-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-canvas py-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Job {index}</span>
          <span className="text-sm font-bold tabular-nums text-slate-900">{clock}</span>
          <span className="text-[10px] font-semibold uppercase text-slate-500">{meridiem}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-bold text-slate-900">{job.client?.name ?? "Client"}</p>
            {/* "Assigned" is every job's starting state; only show what has moved. */}
            {job.status !== "ASSIGNED" ? <StatusPill status={job.status} /> : null}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
            <Icon d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" small />
            <span className="truncate">{job.site_address}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {job.travel_minutes != null ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                ~{job.travel_minutes} min drive
              </span>
            ) : null}

            {/* Blameless: the PREVIOUS job overran, so this is not on them. */}
            {job.late_blameless || upstream ? (
              <span className="rounded-full bg-warn-100 px-2 py-0.5 font-semibold text-warn-700">
                Previous job running over
              </span>
            ) : job.is_late ? (
              <span className="rounded-full bg-danger-100 px-2 py-0.5 font-semibold text-danger-700">Late</span>
            ) : null}

            {conflict && !upstream ? (
              <span className="rounded-full bg-warn-100 px-2 py-0.5 font-semibold text-warn-700">Tight schedule</span>
            ) : null}
          </div>
        </div>
      </div>

      {next ? (
        <p
          className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-bold ${
            next.waiting ? "bg-brand-50 text-brand-800" : "bg-brand-900 text-white"
          }`}
        >
          <span>{next.text}</span>
          {next.waiting ? (
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand-600" aria-hidden />
          ) : (
            <Icon d="m9 5 7 7-7 7" small />
          )}
        </p>
      ) : !unlocked && !done ? (
        <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500">
          <Icon d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" small />
          Unlocks after your check-in is approved
        </p>
      ) : null}
    </a>
  );
}

/** A small line icon; `d` is the SVG path. */
function Icon({ d, small }: { d: string; small?: boolean }) {
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

function StatusPill({ status }: { status: Job["status"] }) {
  const map: Record<string, string> = {
    ASSIGNED: "bg-slate-100 text-slate-700",
    CHECKED_IN: "bg-brand-100 text-brand-800",
    EN_ROUTE: "bg-brand-100 text-brand-800",
    ON_SITE: "bg-brand-100 text-brand-800",
    IN_PROGRESS: "bg-warn-100 text-warn-700",
    COMPLETED: "bg-ok-100 text-ok-700",
    CANCELLED: "bg-slate-100 text-slate-500",
    NO_SHOW: "bg-danger-100 text-danger-700",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
        map[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {status.replace("_", " ").toLowerCase()}
    </span>
  );
}

/** The one thing to do next on this job, shown on its card. */
function nextStep(job: Job, unlocked: boolean): { text: string; waiting?: boolean } | null {
  switch (job.status) {
    case "ASSIGNED":
    case "CHECKED_IN":
    case "EN_ROUTE":
      return unlocked ? { text: "Open, then tap I've reached on arrival" } : null;
    case "ON_SITE":
      if (job.before_review === "PENDING") return { text: "Before photos waiting for approval", waiting: true };
      if (job.before_review === "APPROVED") return { text: "Approved: start cleaning" };
      if (job.before_review === "REJECTED") return { text: "Before photos rejected: retake" };
      return { text: "Take before photos" };
    case "IN_PROGRESS":
      if (job.after_review === "PENDING") return { text: "After photos waiting for approval", waiting: true };
      if (job.after_review === "REJECTED") return { text: "After photos rejected: retake" };
      return { text: "Take after photos when done" };
    default:
      return null;
  }
}
