import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { getDayJobs } from "@/lib/data/jobs";
import { AppShell } from "@/components/AppShell";
import { DayPicker } from "@/components/DayPicker";
import { InstallGate } from "@/components/InstallGate";
import { ApprovalsWaiting } from "@/components/ApprovalsWaiting";
import { getPendingApprovalCount } from "@/lib/data/approvals";
import { istDate, formatIstTime } from "@/lib/domain/checkin-policy";

export const metadata = { title: "Day timetable" };
export const dynamic = "force-dynamic";

const SALES_NAV = [
  { href: "/sales", label: "Today" },
  { href: "/sales/new", label: "New job" },
  { href: "/sales/approvals", label: "Approvals" },
];

export default async function SalesToday(props: PageProps<"/sales">) {
  const sp = await props.searchParams;
  const date = typeof sp.date === "string" ? sp.date : istDate();
  const tab = sp.tab === "done" ? "done" : "assigned";

  const [profile, jobs, waiting] = await Promise.all([
    requireRole("sales_rep"),
    getDayJobs(date),
    getPendingApprovalCount(),
  ]);
  const done = jobs.filter((j) => j.status === "COMPLETED");
  const open = jobs.filter((j) => j.status !== "COMPLETED" && j.status !== "CANCELLED");
  const late = jobs.filter((j) => j.is_late && !j.late_blameless);
  const shown = tab === "done" ? done : open;

  return (
    <AppShell profile={profile} title="Day timetable" nav={SALES_NAV}>
      <div className="space-y-4">
        <InstallGate audience="approver" />
        <ApprovalsWaiting count={waiting} />
        <DayPicker date={date} basePath="/sales" />

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Scheduled" value={open.length} />
          <Stat label="Done" value={done.length} />
          <Stat label="Late" value={late.length} tone={late.length ? "danger" : "plain"} />
        </div>

        <div className="flex gap-2">
          <TabLink href={`/sales?date=${date}&tab=assigned`} active={tab === "assigned"}>
            Assigned ({open.length})
          </TabLink>
          <TabLink href={`/sales?date=${date}&tab=done`} active={tab === "done"}>
            Done ({done.length})
          </TabLink>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            {tab === "done" ? "Nothing completed yet." : "Nothing scheduled."}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/sales/jobs/${j.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-500">
                        {formatIstTime(j.scheduled_start)} · {j.service?.name}
                      </p>
                      <p className="truncate font-semibold text-slate-900">
                        {j.client?.name ?? j.job_number}
                      </p>
                      <p className="truncate text-sm text-slate-600">{j.site_address}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {j.status.replace("_", " ").toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                      {j.supervisor?.full_name ?? "Unassigned"}
                    </span>
                    {j.late_blameless ? (
                      <span className="rounded-full bg-warn-100 px-2 py-1 font-medium text-warn-700">
                        previous job overran
                      </span>
                    ) : j.is_late ? (
                      <span className="rounded-full bg-danger-100 px-2 py-1 font-medium text-danger-700">
                        late
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`tap flex flex-1 items-center justify-center rounded-xl border-2 text-sm font-semibold ${
        active ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {children}
    </Link>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: number; tone?: "plain" | "danger" }) {
  return (
    <div className={`rounded-2xl border p-3 text-center ${tone === "danger" ? "border-danger-100 bg-danger-50" : "border-slate-200 bg-white"}`}>
      <p className={`text-2xl font-bold tabular-nums ${tone === "danger" ? "text-danger-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
