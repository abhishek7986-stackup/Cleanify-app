import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { formatIstDate } from "@/lib/domain/checkin-policy";
import { rupees, shortDate } from "@/lib/domain/payments";
import { DeclareHandover } from "@/components/CashHandover";

export const metadata = { title: "My payments" };
export const dynamic = "force-dynamic";

type EarningRow = {
  id: string;
  job_id: string;
  percent: number;
  base_amount: number;
  amount: number;
  job: { job_number: string; service_date: string; client: { name: string } | null } | null;
};

const NAV = [
  { href: "/s", label: "Today" },
  { href: "/s/roadmap", label: "Roadmap" },
  { href: "/s/payments", label: "Payments" },
];

/**
 * A supervisor's own money, the way a delivery-partner earnings screen shows
 * it: what Monday's payout will be, what today brings, recent earnings, and
 * where the customers' cash stands. Every figure comes from my_pay_summary().
 */
export default async function MyPaymentsPage() {
  const profile = await requireRole("supervisor");
  // This page is one person's own money. Admins read everyone's in the office view.
  if (profile.role !== "supervisor") redirect("/sales/payouts");

  const supabase = await createClient();
  const [sumRes, earningsRes, dueRes, handRes] = await Promise.all([
    supabase.rpc("my_pay_summary"),
    supabase
      .from("job_earnings")
      .select("id, job_id, percent, base_amount, amount, job:jobs(job_number, service_date, client:clients(name))")
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(20)
      .overrideTypes<EarningRow[], { merge: false }>(),
    supabase.rpc("jobs_awaiting_payment"),
    supabase
      .from("cash_handovers")
      .select("*")
      .is("voided_at", null)
      .order("declared_at", { ascending: false })
      .limit(5),
  ]);
  const myHandovers = handRes.data ?? [];
  const pendingHandover = myHandovers.find((h) => h.status === "PENDING") ?? null;
  const s = sumRes.data?.[0];
  const due = dueRes.data ?? [];

  if (!s) {
    return (
      <AppShell profile={profile} title="Payments" nav={NAV}>
        <section className="sheet -mx-4 -mt-4 border-t-0 px-4 py-6">
          <p className="text-lg font-semibold text-slate-900">Not on the pay list yet</p>
          <p className="mt-1 text-sm text-slate-600">Ask the office to add you under Team %, then your pay shows here.</p>
        </section>
      </AppShell>
    );
  }

  const net = Number(s.week_net);
  const bf = Number(s.brought_forward);
  const withYou = Math.max(0, -net);
  const payoutDay = formatIstDate(`${s.payout_day}T00:00:00+05:30`);

  return (
    <AppShell
      profile={profile}
      title="Payments"
      nav={NAV}
      status={
        <dl className="grid grid-cols-3 divide-x divide-white/15 rounded-lg bg-white/[0.08] py-2 text-white">
          <Fig label="Your rate" value={`${Number(s.percent_now)}%`} />
          <Fig label="Today" value={rupees(s.today_earned)} />
          <Fig label="Last 7 days" value={rupees(s.last7_earned)} />
        </dl>
      }
    >
      <div className="-mx-4 -mt-4">
        {/* -------------------------------------------- Monday's payout */}
        <section className="sheet border-t-0 px-4 pb-4 pt-5">
          <p className="text-sm font-medium text-slate-600">Payout on {payoutDay}</p>
          <p className={`mt-1 text-[2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums ${net < 0 ? "text-danger-700" : "text-slate-950"}`}>
            {net < 0 ? "−" : ""}
            {rupees(Math.abs(net))}
          </p>
          <p className="mt-1.5 text-sm text-slate-600">
            {net > 0
              ? "The company pays you this on Monday, so far this week."
              : net < 0
                ? "You hand this back to the office on Monday: customers' cash you are holding, less your salary."
                : "Nothing to hand over so far this week."}
          </p>
          <dl className="mt-4 divide-y divide-brand-950/[0.07] border-t border-brand-950/[0.07] text-[0.9375rem]">
            {bf !== 0 ? <Row k={bf > 0 ? "Still owed to you from before" : "Still to hand back from before"} v={signed(bf)} /> : null}
            <Row k={`Your salary this week · ${s.week_jobs} ${Number(s.week_jobs) === 1 ? "job" : "jobs"}`} v={signed(Number(s.week_earned))} />
            <Row k="Cash you collected this week" v={signed(-Number(s.week_cash_collected))} />
            {Number(s.week_handed_back) > 0 ? <Row k="Cash you handed back this week" v={signed(Number(s.week_handed_back))} /> : null}
            <Row k="Balance" v={signed(net)} strong />
          </dl>
        </section>

        {/* ----------------------------------------------------- today */}
        <p className="section-label px-4 pb-2 pt-5">Today</p>
        <dl className="sheet divide-y divide-brand-950/[0.07] px-4 text-[0.9375rem]">
          <Row
            k={`Earned · ${s.today_jobs_paid} ${Number(s.today_jobs_paid) === 1 ? "job" : "jobs"} paid`}
            v={rupees(s.today_earned)}
            strong
          />
          <Row
            k={`Expected · ${s.today_jobs_left} ${Number(s.today_jobs_left) === 1 ? "job" : "jobs"} still to do`}
            v={rupees(s.today_expected)}
            muted
          />
        </dl>

        {/* ------------------------------------------------- earnings */}
        <p className="section-label px-4 pb-2 pt-5">Earnings</p>
        <dl className="sheet divide-y divide-brand-950/[0.07] px-4 text-[0.9375rem]">
          <Row k="This week (Mon to Sun)" v={rupees(s.week_earned)} />
          <Row k="Last 7 days" v={rupees(s.last7_earned)} />
          <Row k="This month" v={rupees(s.month_earned)} />
          <Row k="Last month" v={rupees(s.last_month_earned)} />
        </dl>

        {/* ------------------------------------------------------ cash */}
        <p className="section-label px-4 pb-2 pt-5">Customers&apos; cash</p>
        <dl className="sheet divide-y divide-brand-950/[0.07] px-4 text-[0.9375rem]">
          <Row k="Collected from customers this month" v={rupees(s.cash_collected_month)} />
          <Row k="Handed back to the office (all time)" v={rupees(s.cash_returned_total)} />
          <Row k="Paid to you by the office (all time)" v={rupees(s.paid_to_me_total)} />
          <Row k="Still with you" v={rupees(withYou)} strong danger={withYou > 0} />
          <DeclareHandover holding={withYou} pending={pendingHandover} />
        </dl>
        {myHandovers.some((h) => h.status !== "PENDING") ? (
          <ul className="sheet divide-y divide-brand-950/[0.07] border-t-0">
            {myHandovers
              .filter((h) => h.status !== "PENDING")
              .map((h) => (
                <li key={h.id} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-slate-600">
                    <span className={`size-2 shrink-0 rounded-full ${h.status === "CONFIRMED" ? "bg-ok-600" : "bg-danger-600"}`} aria-hidden />
                    <span className="truncate">
                      {h.status === "CONFIRMED" ? "Office confirmed" : `Office rejected: ${h.reject_reason}`} ·{" "}
                      {formatIstDate(h.reviewed_at ?? h.declared_at)}
                    </span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${h.status === "CONFIRMED" ? "font-semibold text-slate-900" : "text-slate-500 line-through"}`}>
                    {rupees(h.amount)}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}

        {/* ------------------------------------------------------ rate */}
        <p className="section-label px-4 pb-2 pt-5">Your rate</p>
        <section className="sheet px-4 py-4">
          <p className="text-[0.9375rem] text-slate-900">
            You get <b className="font-semibold tabular-nums">{Number(s.percent_now)}%</b> of every job you are paid for.
          </p>
          {s.next_from_earned != null && s.next_percent != null ? (
            <>
              <p className="mt-1 text-sm text-slate-600">
                Rises to <b className="font-semibold tabular-nums text-slate-900">{Number(s.next_percent)}%</b> once you have earned{" "}
                <span className="tabular-nums">{rupees(s.next_from_earned)}</span>. You have earned{" "}
                <span className="tabular-nums">{rupees(s.lifetime_earned)}</span> so far.
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div
                  className="h-full rounded-full bg-brand-950"
                  style={{ width: `${Math.min(100, (Number(s.lifetime_earned) / Number(s.next_from_earned)) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-600">
              Earned so far: <span className="tabular-nums">{rupees(s.lifetime_earned)}</span>.
            </p>
          )}
        </section>

        {/* ------------------------------------------- not marked yet */}
        {due.length ? (
          <>
            <p className="section-label px-4 pb-2 pt-5 text-danger-700">Payment not marked yet</p>
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
          </>
        ) : null}

        {/* ---------------------------------------------- per job */}
        {earningsRes.data?.length ? (
          <>
            <p className="section-label px-4 pb-2 pt-5">Salary per job</p>
            <ul className="sheet divide-y divide-brand-950/[0.07]">
              {earningsRes.data.map((e) => (
                <li key={e.id}>
                  <Link href={`/s/jobs/${e.job_id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 active:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900">{e.job?.client?.name ?? e.job?.job_number}</span>
                      <span className="block text-sm tabular-nums text-slate-600">
                        {e.job?.service_date ? `${shortDate(e.job.service_date)} · ` : ""}
                        {Number(e.percent)}% of {rupees(e.base_amount)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{rupees(e.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <Link href="/s/history" className="flex min-h-14 items-center justify-between px-4 text-[0.9375rem] font-semibold text-brand-950">
          See all past jobs
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 5 7 7-7 7" />
          </svg>
        </Link>
      </div>
    </AppShell>
  );
}

function signed(n: number): string {
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}${rupees(Math.abs(n))}`;
}

function Row({ k, v, strong, muted, danger }: { k: string; v: string; strong?: boolean; muted?: boolean; danger?: boolean }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <dt className={`min-w-0 ${strong ? "font-semibold text-slate-900" : "text-slate-600"}`}>{k}</dt>
      <dd
        className={`shrink-0 tabular-nums ${
          danger ? "font-semibold text-danger-700" : strong ? "font-semibold text-slate-950" : muted ? "text-slate-600" : "font-medium text-slate-900"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3">
      <dt className="truncate text-[0.6875rem] font-medium text-white/65">{label}</dt>
      <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
