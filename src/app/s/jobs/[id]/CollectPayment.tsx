"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { rupees, upiLink } from "@/lib/domain/payments";

type Method = "upi" | "cash" | "both";

/**
 * After the work: show the customer the QR or take cash, then mark it. A plain
 * UPI QR cannot tell the app the money arrived, so the supervisor marks it here
 * and the office checks it against the bank.
 */
export function CollectPayment({
  jobId,
  jobNumber,
  quoted,
  upi,
  workers,
}: {
  jobId: string;
  jobNumber: string;
  quoted: number | null;
  upi: { id: string; name: string } | null;
  workers: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("upi");
  const [total, setTotal] = useState(quoted != null ? String(quoted) : "");
  const [cashPart, setCashPart] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [alone, setAlone] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalNum = Number(total) || 0;
  const cash = method === "cash" ? totalNum : method === "both" ? Number(cashPart) || 0 : 0;
  const upiAmount = Math.max(0, totalNum - cash);
  const splitWrong = method === "both" && (cash <= 0 || cash >= totalNum);
  const differs = quoted != null && totalNum !== quoted;
  const teamChosen = alone || picked.length > 0;
  const ready = totalNum > 0 && !splitWrong && teamChosen && (!differs || note.trim().length > 0);

  async function submit() {
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().rpc("record_job_payment", {
      p_job_id: jobId,
      p_upi_amount: upiAmount,
      p_cash_amount: cash,
      p_worker_ids: alone ? [] : picked,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-2xl border-2 border-brand-200 bg-white p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Collect payment</h2>
        <p className="text-sm text-slate-600">
          {quoted != null ? `Quoted ${rupees(quoted)}. ` : ""}Ask the customer how they want to pay.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["upi", "UPI / QR"],
            ["cash", "Cash"],
            ["both", "Both"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={method === value}
            onClick={() => setMethod(value)}
            className={`tap rounded-xl border-2 text-sm font-semibold ${
              method === value ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Total received (₹)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className="tap w-full rounded-xl border-2 border-slate-200 px-3 text-lg font-semibold outline-none focus:border-brand-600"
        />
      </label>

      {method === "both" ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Of this, cash (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={cashPart}
            onChange={(e) => setCashPart(e.target.value)}
            className="tap w-full rounded-xl border-2 border-slate-200 px-3 text-lg font-semibold outline-none focus:border-brand-600"
          />
          {totalNum > 0 && !splitWrong ? (
            <span className="mt-1 block text-sm text-slate-600">
              UPI {rupees(upiAmount)} + cash {rupees(cash)}
            </span>
          ) : null}
        </label>
      ) : null}

      {method !== "cash" && upiAmount > 0 && !splitWrong ? (
        upi ? (
          <UpiQr upi={upi} amount={upiAmount} jobNumber={jobNumber} />
        ) : (
          <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
            The company UPI ID is not set up yet, so there is no QR to show. Ask the office.
          </p>
        )
      ) : null}

      {method !== "upi" && cash > 0 ? (
        <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
          You are holding {rupees(cash)} cash. It comes off your Monday payout.
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Who worked with you on this job?</legend>
        {workers.map((w) => (
          <label key={w.id} className="tap flex items-center gap-3 rounded-xl border-2 border-slate-200 px-3">
            <input
              type="checkbox"
              className="size-5"
              checked={picked.includes(w.id)}
              onChange={(e) => {
                setAlone(false);
                setPicked((p) => (e.target.checked ? [...p, w.id] : p.filter((x) => x !== w.id)));
              }}
            />
            <span className="font-medium text-slate-800">{w.full_name}</span>
          </label>
        ))}
        <label className="tap flex items-center gap-3 rounded-xl border-2 border-slate-200 px-3">
          <input
            type="checkbox"
            className="size-5"
            checked={alone}
            onChange={(e) => {
              setAlone(e.target.checked);
              if (e.target.checked) setPicked([]);
            }}
          />
          <span className="font-medium text-slate-800">I worked alone</span>
        </label>
        {workers.length === 0 ? (
          <p className="text-sm text-slate-500">No workers are on the list yet. Calling staff add them under Payments, Team.</p>
        ) : null}
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Note{" "}
          <span className="font-normal text-slate-400">
            {differs ? "(needed: the amount is different from the quote)" : "(optional)"}
          </span>
        </span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-base outline-none focus:border-brand-600"
        />
      </label>

      {error ? <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}

      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void submit()}
        className="tap-lg w-full rounded-2xl bg-brand-700 text-base font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : `Mark ${rupees(totalNum)} received`}
      </button>
      {!teamChosen ? (
        <p className="text-center text-sm text-slate-500">Choose who worked with you, or &ldquo;I worked alone&rdquo;.</p>
      ) : null}
    </section>
  );
}

function UpiQr({
  upi,
  amount,
  jobNumber,
}: {
  upi: { id: string; name: string };
  amount: number;
  jobNumber: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const link = upiLink({ id: upi.id, name: upi.name, amount, jobNumber });

  useEffect(() => {
    let live = true;
    void QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => {
      if (live) setSvg(s);
    });
    return () => {
      live = false;
    };
  }, [link]);

  return (
    <div className="rounded-xl border-2 border-slate-200 p-4 text-center">
      <p className="text-sm text-slate-600">Show this to the customer</p>
      {/* Our own generated SVG, not outside content. */}
      <div
        aria-label={`UPI QR code for ${rupees(amount)}`}
        role="img"
        className="mx-auto my-2 w-full max-w-64"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <p className="text-2xl font-bold tabular-nums text-slate-900">{rupees(amount)}</p>
      <p className="text-sm text-slate-600">
        to {upi.name} ({upi.id})
      </p>
      <p className="mt-2 text-xs text-slate-500">Check the customer&apos;s phone shows the payment as successful.</p>
    </div>
  );
}
