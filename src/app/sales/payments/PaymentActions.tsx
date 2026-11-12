"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function VerifyUpiButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("verify_upi_payment", { p_payment_id: paymentId });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  return (
    <span className="shrink-0 text-right">
      <button
        type="button"
        disabled={busy}
        onClick={() => void verify()}
        className="tap rounded-xl border-2 border-brand-600 px-3 text-xs font-semibold text-brand-700 disabled:opacity-40"
      >
        {busy ? "Saving…" : "Found in bank"}
      </button>
      {error ? <span className="mt-1 block text-xs text-danger-700">{error}</span> : null}
    </span>
  );
}

export function CancelPaymentButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("void_job_payment", { p_job_id: jobId, p_reason: reason });
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="tap mt-1 text-xs font-medium text-slate-500 underline">
        Wrong? Cancel this payment
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3">
      <label className="block text-sm font-medium text-slate-700">
        Why is it wrong?
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-brand-600"
        />
      </label>
      <p className="text-xs text-slate-500">
        It stays on record as cancelled, and the job goes back to not collected so the supervisor can mark it again.
      </p>
      {error ? <p className="rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="tap flex-1 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-600">
          Keep it
        </button>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => void cancel()}
          className="tap flex-1 rounded-xl bg-danger-600 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Cancel payment"}
        </button>
      </div>
    </div>
  );
}

export function CorrectPaymentButton({ jobId, upi, cash }: { jobId: string; upi: number; cash: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [upiAmount, setUpiAmount] = useState(upi ? String(upi) : "");
  const [cashAmount, setCashAmount] = useState(cash ? String(cash) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = (Number(upiAmount) || 0) + (Number(cashAmount) || 0);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("correct_job_payment", {
      p_job_id: jobId,
      p_upi_amount: Number(upiAmount) || 0,
      p_cash_amount: Number(cashAmount) || 0,
      p_reason: reason,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap mt-2 w-full rounded-xl border-2 border-brand-600 text-sm font-semibold text-brand-700"
      >
        Correct the amount
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-800">The real amount received</p>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
          UPI ₹
          <input
            inputMode="numeric"
            value={upiAmount}
            onChange={(e) => setUpiAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="tap mt-1 block w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base tabular-nums outline-none focus:border-brand-600"
          />
        </label>
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
          Cash ₹
          <input
            inputMode="numeric"
            value={cashAmount}
            onChange={(e) => setCashAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="tap mt-1 block w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base tabular-nums outline-none focus:border-brand-600"
          />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Why is it changing?
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Supervisor typed 1000, customer paid 2000"
          className="tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-brand-600"
        />
      </label>
      <p className="text-xs text-slate-500">
        New total ₹{total.toLocaleString("en-IN")}. The old figure stays on record as corrected, and everyone&apos;s
        salary for this job is worked out again on the new amount.
      </p>
      {error ? <p className="rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="tap flex-1 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-600">
          Keep it
        </button>
        <button
          type="button"
          disabled={busy || !reason.trim() || total <= 0}
          onClick={() => void save()}
          className="tap flex-1 rounded-xl bg-brand-700 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save correct amount"}
        </button>
      </div>
    </div>
  );
}

export function UpiSettings({ upi }: { upi: { id: string; name: string } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(!upi);
  const [id, setId] = useState(upi?.id ?? "");
  const [name, setName] = useState(upi?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("set_upi_details", { p_upi_id: id, p_payee_name: name });
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
        <span className="min-w-0 break-words text-slate-600">
          Customers pay <b className="text-slate-900">{upi?.name}</b> ({upi?.id})
        </span>
        <button type="button" onClick={() => setOpen(true)} className="tap shrink-0 text-sm font-semibold text-brand-700">
          Change
        </button>
      </div>
    );
  }
  return (
    <section className="space-y-3 rounded-2xl border-2 border-warn-100 bg-warn-50 p-4">
      <div>
        <h2 className="font-semibold text-slate-900">Company UPI for the QR</h2>
        <p className="text-sm text-slate-600">Customers&apos; money goes to this ID. Copy it carefully from your bank app.</p>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        UPI ID
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="name@bank"
          autoCapitalize="none"
          autoCorrect="off"
          className="tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-brand-600"
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Name customers see
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-brand-600"
        />
      </label>
      {error ? <p className="rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="tap w-full rounded-xl bg-brand-700 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
