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
