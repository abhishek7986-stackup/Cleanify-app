"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rupees } from "@/lib/domain/payments";

export function SettleForm({ staffId, week, net }: { staffId: string; week: string; net: number }) {
  const router = useRouter();
  const due = Math.abs(net);
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState<"cash" | "upi" | "bank">("upi");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const given = Number(amount) || 0;
  const short = due - given;
  const verb = net > 0 ? "paid" : "returned";

  async function settle() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("settle_payout", {
      p_staff_id: staffId,
      p_week: week,
      p_amount: net === 0 ? 0 : given,
      p_method: net === 0 ? "none" : method,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  if (net === 0) {
    return (
      <div className="mt-3">
        {error ? <p className="mb-2 rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void settle()}
          className="tap w-full rounded-xl border-2 border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Close this week"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          Amount {verb} (₹)
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max={due}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tap mt-1 w-full rounded-xl border-2 border-slate-200 px-3 text-base font-semibold outline-none focus:border-brand-600"
          />
        </label>
        <label className="w-28 shrink-0 text-sm font-medium text-slate-700">
          How
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className="tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-2 text-base font-normal"
          >
            <option value="upi">UPI</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Note <span className="font-normal text-slate-400">(optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="tap mt-1 w-full rounded-xl border-2 border-slate-200 px-3 text-base font-normal outline-none focus:border-brand-600"
        />
      </label>
      {short > 0 && given > 0 ? (
        <p className="rounded-xl bg-warn-50 p-2 text-sm text-warn-700">
          {rupees(short)} less than the full amount. The rest moves to next week.
        </p>
      ) : null}
      {error ? <p className="rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy || given <= 0 || given > due}
        onClick={() => void settle()}
        className="tap-lg w-full rounded-2xl bg-brand-700 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : `Mark ${rupees(given)} ${verb}`}
      </button>
    </div>
  );
}

export function ReversePayoutButton({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reverse() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("reverse_payout", { p_payout_id: payoutId, p_reason: reason });
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="tap mt-1 text-xs font-medium text-slate-500 underline">
        Reverse this payout
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <label className="block text-sm font-medium text-slate-700">
        Why?
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-brand-600"
        />
      </label>
      {error ? <p className="rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="tap flex-1 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-600">
          Keep it
        </button>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => void reverse()}
          className="tap flex-1 rounded-xl bg-danger-600 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Reverse"}
        </button>
      </div>
    </div>
  );
}
