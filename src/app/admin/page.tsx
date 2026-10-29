import { requireRole } from "@/lib/data/session";
import { AppShell } from "@/components/AppShell";
import { InstallGate } from "@/components/InstallGate";
import { ApprovalsWaiting } from "@/components/ApprovalsWaiting";
import { getPendingApprovalCount } from "@/lib/data/approvals";
import { createClient } from "@/lib/supabase/server";
import { formatIstTime, istDate } from "@/lib/domain/checkin-policy";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const profile = await requireRole("admin");
  const today = istDate();
  const supabase = await createClient();

  const [jobsRes, rostersRes, health] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, is_late, before_review, after_review")
      .eq("service_date", today),
    supabase
      .from("day_rosters")
      .select(
        "id, supervisor_id, submitted_at, checkin_status, approval_status, risk_score, start_odometer_km, end_odometer_km, checked_out_at",
      )
      .eq("roster_date", today),
    getSchedulerHealth(supabase),
  ]);
  const waiting = await getPendingApprovalCount();
  const { count: joinRequests } = await supabase
    .from("staff_applications")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING");
  const { data: staff } = await supabase.from("staff_directory").select("id, full_name");
  const nameOf = (id: string) => (staff ?? []).find((s) => s.id === id)?.full_name ?? "Supervisor";

  const jobs = jobsRes.data ?? [];
  const rosters = rostersRes.data ?? [];
  const { lastTick, tickAgeMin, stale: schedulerStale } = health;

  return (
    <AppShell
      profile={profile}
      title="Dashboard"
      nav={[
        { href: "/admin", label: "Today" },
        { href: "/sales/approvals", label: "Approvals" },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/services", label: "Services" },
      ]}
    >
      <div className="space-y-4">
        <InstallGate audience="approver" />
        <ApprovalsWaiting count={waiting} />
        {schedulerStale ? (
          <div className="rounded-2xl border border-danger-100 bg-danger-50 p-4">
            <p className="font-semibold text-danger-700">Scheduler is not running</p>
            <p className="mt-1 text-sm text-danger-600">
              {lastTick
                ? `Last tick was ${tickAgeMin} minutes ago.`
                : "It has never run."}{" "}
              No reminders or late alerts are being sent. Check pg_cron.
            </p>
          </div>
        ) : null}

        {joinRequests ? (
          <a
            href="/admin/users"
            className="flex items-center justify-between gap-3 rounded-2xl border-2 border-warn-100 bg-warn-50 p-4"
          >
            <span>
              <span className="block font-semibold text-warn-700">
                {joinRequests} new staff waiting for approval
              </span>
              <span className="block text-sm text-warn-700">Check their documents in Users</span>
            </span>
            <span aria-hidden className="text-xl text-warn-700">→</span>
          </a>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Tile label="Jobs today" value={jobs.length} />
          <Tile label="Completed" value={jobs.filter((j) => j.status === "COMPLETED").length} />
          <Tile
            label="Late"
            value={jobs.filter((j) => j.is_late).length}
            tone={jobs.some((j) => j.is_late) ? "danger" : "plain"}
          />
          <Tile
            label="Awaiting review"
            value={
              rosters.filter((r) => r.submitted_at && r.approval_status === "PENDING").length +
              jobs.filter((j) => j.before_review === "PENDING" || j.after_review === "PENDING").length
            }
          />
          <Tile
            label="Not checked in"
            value={rosters.filter((r) => !r.submitted_at).length}
          />
          <Tile
            label="Flagged check-ins"
            value={rosters.filter((r) => (r.risk_score ?? 0) > 0).length}
            tone={rosters.some((r) => (r.risk_score ?? 0) > 0) ? "warn" : "plain"}
          />
        </div>

        {/* Each supervisor's day: in, out, and the scooter km in between. */}
        {rosters.length ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-semibold text-slate-900">Supervisors today</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {rosters.map((r) => {
                const start = r.start_odometer_km != null ? Number(r.start_odometer_km) : null;
                const end = r.end_odometer_km != null ? Number(r.end_odometer_km) : null;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{nameOf(r.supervisor_id)}</p>
                      <p className="text-slate-500">
                        {r.submitted_at
                          ? `In ${formatIstTime(r.submitted_at)}${r.checkin_status === "LATE" ? " (late)" : ""}`
                          : "Not checked in"}
                        {r.checked_out_at ? ` · Out ${formatIstTime(r.checked_out_at)}` : r.submitted_at ? " · still out" : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-right tabular-nums">
                      {start != null && end != null ? (
                        <>
                          <b className="text-slate-900">{end - start} km</b>
                          <span className="block text-xs text-slate-400">
                            {start} → {end}
                          </span>
                        </>
                      ) : start != null ? (
                        <span className="text-slate-500">from {start} km</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

/**
 * A scheduler that dies quietly is the worst failure mode in this system:
 * nobody is notified of anything and the app looks completely fine. So it is
 * surfaced on the first screen an admin sees, every day.
 */
async function getSchedulerHealth(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ lastTick: string | null; tickAgeMin: number | null; stale: boolean }> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "scheduler.last_tick")
    .maybeSingle();

  const lastTick = (data?.value as string | undefined) ?? null;
  const tickAgeMin = lastTick
    ? Math.round((Date.now() - new Date(lastTick).getTime()) / 60_000)
    : null;

  return { lastTick, tickAgeMin, stale: tickAgeMin === null || tickAgeMin > 5 };
}

function Tile({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number;
  tone?: "plain" | "danger" | "warn";
}) {
  const tones = {
    plain: "border-slate-200 bg-white text-slate-900",
    danger: "border-danger-100 bg-danger-50 text-danger-700",
    warn: "border-warn-100 bg-warn-50 text-warn-700",
  } as const;
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm opacity-80">{label}</p>
    </div>
  );
}
