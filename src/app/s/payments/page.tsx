import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MoneyView } from "@/components/MoneyView";
import { rupees } from "@/lib/domain/payments";

export const metadata = { title: "My payments" };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/s", label: "Today" },
  { href: "/s/roadmap", label: "Roadmap" },
  { href: "/s/payments", label: "Payments" },
];

/** The supervisor's own money: the same screen the office sees for them. */
export default async function MyPaymentsPage() {
  const profile = await requireRole("supervisor");
  // This page is one person's own money. Admins read everyone's in the office view.
  if (profile.role !== "supervisor") redirect("/sales/payments");

  const supabase = await createClient();
  const [staffRes, dueRes, teamRes] = await Promise.all([
    supabase.from("pay_staff").select("id").eq("profile_id", profile.id).maybeSingle(),
    supabase.rpc("jobs_awaiting_payment"),
    supabase.rpc("my_team_pay"),
  ]);
  const due = dueRes.data ?? [];
  const team = teamRes.data ?? [];

  return (
    <AppShell profile={profile} title="Payments" nav={NAV}>
      {staffRes.data ? (
        <MoneyView staffId={staffRes.data.id} self />
      ) : (
        <section className="sheet -mx-4 -mt-4 border-t-0 px-4 py-6">
          <p className="text-lg font-semibold text-slate-900">Not on the pay list yet</p>
          <p className="mt-1 text-sm text-slate-600">Ask the office to add you under Team %, then your pay shows here.</p>
        </section>
      )}

      {team.length ? (
        <div className="-mx-4">
          <p className="section-label px-4 pb-2 pt-6">Your team&apos;s pay</p>
          <ul className="sheet divide-y divide-brand-950/[0.07]">
            {team.map((w) => {
              const paid = w.last_week_paid != null;
              const due = Number(w.last_week_due);
              return (
                <li key={w.staff_id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-slate-900">
                      {w.full_name}
                      <span className="font-normal text-slate-500"> · {w.in_training ? "in training" : `${Number(w.percent)}%`}</span>
                    </p>
                    <p className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-slate-950">{rupees(w.week_earned)}</span>
                    </p>
                  </div>
                  <p className="text-sm tabular-nums text-slate-600">
                    This week · {w.week_jobs} {Number(w.week_jobs) === 1 ? "job" : "jobs"} · today {rupees(w.today_earned)} · this month{" "}
                    {rupees(w.month_earned)}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm">
                    <span className={`size-2 shrink-0 rounded-full ${paid ? "bg-ok-600" : due > 0 ? "bg-amber-500" : "bg-slate-300"}`} aria-hidden />
                    <span className="text-slate-700">
                      {paid
                        ? `Last week: paid ${rupees(Math.abs(Number(w.last_week_paid)))}`
                        : due > 0
                          ? `Last week: ${rupees(due)} to be paid by the office`
                          : "Last week: nothing due"}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="px-4 pt-2 text-xs text-slate-500">
            Workers have no login, so their pay shows here. The office pays them on Monday.
          </p>
        </div>
      ) : null}

      {due.length ? (
        <div className="-mx-4">
          <p className="section-label px-4 pb-2 pt-4 text-danger-700">Payment not marked yet</p>
          <ul className="sheet divide-y divide-brand-950/[0.07]">
            {due.map((j) => (
              <li key={j.job_id}>
                <Link href={`/s/jobs/${j.job_id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 active:bg-slate-50">
                  <span className="min-w-0 truncate font-semibold text-slate-900">{j.client_name ?? j.job_number}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-danger-700">
                    {j.quoted_amount != null ? rupees(j.quoted_amount) : "Open"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AppShell>
  );
}
