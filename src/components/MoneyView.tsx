import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DeclareHandover } from "@/components/CashHandover";
import { AddExpense, MyExpenses, type ExpenseRow } from "@/components/Expenses";
import { addDays, rupees } from "@/lib/domain/payments";
import { istDate } from "@/lib/domain/checkin-policy";

/**
 * One person's money, simply: today, the cash in their hand, then day by day.
 * The supervisor sees it on Payments; calling staff see the very same screen
 * for each supervisor, so both read the same numbers.
 */
export async function MoneyView({ staffId, self }: { staffId: string; self: boolean }) {
  const supabase = await createClient();
  const [sumRes, dailyRes, handRes, expRes] = await Promise.all([
    supabase.rpc("staff_pay_summary", { p_staff_id: staffId }),
    supabase.rpc("staff_daily", { p_staff_id: staffId, p_days: 7 }),
    supabase
      .from("cash_handovers")
      .select("*")
      .eq("staff_id", staffId)
      .is("voided_at", null)
      .order("declared_at", { ascending: false })
      .limit(3),
    supabase
      .from("expenses")
      .select("id, spent_on, category, amount, paid_from, note, status, reject_reason")
      .eq("staff_id", staffId)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const expenses: ExpenseRow[] = (expRes.data ?? []).map((x) => ({ ...x, bill_url: null }));
  const s = sumRes.data?.[0];
  const days = dailyRes.data ?? [];
  if (!s) {
    return (
      <section className="sheet -mx-4 -mt-4 border-t-0 px-4 py-6">
        <p className="text-lg font-semibold text-slate-900">Not on the pay list yet</p>
        <p className="mt-1 text-sm text-slate-600">Add them under Payments → Team %, then their money shows here.</p>
      </section>
    );
  }

  const today = days[0];
  const net = Number(s.week_net);
  const inHand = Math.max(0, -net);
  const you = self ? "you" : "they";
  const your = self ? "your" : "their";
  const pending = (handRes.data ?? []).find((h) => h.status === "PENDING") ?? null;
  const payoutDay = new Date(`${s.payout_day}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="-mx-4 -mt-4">
      {/* --------------------------------------------------------- 1. today */}
      <section className="sheet border-t-0 px-4 pb-4 pt-5">
        <p className="section-label">Today</p>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-[2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-slate-950">
            {rupees(s.today_earned)}
          </span>
          <span className="text-[0.9375rem] text-slate-600">earned</span>
        </p>
        <dl className="mt-3 divide-y divide-brand-950/[0.07] border-t border-brand-950/[0.07] text-[0.9375rem]">
          <Row
            k={`Still to earn · ${s.today_jobs_left} ${Number(s.today_jobs_left) === 1 ? "job" : "jobs"} left`}
            v={rupees(s.today_expected)}
          />
          <Row k="Cash collected today" v={rupees(today?.cash_collected ?? 0)} />
          <Row k="UPI collected today" v={rupees(today?.upi_collected ?? 0)} />
        </dl>
      </section>

      {/* ------------------------------------------------ 2. cash in hand */}
      <section className="sheet mt-3 px-4 pb-4 pt-5">
        <p className="section-label">Cash in {your} hand</p>
        <p
          className={`mt-2 text-[2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums ${
            inHand > 0 ? "text-danger-700" : "text-slate-950"
          }`}
        >
          {rupees(inHand)}
        </p>
        <p className="mt-2 text-[0.9375rem] text-slate-600">
          {inHand > 0
            ? `Customers' cash ${you} are holding, after ${your} salary. ${self ? "Hand it back to the office." : "To come back to the office."}`
            : net > 0
              ? `Nothing to hand back. The company owes ${self ? "you" : "them"} ${rupees(net)} on ${payoutDay}.`
              : `Nothing to hand back.`}
        </p>
        {self ? (
          <DeclareHandover holding={inHand} pending={pending} />
        ) : pending ? (
          <p className="mt-3 flex items-center gap-2.5 text-[0.9375rem] text-slate-900">
            <span className="size-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
            Says {rupees(pending.amount)} handed back, waiting for you to confirm on Payments.
          </p>
        ) : null}
      </section>

      {/* -------------------------------------------- Monday's salary */}
      <section className="sheet mt-3 px-4 pb-4 pt-5">
        <p className="section-label">Monday payout · {payoutDay}</p>
        <dl className="mt-2 divide-y divide-brand-950/[0.07] text-[0.9375rem]">
          <Row k={`Salary this week · ${s.week_jobs} ${Number(s.week_jobs) === 1 ? "job" : "jobs"}`} v={`+ ${rupees(s.week_earned)}`} />
          {Number(s.brought_forward) !== 0 ? (
            <Row
              k={Number(s.brought_forward) > 0 ? "Still owed from before" : "Still to give back from before"}
              v={`${Number(s.brought_forward) > 0 ? "+" : "−"} ${rupees(Math.abs(Number(s.brought_forward)))}`}
            />
          ) : null}
          <Row k="Customers' cash collected this week" v={`− ${rupees(s.week_cash_collected)}`} />
          {Number(s.week_handed_back) > 0 ? <Row k="Given to the office or spent on work (approved)" v={`+ ${rupees(s.week_handed_back)}`} /> : null}
        </dl>
        <p className={`mt-3 flex items-baseline justify-between rounded-lg px-3 py-3 ${net < 0 ? "bg-danger-50" : "bg-ok-50"}`}>
          <span className={`font-semibold ${net < 0 ? "text-danger-700" : "text-ok-700"}`}>
            {net < 0 ? (self ? "You give the office" : "They give the office") : self ? "The office pays you" : "The office pays them"}
          </span>
          <span className={`text-xl font-semibold tabular-nums ${net < 0 ? "text-danger-700" : "text-ok-700"}`}>{rupees(Math.abs(net))}</span>
        </p>
      </section>

      {/* ------------------------------------------------- expenses */}
      <section className="sheet mt-3 px-4 pb-4 pt-5">
        <p className="section-label pb-2">Expenses</p>
        <MyExpenses rows={expenses} />
        {self ? (
          <div className={expenses.length ? "pt-3" : ""}>
            <AddExpense />
          </div>
        ) : !expenses.length ? (
          <p className="text-sm text-slate-600">No expenses recorded.</p>
        ) : null}
      </section>

      {/* ---------------------------------------------- 3. day by day */}
      <p className="section-label px-4 pb-2 pt-6">Day by day</p>
      <ul className="sheet divide-y divide-brand-950/[0.07]">
        {days.map((d) => {
          const quiet = Number(d.jobs) === 0 && Number(d.cash_collected) === 0 && Number(d.upi_collected) === 0;
          return (
            <li key={d.day} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className={`font-semibold ${quiet ? "text-slate-500" : "text-slate-900"}`}>{dayName(d.day)}</p>
                <p className="truncate text-sm tabular-nums text-slate-600">
                  {quiet
                    ? "No work"
                    : `${d.jobs} ${Number(d.jobs) === 1 ? "job" : "jobs"} · cash ${rupees(d.cash_collected)} · UPI ${rupees(d.upi_collected)}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-semibold tabular-nums ${quiet ? "text-slate-500" : "text-slate-950"}`}>{rupees(d.earned)}</p>
                <p className="text-xs text-slate-500">earned</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* --------------------------------------------------- 4. more */}
      <p className="section-label px-4 pb-2 pt-6">More</p>
      <dl className="sheet divide-y divide-brand-950/[0.07] px-4 text-[0.9375rem]">
        <Row k="This week (Mon to Sun)" v={rupees(s.week_earned)} />
        <Row k="This month" v={rupees(s.month_earned)} />
        <Row k="Last month" v={rupees(s.last_month_earned)} />
        <Row
          k={
            s.next_from_earned != null && s.next_percent != null
              ? `Rate · ${Number(s.next_percent)}% after ${rupees(s.next_from_earned)} earned`
              : "Rate"
          }
          v={`${Number(s.percent_now)}%`}
        />
      </dl>
      {self ? (
        <Link href="/s/history" className="flex min-h-14 items-center justify-between px-4 text-[0.9375rem] font-semibold text-brand-950">
          See all past jobs
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 5 7 7-7 7" />
          </svg>
        </Link>
      ) : null}
    </div>
  );
}

function dayName(iso: string): string {
  const today = istDate();
  const label = new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  return iso === today ? `Today · ${label}` : iso === addDays(today, -1) ? `Yesterday · ${label}` : label;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <dt className="min-w-0 text-slate-600">{k}</dt>
      <dd className="shrink-0 font-semibold tabular-nums text-slate-950">{v}</dd>
    </div>
  );
}
