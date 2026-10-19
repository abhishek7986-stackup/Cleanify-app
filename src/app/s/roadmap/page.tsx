import Link from "next/link";
import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { AppShell } from "@/components/AppShell";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";

export const metadata = { title: "Roadmap" };
export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  // In parallel: the user id comes from the JWT locally, so the day's data
  // need not wait for the profile row.
  const userId = (await getSessionUserId()) ?? "";
  const [profile, day] = await Promise.all([requireRole("supervisor"), getSupervisorDay(userId)]);

  return (
    <AppShell
      profile={profile}
      title="Today's roadmap"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
      ]}
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{formatIstDate(day.date)}</p>

        {day.roster?.depart_by ? (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm text-brand-900">
              Leave the depot by{" "}
              <b>{formatIstTime(day.roster.depart_by)}</b>
            </p>
          </div>
        ) : null}

        {day.jobs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No stops today.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l-2 border-slate-200 pl-5">
            {day.jobs.map((job, i) => (
              <li key={job.id} className="relative">
                <span className="absolute -left-[27px] top-3 flex size-6 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <Link href={`/s/jobs/${job.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-500">
                    {formatIstTime(job.scheduled_start)}
                    {job.travel_minutes != null ? ` · ~${job.travel_minutes} min to get here` : ""}
                  </p>
                  <p className="font-semibold text-slate-900">{job.client?.name ?? "Client"}</p>
                  <p className="text-sm text-slate-600">{job.site_address}</p>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </AppShell>
  );
}
