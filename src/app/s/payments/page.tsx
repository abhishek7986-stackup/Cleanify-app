import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { formatIstDate, istDate } from "@/lib/domain/checkin-policy";
import { addDays, mondayOf, rupees, weekLabel } from "@/lib/domain/payments";
import type { PayoutStatementRow } from "@/lib/domain/database";

export const metadata = { title: "My payments" };
export const dynamic = "force-dynamic";

type EarningRow = {
  id: string;
  job_id: string;
  percent: number;
  base_amount: number;
  amount: number;
  job: { job_number: string; client: { name: string } | null } | null;
};

export default async function MyPaymentsPage() {
  const profile = await requireRole("supervisor");
  // This page is one person's own money. Admins read everyone's in the office view.
  if (profile.role !== "supervisor") redirect("/sales/payouts");

  const thisMonday = mondayOf(istDate());
  const lastMonday = addDays(thisMonday, -7);
  const supabase = await createClient();
  const [thisRes, lastRes, earningsRes, dueRes] = await Promise.all([
    supabase.rpc("payout_statement", { p_week: thisMonday }),
    supabase.rpc("payout_statement", { p_week: lastMonday }),
    supabase
      .from("job_earnings")
      .select("id, job_id, percent, base_amount, amount, job:jobs(job_number, client:clients(name))")
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(30)
      .overrideTypes<EarningRow[], { merge: false }>(),
    supabase.rpc("jobs_awaiting_payment"),
  ]);

  const current = thisRes.data?.[0];
  const last = lastRes.data?.[0];
  const due = dueRes.data ?? [];

  return (
    <AppShell
      profile={profile}
      title="My payments"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
        { href: "/s/payments", label: "Payments" },
      ]}
    >
      <div className="space-y-4">
        {due.length ? (
          <section className="rounded-2xl border border-danger-100 bg-danger-50 p-4">
            <h2 className="font-semibold text-danger-700">Payment not marked yet</h2>
            <ul className="mt-1 divide-y divide-danger-100 text-sm">
              {due.map((j) => (
                <li key={j.job_id}>
                  <Link href={`/s/jobs/${j.job_id}`} className="tap flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-slate-900">{j.client_name ?? j.job_number}</span>
                    <span className="shrink-0 tabular-nums text-slate-900">
                      {j.quoted_amount != null ? rupees(j.quoted_amount) : "Open"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {last ? <Statement title="Last week" week={lastMonday} row={last} final /> : null}
        {current ? <Statement title="This week so far" week={thisMonday} row={current} /> : null}

        {!current && !last ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            Nothing here yet. Ask the office to add you to the team list.
          </p>
        ) : null}

        {earningsRes.data?.length ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-1 font-semibold text-slate-900">My salary per job</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {earningsRes.data.map((e) => (
                <li key={e.id}>
                  <Link href={`/s/jobs/${e.job_id}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{e.job?.client?.name ?? e.job?.job_number}</span>
                      <span className="block text-xs text-slate-500">
                        {Number(e.percent)}% of {rupees(e.base_amount)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{rupees(e.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function Statement({
  title,
  week,
  row,
  final = false,
}: {
  title: string;
  week: string;
  row: PayoutStatementRow;
  final?: boolean;
}) {
  const net = Number(row.net_due);
  const bf = Number(row.brought_forward);
  const settled = Number(row.settled_amount ?? 0);
  const left = Number(row.carry_forward ?? 0);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-500">
        {weekLabel(week)} · you are at {Number(row.percent_now)}%
      </p>
      <dl className="mt-3 space-y-1 text-sm tabular-nums">
        <Line label={`Salary from ${row.job_count} ${Number(row.job_count) === 1 ? "job" : "jobs"}`} value={rupees(row.earned)} />
        {Number(row.cash_held) > 0 ? <Line label="Cash in hand (collected from customers)" value={`− ${rupees(row.cash_held)}`} /> : null}
        {bf !== 0 ? (
          <Line
            label={bf > 0 ? "Still owed to you from before" : "Still to return from before"}
            value={`${bf > 0 ? "+" : "−"} ${rupees(Math.abs(bf))}`}
          />
        ) : null}
      </dl>
      <p
        className={`mt-3 rounded-xl p-3 text-center font-bold ${
          net > 0 ? "bg-ok-50 text-ok-700" : net < 0 ? "bg-danger-50 text-danger-700" : "bg-slate-100 text-slate-600"
        }`}
      >
        <span className="block text-sm font-semibold">
          {net > 0 ? (final ? "Company pays you" : "Company pays you so far") : net < 0 ? (final ? "You return to company" : "To return so far") : "Nothing to hand over"}
        </span>
        {net !== 0 ? <span className="text-2xl tabular-nums">{rupees(Math.abs(net))}</span> : null}
      </p>
      {row.payout_id ? (
        <p className="mt-2 text-sm text-slate-600">
          {settled === 0 ? "Closed" : `${settled > 0 ? "Paid" : "Returned"} ${rupees(Math.abs(settled))}`}
          {row.settled_at ? ` on ${formatIstDate(row.settled_at)}` : ""}.
          {left !== 0 ? ` ${left > 0 ? `${rupees(left)} still owed to you` : `${rupees(-left)} still to return`}, moved to next week.` : ""}
        </p>
      ) : final && net !== 0 ? (
        <p className="mt-2 text-sm text-slate-500">Settled with the office on Monday.</p>
      ) : null}
    </section>
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
