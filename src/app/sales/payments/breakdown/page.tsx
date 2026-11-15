import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { officeNav } from "@/lib/nav";
import { addDays, mondayOf, rupees, shortDate } from "@/lib/domain/payments";
import { istDate } from "@/lib/domain/checkin-policy";

export const metadata = { title: "Money breakdown" };
export const dynamic = "force-dynamic";

type Range = "week" | "lastweek" | "month" | "lastmonth";
const RANGES: [Range, string][] = [
  ["week", "This week"],
  ["lastweek", "Last week"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
];

function bounds(range: Range): { from: string; to: string } {
  const today = istDate();
  const monday = mondayOf(today);
  const firstOfMonth = `${today.slice(0, 8)}01`;
  if (range === "week") return { from: monday, to: today };
  if (range === "lastweek") return { from: addDays(monday, -7), to: addDays(monday, -1) };
  if (range === "month") return { from: firstOfMonth, to: today };
  const lastMonthEnd = addDays(firstOfMonth, -1);
  return { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd };
}

/**
 * For the office: profit (revenue - salaries - expenses) and every person's
 * money, supervisors and workers, over a chosen period.
 */
export default async function BreakdownPage(props: PageProps<"/sales/payments/breakdown">) {
  const sp = await props.searchParams;
  const range: Range = RANGES.some(([k]) => k === sp.range) ? (sp.range as Range) : "week";
  const { from, to } = bounds(range);
  const profile = await requireRole("sales_rep");
  const supabase = await createClient();
  const [profitRes, staffRes] = await Promise.all([
    supabase.rpc("business_profit", { p_from: from, p_to: to }),
    supabase.rpc("staff_breakdown", { p_from: from, p_to: to }),
  ]);
  const days = profitRes.data ?? [];
  const staff = staffRes.data ?? [];
  const total = (k: "revenue" | "salaries" | "expenses" | "profit" | "jobs") => days.reduce((n, d) => n + Number(d[k]), 0);
  const profit = total("profit");

  return (
    <AppShell profile={profile} title="Money breakdown" back="/sales/payments" nav={officeNav(profile)}>
      <div className="-mx-4 -mt-4">
        <div className="sheet border-t-0 px-4 py-3">
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-900/[0.05] p-1">
            {RANGES.map(([k, label]) => (
              <Link
                key={k}
                href={`/sales/payments/breakdown?range=${k}`}
                aria-current={k === range ? "page" : undefined}
                className={`flex h-10 items-center justify-center rounded-md text-center text-xs font-semibold leading-tight ${
                  k === range ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(11_53_50/0.12)]" : "text-slate-600"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
          <p className="mt-2 text-sm tabular-nums text-slate-600">
            {shortDate(from)} to {shortDate(to)} · {total("jobs")} jobs
          </p>
        </div>

        {/* ------------------------------------------------------ profit */}
        <section className="sheet mt-3 px-4 pb-4 pt-5">
          <p className="section-label">Profit</p>
          <p className={`mt-2 text-[2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums ${profit < 0 ? "text-danger-700" : "text-slate-950"}`}>
            {profit < 0 ? "−" : ""}
            {rupees(Math.abs(profit))}
          </p>
          <dl className="mt-3 divide-y divide-brand-950/[0.07] border-t border-brand-950/[0.07] text-[0.9375rem]">
            <Row k="Revenue (collected for these jobs)" v={rupees(total("revenue"))} />
            <Row k="Salaries (supervisors and workers)" v={`− ${rupees(total("salaries"))}`} />
            <Row k="Expenses (approved)" v={`− ${rupees(total("expenses"))}`} />
          </dl>
        </section>

        {/* ------------------------------------------------- per person */}
        <p className="section-label px-4 pb-2 pt-6">Everyone</p>
        <ul className="sheet divide-y divide-brand-950/[0.07]">
          {staff.map((p) => (
            <li key={p.staff_id}>
              <Link href={`/sales/payments/staff/${p.staff_id}`} className="block px-4 py-3 active:bg-slate-50">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-semibold text-slate-900">
                    {p.full_name}
                    <span className="font-normal text-slate-500"> · {p.kind === "supervisor" ? "Supervisor" : "Worker"}</span>
                  </p>
                  <p className="shrink-0 font-semibold tabular-nums text-slate-950">{rupees(p.salary)}</p>
                </div>
                <p className="mt-0.5 text-sm tabular-nums text-slate-600">
                  {p.jobs} {Number(p.jobs) === 1 ? "job" : "jobs"} · salary
                  {Number(p.expenses) > 0 ? ` · expenses ${rupees(p.expenses)}` : ""}
                  {Number(p.expenses_pending) > 0 ? ` · ${rupees(p.expenses_pending)} waiting` : ""}
                </p>
                {p.kind === "supervisor" ? (
                  <p className="text-sm tabular-nums text-slate-600">
                    Cash collected {rupees(p.cash_collected)} · given back {rupees(p.handed_back)} ·{" "}
                    <span className={Number(p.cash_in_hand) > 0 ? "font-semibold text-danger-700" : ""}>
                      in hand now {rupees(p.cash_in_hand)}
                    </span>
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>

        {/* ---------------------------------------------------- per day */}
        <p className="section-label px-4 pb-2 pt-6">Day by day</p>
        <ul className="sheet divide-y divide-brand-950/[0.07]">
          {days.map((d) => (
            <li key={d.day} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{shortDate(d.day)}</p>
                <p className="truncate text-sm tabular-nums text-slate-600">
                  {d.jobs} jobs · in {rupees(d.revenue)} · salary {rupees(d.salaries)} · exp {rupees(d.expenses)}
                </p>
              </div>
              <p className={`shrink-0 font-semibold tabular-nums ${Number(d.profit) < 0 ? "text-danger-700" : "text-slate-950"}`}>
                {rupees(d.profit)}
              </p>
            </li>
          ))}
        </ul>

        <Link href="/sales/payouts" className="mt-3 flex min-h-14 items-center justify-between px-4 text-[0.9375rem] font-semibold text-brand-950">
          Monday payout: pay or collect each person&apos;s week
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 5 7 7-7 7" />
          </svg>
        </Link>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <dt className="min-w-0 text-slate-600">{k}</dt>
      <dd className="shrink-0 font-semibold tabular-nums text-slate-950">{v}</dd>
    </div>
  );
}
