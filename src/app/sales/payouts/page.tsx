import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { OfficeTabs } from "@/components/OfficeTabs";
import { officeNav } from "@/lib/nav";
import { formatIstDate, istDate } from "@/lib/domain/checkin-policy";
import { addDays, mondayOf, previewPercent, rupees, salarySlip, weekLabel, whatsappLink } from "@/lib/domain/payments";
import type { PayoutStatementRow } from "@/lib/domain/database";
import { ReversePayoutButton, SettleForm } from "./PayoutActions";

export const metadata = { title: "Monday payout" };
export const dynamic = "force-dynamic";

type EarningRow = {
  staff_id: string;
  job_id: string;
  percent: number;
  base_amount: number;
  amount: number;
  job: { job_number: string; client: { name: string } | null } | null;
};

export default async function PayoutsPage(props: PageProps<"/sales/payouts">) {
  const sp = await props.searchParams;
  const thisMonday = mondayOf(istDate());
  const week = mondayOf(
    typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : addDays(thisMonday, -7),
  );
  const finished = week < thisMonday;

  const profile = await requireRole("sales_rep");
  const supabase = await createClient();
  const [statementRes, earningsRes, staffRes] = await Promise.all([
    supabase.rpc("payout_statement", { p_week: week }),
    supabase
      .from("job_earnings")
      .select("staff_id, job_id, percent, base_amount, amount, job:jobs(job_number, client:clients(name))")
      .eq("week_start", week)
      .is("voided_at", null)
      .order("created_at")
      .overrideTypes<EarningRow[], { merge: false }>(),
    supabase.from("pay_staff").select("id, phone, joined_on, start_percent, max_percent, fixed_percent"),
  ]);

  const rows = statementRes.data ?? [];
  const staffById = new Map((staffRes.data ?? []).map((s) => [s.id, s]));
  const today = istDate();
  const slipLink = (r: PayoutStatementRow) => {
    const s = staffById.get(r.staff_id);
    if (!s?.phone) return null;
    return whatsappLink(
      s.phone,
      salarySlip({
        name: r.full_name,
        week,
        percentNow: Number(r.percent_now),
        jobCount: Number(r.job_count),
        salary: Number(r.earned),
        cashHeld: Number(r.cash_held),
        broughtForward: Number(r.brought_forward),
        net: Number(r.net_due),
        settled: r.payout_id
          ? {
              amount: Number(r.settled_amount ?? 0),
              method: r.method,
              on: r.settled_at ? formatIstDate(r.settled_at) : null,
              left: Number(r.carry_forward ?? 0),
            }
          : null,
        nextRise: previewPercent(s, today).nextRise,
      }),
    );
  };
  const earnings = earningsRes.data ?? [];
  // What is still left to hand over, this week.
  const leftToSettle = (r: PayoutStatementRow) =>
    r.payout_id ? Number(r.carry_forward ?? 0) : Number(r.net_due);
  const toPay = rows.reduce((n, r) => n + Math.max(0, r.payout_id ? 0 : Number(r.net_due)), 0);
  const toReturn = rows.reduce((n, r) => n + Math.max(0, r.payout_id ? 0 : -Number(r.net_due)), 0);
  const isAdmin = profile.role === "admin";

  return (
    <AppShell profile={profile} title="Monday payout" nav={officeNav(profile)}>
      <div className="space-y-4">
        <OfficeTabs active="payouts" />

        <div className="flex items-center gap-2">
          <Link
            href={`/sales/payouts?week=${addDays(week, -7)}`}
            aria-label="Previous week"
            className="tap flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-lg text-slate-700"
          >
            ‹
          </Link>
          <p className="flex-1 text-center font-semibold text-slate-900">
            {weekLabel(week)}
            <span className="block text-xs font-normal text-slate-500">
              {finished ? `Pay on Monday ${weekLabel(addDays(week, 7)).split(" to ")[0]}` : "Week still running"}
            </span>
          </p>
          <Link
            href={`/sales/payouts?week=${addDays(week, 7)}`}
            aria-label="Next week"
            className="tap flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-lg text-slate-700"
          >
            ›
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-ok-100 bg-ok-50 p-3">
            <p className="text-sm font-semibold text-ok-700">Company pays staff</p>
            <p className="text-2xl font-bold tabular-nums text-ok-700">{rupees(toPay)}</p>
          </div>
          <div className="rounded-2xl border border-danger-100 bg-danger-50 p-3">
            <p className="text-sm font-semibold text-danger-700">Staff return to company</p>
            <p className="text-2xl font-bold tabular-nums text-danger-700">{rupees(toReturn)}</p>
          </div>
        </div>

        <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
          Each person: <b>salary</b> minus <b>cash in hand</b> they collected from customers, plus anything left over from
          earlier weeks. Above zero, the company pays them. Below zero, they return it.
        </p>

        {!finished ? (
          <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
            This week is not over, so these figures can still change. It can be paid out from next Monday.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            Nobody is on the staff list yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const net = Number(r.net_due);
              const mine = earnings.filter((e) => e.staff_id === r.staff_id);
              const quiet = net === 0 && Number(r.job_count) === 0 && !r.payout_id;
              const left = leftToSettle(r);
              return (
                <li key={r.staff_id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{r.full_name}</p>
                      <p className="text-xs text-slate-500 first-letter:uppercase">
                        {r.kind} · {Number(r.percent_now)}% now
                      </p>
                    </div>
                    {quiet ? (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        No work this week
                      </span>
                    ) : r.payout_id ? (
                      <span className="shrink-0 rounded-full bg-ok-100 px-2.5 py-1 text-xs font-semibold text-ok-700">Settled</span>
                    ) : null}
                  </div>

                  {quiet ? null : (
                    <>
                      <dl className="mt-3 space-y-1 text-sm tabular-nums">
                        <Line label={`Salary from ${r.job_count} ${Number(r.job_count) === 1 ? "job" : "jobs"}`} value={rupees(r.earned)} />
                        {Number(r.cash_held) > 0 ? <Line label="Cash in hand (collected from customers)" value={`− ${rupees(r.cash_held)}`} /> : null}
                        {Number(r.brought_forward) !== 0 ? (
                          <Line
                            label={Number(r.brought_forward) > 0 ? "Still owed from earlier weeks" : "Still to return from earlier weeks"}
                            value={`${Number(r.brought_forward) > 0 ? "+" : "−"} ${rupees(Math.abs(Number(r.brought_forward)))}`}
                          />
                        ) : null}
                      </dl>

                      <p
                        className={`mt-3 rounded-xl p-3 text-center font-bold ${
                          net > 0 ? "bg-ok-50 text-ok-700" : net < 0 ? "bg-danger-50 text-danger-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <span className="block text-sm font-semibold">
                          {net > 0 ? "Company pays them" : net < 0 ? "They return to company" : "Nothing to hand over"}
                        </span>
                        {net !== 0 ? <span className="text-2xl tabular-nums">{rupees(Math.abs(net))}</span> : null}
                      </p>

                      {(() => {
                        const href = slipLink(r);
                        return href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="tap mt-3 flex items-center justify-center gap-2 rounded-xl border-2 border-ok-600 text-sm font-semibold text-ok-700"
                          >
                            Send salary slip on WhatsApp
                          </a>
                        ) : (
                          <p className="mt-3 text-center text-xs text-slate-500">
                            No mobile number, so no WhatsApp slip. Add it under Team %.
                          </p>
                        );
                      })()}

                      {mine.length ? (
                        <details className="mt-2 text-sm">
                          <summary className="tap flex cursor-pointer items-center font-medium text-brand-700">See the jobs</summary>
                          <ul className="divide-y divide-slate-100">
                            {mine.map((e) => (
                              <li key={e.job_id} className="flex justify-between gap-3 py-1.5">
                                <span className="min-w-0 truncate text-slate-600">
                                  {e.job?.client?.name ?? e.job?.job_number}
                                  <span className="block text-xs text-slate-400">
                                    {Number(e.percent)}% of {rupees(e.base_amount)}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums text-slate-900">{rupees(e.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}

                      {r.payout_id ? (
                        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                          <p>
                            {Number(r.settled_amount) === 0
                              ? "Closed with nothing handed over"
                              : `${Number(r.settled_amount) > 0 ? "Paid" : "Returned"} ${rupees(Math.abs(Number(r.settled_amount)))}`}
                            {r.method && r.method !== "none" ? ` by ${r.method === "upi" ? "UPI" : r.method}` : ""}
                            {r.settled_at ? ` on ${formatIstDate(r.settled_at)}` : ""}
                          </p>
                          {left !== 0 ? (
                            <p className="mt-1 font-medium text-warn-700">
                              {left > 0 ? `${rupees(left)} still owed to them` : `${rupees(-left)} still to return`}, moved to next week.
                            </p>
                          ) : null}
                          {r.note ? <p className="mt-1 text-slate-500">Note: {r.note}</p> : null}
                          {profile.is_super_admin ? <ReversePayoutButton payoutId={r.payout_id} /> : null}
                        </div>
                      ) : isAdmin && finished ? (
                        <SettleForm staffId={r.staff_id} week={week} net={net} />
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className="shrink-0 font-medium text-slate-900">{value}</dd>
    </div>
  );
}
