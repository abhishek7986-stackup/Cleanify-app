import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { AppShell } from "@/components/AppShell";
import { InstallGate } from "@/components/InstallGate";
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
      ]}
    >
      <div className="space-y-4">
        <InstallGate />
        {day.jobs.some((j) => j.before_review === "PENDING" || j.after_review === "PENDING") ? (
          <AutoRefresh seconds={10} />
        ) : null}

        {/* The hero: one card, one next action. */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold text-slate-900">Depot check-in</h2>
            <span className="text-sm text-slate-500">{formatIstDate(day.date)}</span>
          </div>

          <CheckinCountdown
            deadline={day.roster?.required_checkin_at ?? null}
            submittedAt={day.roster?.submitted_at ?? null}
          />

          {day.roster?.depart_by ? (
            <p className="mt-2 text-sm text-slate-600">
              Leave the depot by{" "}
              <span className="font-medium">{formatIstTime(day.roster.depart_by)}</span>
            </p>
          ) : null}

          {needsCheckin ? (
            <a
              href="/s/checkin"
              className="tap-lg mt-4 flex items-center justify-center rounded-2xl bg-brand-700 font-semibold text-white"
            >
              Start check-in
            </a>
          ) : null}

          {day.roster?.submitted_at && day.roster.approval_status === "PENDING" ? (
            <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
              <AutoRefresh seconds={8} />
              <p className="flex items-center gap-2 font-semibold text-brand-800">
                <span className="size-2.5 animate-pulse rounded-full bg-brand-600" aria-hidden />
                Photos sent, waiting for approval
              </p>
              <p className="mt-1">Your jobs unlock as soon as they are approved. This updates by itself.</p>
            </div>
          ) : null}

          {day.roster?.approval_status === "APPROVED" ? (
            <p className="mt-3 rounded-xl bg-ok-50 p-3 text-sm font-medium text-ok-700">
              Check-in approved. Open a job below and tap <b>I&apos;ve reached</b> when you get there.
            </p>
          ) : null}

          {day.roster?.approval_status === "REJECTED" ? (
            <div className="mt-3 rounded-xl bg-danger-50 p-3 text-sm text-danger-700">
              <p className="font-semibold">Your check-in photos were rejected</p>
              <p>{day.roster.rejection_reason}</p>
              <a href="/s/checkin" className="mt-2 inline-block font-semibold underline">
                Retake photos
              </a>
            </div>
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 px-1 font-semibold text-slate-900">
            {day.jobs.length} job{day.jobs.length === 1 ? "" : "s"} today
          </h2>

          {day.jobs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
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
      <p className="rounded-2xl border border-ok-100 bg-ok-50 p-4 text-sm font-medium text-ok-700">
        Checked out at {formatIstTime(roster.checked_out_at)}
        {km != null ? ` · ${km} km today` : ""}.
      </p>
    );
  }
  const open = jobs.filter((j) => !["COMPLETED", "CANCELLED", "NO_SHOW", "DRAFT"].includes(j.status)).length;
  return (
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold text-slate-900">End of the day</p>
      <p className="text-sm text-slate-600">
        {open === 0
          ? "All jobs done. Take a selfie and the scooter km reading to check out."
          : `${open} job${open === 1 ? "" : "s"} still open. Check out after your last job if you can.`}
      </p>
      <a
        href="/s/checkout"
        className={`tap-lg flex items-center justify-center rounded-2xl font-semibold ${
          open === 0 ? "bg-brand-700 text-white" : "border-2 border-slate-300 text-slate-700"
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

  return (
    <a
      href={`/s/jobs/${job.id}`}
      className="block rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">
            {index}. {formatIstTime(job.scheduled_start)}
          </p>
          <p className="truncate font-semibold text-slate-900">
            {job.client?.name ?? "Client"}
          </p>
          <p className="truncate text-sm text-slate-600">{job.site_address}</p>
        </div>
        <StatusPill status={job.status} />
      </div>

      {next ? (
        <p
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${
            next.waiting ? "bg-brand-50 text-brand-800" : "bg-brand-700 text-white"
          }`}
        >
          {next.text}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {job.travel_minutes != null ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
            ~{job.travel_minutes} min travel
          </span>
        ) : null}

        {/* Blameless: the PREVIOUS job overran, so this is not on them. */}
        {job.late_blameless || upstream ? (
          <span className="rounded-full bg-warn-100 px-2 py-1 font-medium text-warn-700">
            Previous job running over
          </span>
        ) : job.is_late ? (
          <span className="rounded-full bg-danger-100 px-2 py-1 font-medium text-danger-700">
            Late
          </span>
        ) : null}

        {conflict && !upstream ? (
          <span className="rounded-full bg-warn-100 px-2 py-1 font-medium text-warn-700">
            Tight schedule
          </span>
        ) : null}
      </div>
    </a>
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
      return unlocked ? { text: "Tap here, then I've reached when you arrive →" } : null;
    case "ON_SITE":
      if (job.before_review === "PENDING") return { text: "Before photos waiting for approval", waiting: true };
      if (job.before_review === "APPROVED") return { text: "Approved: start cleaning →" };
      if (job.before_review === "REJECTED") return { text: "Before photos rejected: retake →" };
      return { text: "Take before photos →" };
    case "IN_PROGRESS":
      if (job.after_review === "PENDING") return { text: "After photos waiting for approval", waiting: true };
      if (job.after_review === "REJECTED") return { text: "After photos rejected: retake →" };
      return { text: "Take after photos when done →" };
    default:
      return null;
  }
}
