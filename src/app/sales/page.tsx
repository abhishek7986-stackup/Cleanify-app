import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { getDayJobs } from "@/lib/data/jobs";
import { AppShell } from "@/components/AppShell";
import { DayPicker } from "@/components/DayPicker";
import { ShiftTimes } from "@/components/ShiftTimes";
import { InstallGate } from "@/components/InstallGate";
import { ApprovalsWaiting } from "@/components/ApprovalsWaiting";
import { getPendingApprovalCount } from "@/lib/data/approvals";
import { istDate, formatIstTime } from "@/lib/domain/checkin-policy";
import { TravelRefresh } from "@/components/TravelRefresh";
import { TeamNowLink } from "@/components/TeamNowLink";
import { createClient } from "@/lib/supabase/server";
import { rupees } from "@/lib/domain/payments";

export const metadata = { title: "Day timetable" };
export const dynamic = "force-dynamic";

const SALES_NAV = [
  { href: "/sales", label: "Today" },
  { href: "/sales/new", label: "New job" },
  { href: "/sales/approvals", label: "Approvals" },
  { href: "/sales/payments", label: "Payments" },
];

export default async function SalesToday(props: PageProps<"/sales">) {
  const sp = await props.searchParams;
  const date = typeof sp.date === "string" ? sp.date : istDate();
  const tab = sp.tab === "done" ? "done" : "assigned";

  const supabase = await createClient();
  const [profile, jobs, waiting, handRes, callRes] = await Promise.all([
    requireRole("sales_rep"),
    getDayJobs(date),
    getPendingApprovalCount(),
    supabase
      .from("cash_handovers")
      .select("amount")
      .eq("status", "PENDING")
      .is("voided_at", null),
    supabase
      .from("payments")
      .select("amount")
      .eq("proof_kind", "call")
      .is("proof_confirmed_at", null)
      .is("voided_at", null),
  ]);
  const callCount = callRes.data?.length ?? 0;
  const callTotal = (callRes.data ?? []).reduce((n, p) => n + Number(p.amount), 0);
  const handoverCount = handRes.data?.length ?? 0;
  const handoverTotal = (handRes.data ?? []).reduce((n, h) => n + Number(h.amount), 0);
  const done = jobs.filter((j) => j.status === "COMPLETED");
  const open = jobs.filter((j) => j.status !== "COMPLETED" && j.status !== "CANCELLED");
  const late = jobs.filter((j) => j.is_late && !j.late_blameless);
  const shown = tab === "done" ? done : open;

  return (
    <AppShell profile={profile} title="Day timetable" nav={SALES_NAV}>
      <div className="space-y-4">
        <InstallGate audience="approver" />
        <TravelRefresh
          days={[...new Set(open.map((j) => j.assigned_supervisor_id).filter(Boolean))].map((id) => ({
            supervisorId: id as string,
            date,
          }))}
        />
        <ApprovalsWaiting count={waiting} />
        {handoverCount ? (
          <Link href="/sales/payments" className="sheet -mx-4 flex min-h-14 items-center justify-between gap-3 px-4 active:bg-slate-50">
            <span className="flex items-center gap-2.5 font-semibold text-slate-900">
              <span className="size-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
              Confirm cash handed back: {handoverCount} · {rupees(handoverTotal)}
            </span>
            <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 5 7 7-7 7" />
            </svg>
          </Link>
        ) : null}
        {callCount ? (
          <Link href="/sales/payments" className="sheet -mx-4 flex min-h-14 items-center justify-between gap-3 px-4 active:bg-slate-50">
            <span className="flex items-center gap-2.5 font-semibold text-slate-900">
              <span className="size-2.5 animate-pulse rounded-full bg-danger-600" aria-hidden />
              Confirm UPI on call: {callCount} · {rupees(callTotal)}
            </span>
            <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 5 7 7-7 7" />
            </svg>
          </Link>
        ) : null}
        <TeamNowLink />
        <DayPicker date={date} basePath="/sales" />
        <ShiftTimes date={date} />

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Scheduled" value={open.length} />
          <Stat label="Done" value={done.length} />
          <Stat label="Late" value={late.length} tone={late.length ? "danger" : "plain"} />
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-900/[0.05] p-1">
          <TabLink href={`/sales?date=${date}&tab=assigned`} active={tab === "assigned"}>
            Assigned ({open.length})
          </TabLink>
          <TabLink href={`/sales?date=${date}&tab=done`} active={tab === "done"}>
            Done ({done.length})
          </TabLink>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            {tab === "done" ? "Nothing completed yet." : "Nothing scheduled."}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/sales/jobs/${j.id}`}
                  className="block card p-4"
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
      className={`flex min-h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold ${
        active ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.08),0_0_0_1px_rgb(15_23_42/0.06)]" : "text-slate-500"
      }`}
    >
      {children}
    </Link>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: number; tone?: "plain" | "danger" }) {
  return (
    <div className={`rounded-xl p-3 text-center ${tone === "danger" ? "bg-danger-50 ring-1 ring-danger-100" : "card"}`}>
      <p className={`text-2xl font-bold tabular-nums ${tone === "danger" ? "text-danger-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
