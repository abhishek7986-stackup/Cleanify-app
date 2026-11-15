import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { officeNav } from "@/lib/nav";
import { PayLadderForm } from "./PayLadderForm";
import { TrainingDaysForm } from "./TrainingDaysForm";

export const metadata = { title: "Pay rates" };
export const dynamic = "force-dynamic";

/**
 * The admin's pay ladder: the percentage of each job a worker or supervisor
 * earns, rising once their own total earnings pass each milestone.
 * A person's fixed percentage on Team % still overrides this ladder.
 */
export default async function PayRatesPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const [{ data }, { data: training }] = await Promise.all([
    supabase.from("pay_tiers").select("kind, from_earned, percent").order("from_earned"),
    supabase.from("app_settings").select("value").eq("key", "pay.training_days").maybeSingle(),
  ]);
  const tiers = data ?? [];
  const of = (kind: "worker" | "supervisor") =>
    tiers.filter((t) => t.kind === kind).map((t) => ({ from_earned: Number(t.from_earned), percent: Number(t.percent) }));

  return (
    <AppShell profile={profile} title="Pay rates" back="/admin/users" nav={officeNav(profile)}>
      <div className="-mx-4 -mt-4">
        <section className="sheet border-t-0 px-4 py-4 text-sm text-slate-600">
          <p>
            Each person earns this percentage of every job they work on. It rises once their own total earnings pass a
            milestone. Every job keeps the percentage it was paid at, so changes here never alter past pay.
          </p>
          <p className="mt-2">
            A fixed percentage set for one person on <b className="font-semibold text-slate-900">Payments → Team %</b> overrides
            this ladder for them.
          </p>
        </section>
        <TrainingDaysForm initial={Number(training?.value ?? 2)} />
        <PayLadderForm kind="worker" title="Workers" initial={of("worker")} />
        <PayLadderForm kind="supervisor" title="Supervisors" initial={of("supervisor")} />
      </div>
    </AppShell>
  );
}
