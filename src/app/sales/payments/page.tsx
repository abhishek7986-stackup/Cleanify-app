import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OfficeTabs } from "@/components/OfficeTabs";
import { officeNav } from "@/lib/nav";
import { formatIstDate, formatIstTime, istDate } from "@/lib/domain/checkin-policy";
import { mondayOf, rupees, shortDate } from "@/lib/domain/payments";
import { CancelPaymentButton, UpiSettings, VerifyUpiButton } from "./PaymentActions";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const LIST_LIMIT = 200;

type Row = {
  id: string;
  job_id: string;
  amount: number;
  mode: "upi" | "cash";
  collected_at: string;
  verified_at: string | null;
  note: string | null;
  job: {
    job_number: string;
    assigned_supervisor_id: string | null;
    client: { name: string } | null;
  } | null;
};

export default async function PaymentsPage(props: PageProps<"/sales/payments">) {
  const sp = await props.searchParams;
  const today = istDate();
  const range = sp.range === "week" || sp.range === "month" || sp.range === "custom" ? sp.range : "today";
  const custom = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today);
  const from =
    range === "week" ? mondayOf(today) : range === "month" ? `${today.slice(0, 7)}-01` : range === "custom" ? custom(sp.from) : today;
  const to = range === "custom" ? custom(sp.to) : today;

  const profile = await requireRole("sales_rep");
  const supabase = await createClient();
  const [totalsRes, listRes, dueRes, directoryRes, upiRes] = await Promise.all([
    supabase.rpc("payment_totals", { p_from: from, p_to: to }),
    supabase
      .from("payments")
      .select(
        "id, job_id, amount, mode, collected_at, verified_at, note, job:jobs(job_number, assigned_supervisor_id, client:clients(name))",
      )
      .is("voided_at", null)
      .in("mode", ["upi", "cash"])
      .gte("collected_at", `${from}T00:00:00+05:30`)
      .lte("collected_at", `${to}T23:59:59.999+05:30`)
      .order("collected_at", { ascending: false })
      .limit(LIST_LIMIT)
      .overrideTypes<Row[], { merge: false }>(),
    supabase.rpc("jobs_awaiting_payment"),
    supabase.from("staff_directory").select("id, full_name"),
    supabase.from("app_settings").select("value").eq("key", "payments.upi").maybeSingle(),
  ]);

  const totals = totalsRes.data ?? [];
  const due = dueRes.data ?? [];
  const upi = (upiRes.data?.value as { id: string; name: string } | undefined) ?? null;
  const nameOf = (id: string | null | undefined) =>
    (directoryRes.data ?? []).find((s) => s.id === id)?.full_name ?? "Supervisor";

  const sum = (key: "upi_total" | "cash_total" | "upi_unchecked") =>
    totals.reduce((n, r) => n + Number(r[key]), 0);
  const upiTotal = sum("upi_total");
  const cashTotal = sum("cash_total");
  const unchecked = sum("upi_unchecked");
  const jobCount = totals.reduce((n, r) => n + Number(r.job_count), 0);
  const dueTotal = due.reduce((n, j) => n + Number(j.quoted_amount ?? 0), 0);

  // One card per job, even when it was part UPI and part cash.
  const byJob = new Map<string, Row[]>();
  for (const row of listRes.data ?? []) byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), row]);

  // Calling staff look after all the money; there is no separate super admin.
  const canManageMoney = profile.role === "admin" || profile.role === "sales_rep";

  return (
    <AppShell profile={profile} title="Payments" nav={officeNav(profile)}>
      <AutoRefresh seconds={30} />
      <div className="space-y-4">
        <OfficeTabs active="payments" />

        {canManageMoney ? (
          <UpiSettings upi={upi} />
        ) : !upi ? (
          <p className="rounded-2xl border border-warn-100 bg-warn-50 p-3 text-sm text-warn-700">
            The company UPI ID is not set up, so supervisors have no QR to show. Calling staff can add it here.
          </p>
        ) : null}

        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["today", "Today"],
              ["week", "This week"],
              ["month", "This month"],
              ["custom", "Pick dates"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={`/sales/payments?range=${key}`}
              aria-current={range === key ? "true" : undefined}
              className={`tap flex items-center justify-center rounded-xl px-1 text-center text-xs font-semibold ${
                range === key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {range === "custom" ? (
          <form action="/sales/payments" className="flex items-end gap-2">
            <input type="hidden" name="range" value="custom" />
            <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
              From
              <input type="date" name="from" defaultValue={from} className="tap mt-1 block w-full rounded-xl border-2 border-slate-200 bg-white px-2 text-sm" />
            </label>
            <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
              To
              <input type="date" name="to" defaultValue={to} className="tap mt-1 block w-full rounded-xl border-2 border-slate-200 bg-white px-2 text-sm" />
            </label>
            <button className="tap rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white">Show</button>
          </form>
        ) : null}

        {/* The one thing everyone looks for: how much, and how it came in. */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">
            Total received, {from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`}
          </p>
          <p className="text-4xl font-bold tabular-nums text-slate-900">{rupees(upiTotal + cashTotal)}</p>
          <p className="text-sm text-slate-500">
            from {jobCount} {jobCount === 1 ? "job" : "jobs"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-brand-50 p-3">
              <p className="text-sm font-semibold text-brand-800">UPI</p>
              <p className="text-2xl font-bold tabular-nums text-brand-900">{rupees(upiTotal)}</p>
              <p className="text-xs text-brand-800">Goes to the company bank</p>
            </div>
            <div className="rounded-xl bg-warn-50 p-3">
              <p className="text-sm font-semibold text-warn-700">Cash</p>
              <p className="text-2xl font-bold tabular-nums text-warn-700">{rupees(cashTotal)}</p>
              <p className="text-xs text-warn-700">Held by supervisors until Monday</p>
            </div>
          </div>
        </section>

        {unchecked > 0 ? (
          <p className="rounded-2xl border border-warn-100 bg-warn-50 p-3 text-sm font-medium text-warn-700">
            {rupees(unchecked)} of the UPI is marked by supervisors but not yet checked against the bank.
          </p>
        ) : null}

        {due.length > 0 ? (
          <section className="rounded-2xl border border-danger-100 bg-danger-50 p-4">
            <h2 className="font-semibold text-danger-700">
              Not collected yet: {due.length} {due.length === 1 ? "job" : "jobs"}
              {dueTotal > 0 ? `, ${rupees(dueTotal)} quoted` : ""}
            </h2>
            <ul className="mt-2 divide-y divide-danger-100 text-sm">
              {due.map((j) => (
                <li key={j.job_id}>
                  <Link href={`/sales/jobs/${j.job_id}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{j.client_name ?? j.job_number}</span>
                      <span className="block truncate text-xs text-slate-600">
                        {j.supervisor_name ?? "No supervisor"} · {formatIstDate(`${j.service_date}T12:00:00+05:30`)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                      {j.quoted_amount != null ? rupees(j.quoted_amount) : "No quote"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {totals.length > 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-semibold text-slate-900">By supervisor</h2>
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="py-1 font-medium">Name</th>
                  <th scope="col" className="py-1 text-right font-medium">UPI</th>
                  <th scope="col" className="py-1 text-right font-medium">Cash</th>
                  <th scope="col" className="py-1 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {totals.map((r) => (
                  <tr key={r.supervisor_id ?? "none"}>
                    <td className="max-w-28 truncate py-2 font-medium text-slate-900">{r.supervisor_name ?? "Supervisor"}</td>
                    <td className="py-2 text-right text-slate-700">{rupees(r.upi_total)}</td>
                    <td className="py-2 text-right text-slate-700">{rupees(r.cash_total)}</td>
                    <td className="py-2 text-right font-semibold text-slate-900">
                      {rupees(Number(r.upi_total) + Number(r.cash_total))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Every payment</h2>
          {byJob.size === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
              No payments in these dates.
            </p>
          ) : (
            [...byJob.entries()].map(([jobId, rows]) => {
              const job = rows[0].job;
              const total = rows.reduce((n, r) => n + Number(r.amount), 0);
              return (
                <article key={jobId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/sales/jobs/${jobId}`} className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{job?.client?.name ?? job?.job_number}</p>
                      <p className="text-xs text-slate-500">
                        {job?.job_number} · {nameOf(job?.assigned_supervisor_id)}
                        <span className="block">
                          {formatIstDate(rows[0].collected_at)}, {formatIstTime(rows[0].collected_at)}
                        </span>
                      </p>
                    </Link>
                    <p className="shrink-0 text-lg font-bold tabular-nums text-slate-900">{rupees(total)}</p>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              r.mode === "upi" ? "bg-brand-100 text-brand-800" : "bg-warn-100 text-warn-700"
                            }`}
                          >
                            {r.mode === "upi" ? "UPI" : "Cash"}
                          </span>
                          <span className="tabular-nums text-slate-800">{rupees(r.amount)}</span>
                          {r.mode === "upi" ? (
                            <span className={`text-xs ${r.verified_at ? "text-ok-700" : "text-warn-700"}`}>
                              {r.verified_at ? "Checked in bank" : "Not checked yet"}
                            </span>
                          ) : null}
                        </span>
                        {canManageMoney && r.mode === "upi" && !r.verified_at ? <VerifyUpiButton paymentId={r.id} /> : null}
                      </li>
                    ))}
                  </ul>
                  {rows[0].note ? <p className="mt-2 text-sm text-slate-600">Note: {rows[0].note}</p> : null}
                  {canManageMoney ? <CancelPaymentButton jobId={jobId} /> : null}
                </article>
              );
            })
          )}
          {(listRes.data?.length ?? 0) >= LIST_LIMIT ? (
            <p className="text-center text-xs text-slate-500">
              Showing the latest {LIST_LIMIT}. The totals above still count everything. Pick fewer dates to see the rest.
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
