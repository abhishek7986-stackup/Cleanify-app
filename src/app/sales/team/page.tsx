import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { OfficeTabs } from "@/components/OfficeTabs";
import { officeNav } from "@/lib/nav";
import { istDate } from "@/lib/domain/checkin-policy";
import { previewPercent, shortDate } from "@/lib/domain/payments";
import { StaffForm } from "./StaffForm";

export const metadata = { title: "Team percentages" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const profile = await requireRole("sales_rep");
  const supabase = await createClient();
  const { data } = await supabase
    .from("pay_staff")
    .select("*")
    .order("is_active", { ascending: false })
    .order("kind")
    .order("full_name");
  const staff = data ?? [];
  const today = istDate();

  return (
    <AppShell profile={profile} title="Team percentages" nav={officeNav(profile)}>
      <div className="space-y-4">
        <OfficeTabs active="team" />

        <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
          Everyone starts at their start percentage and goes up 1% each month from their joining date until 17%. A job keeps
          the percentage of the day it was done, so changing it here never changes old jobs. New supervisors appear here once
          an admin approves them.
        </p>

        <StaffForm today={today} />

        <ul className="space-y-2">
          {staff.map((s) => {
            const { percent, nextRise } = previewPercent(s, today);
            return (
              <li key={s.id} className={`rounded-2xl border border-slate-200 bg-white p-4 ${s.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{s.full_name}</p>
                    <p className="text-xs text-slate-500 first-letter:uppercase">
                      {s.kind}
                      {s.is_active ? "" : " · not active"} · joined {shortDate(s.joined_on)}
                    </p>
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="text-2xl font-bold tabular-nums text-slate-900">{percent}%</span>
                    <span className="block text-xs text-slate-500">
                      {s.fixed_percent != null
                        ? "Fixed"
                        : nextRise
                          ? `${percent + 1}% from ${shortDate(nextRise)}`
                          : "At the top"}
                    </span>
                  </p>
                </div>
                <StaffForm today={today} staff={s} />
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}
