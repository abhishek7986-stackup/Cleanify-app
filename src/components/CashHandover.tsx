"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rupees } from "@/lib/domain/payments";
import type { CashHandover } from "@/lib/domain/database";

type Method = "cash" | "upi" | "bank";
const METHODS: { value: Method; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank" },
];
const METHOD_LABEL: Record<Method, string> = { cash: "cash", upi: "UPI", bank: "bank transfer" };

const input =
  "h-12 w-full rounded-lg border border-brand-950/15 bg-white px-3 text-base text-slate-900 outline-none focus:border-brand-950";
const primary =
  "flex h-12 w-full items-center justify-center rounded-lg bg-brand-950 text-[0.9375rem] font-semibold text-white active:bg-brand-900 disabled:bg-slate-200 disabled:text-slate-500";
const secondary =
  "flex h-12 items-center justify-center rounded-lg border border-brand-950/15 px-4 text-[0.9375rem] font-semibold text-brand-950 active:bg-brand-50 disabled:opacity-40";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900/[0.05] p-1" role="radiogroup" aria-label="How it was handed back">
      {METHODS.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={value === m.value}
          onClick={() => onChange(m.value)}
          className={`h-10 rounded-md text-sm font-semibold ${
            value === m.value ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(11_53_50/0.12)]" : "text-slate-600"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ supervisor */

/** "I handed back cash": the supervisor's side. The office confirms it. */
export function DeclareHandover({ holding, pending }: { holding: number; pending: CashHandover | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(holding > 0 ? String(Math.round(holding)) : "");
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (pending) {
    return (
      <p className="flex items-start gap-2.5 py-3 text-[0.9375rem] text-slate-900">
        <span className="mt-1.5 size-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden />
        <span>
          <b className="font-semibold tabular-nums">{rupees(pending.amount)}</b> by {METHOD_LABEL[pending.method]} is waiting
          for the office to confirm. It comes off what you hold once they do.
        </span>
      </p>
    );
  }

  if (!open) {
    return (
      <div className="py-3">
        <button type="button" onClick={() => setOpen(true)} className={`${secondary} w-full`}>
          I handed back cash
        </button>
      </div>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("declare_cash_handover", {
      p_amount: Number(amount),
      p_method: method,
      p_note: note || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-3 py-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Amount handed back (₹)</span>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          className={`${input} tabular-nums`}
        />
      </label>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">How</span>
        <MethodPicker value={method} onChange={setMethod} />
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Note <span className="font-normal text-slate-500">(optional)</span>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Gave it to Priya at the office" className={input} />
      </label>
      <p className="text-sm text-slate-600">The office confirms they received it. Until then it still counts as with you.</p>
      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className={secondary}>
          Cancel
        </button>
        <button type="button" disabled={busy || !Number(amount)} onClick={() => void send()} className={primary}>
          {busy ? "Sending…" : `Send ${amount ? rupees(Number(amount)) : ""} for confirming`}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- office */

export type HandoverRow = CashHandover & { staff_name: string };

/** Pending handovers to confirm or reject, and the recent confirmed ones. */
export function OfficeHandovers({
  pending,
  recent,
  staff,
}: {
  pending: HandoverRow[];
  recent: HandoverRow[];
  staff: { id: string; full_name: string }[];
}) {
  return (
    <div className="space-y-5">
      {pending.length ? (
        <section>
          <p className="section-label pb-2 text-amber-800">Waiting for you to confirm</p>
          <ul className="sheet -mx-4 divide-y divide-brand-950/[0.07]">
            {pending.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <PendingRow h={h} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RecordSection staff={staff} />

      {recent.length ? (
        <section>
          <p className="section-label pb-2">Handed back recently</p>
          <ul className="sheet -mx-4 divide-y divide-brand-950/[0.07]">
            {recent.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <RecentRow h={h} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PendingRow({ h }: { h: HandoverRow }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(confirm: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("review_cash_handover", {
      p_id: h.id,
      p_confirm: confirm,
      p_reason: confirm ? null : reason,
    });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-semibold text-slate-900">{h.staff_name}</p>
        <p className="shrink-0 font-semibold tabular-nums text-slate-950">{rupees(h.amount)}</p>
      </div>
      <p className="text-sm text-slate-600">
        Says handed back by {METHOD_LABEL[h.method]} · {when(h.declared_at)}
        {h.note ? ` · “${h.note}”` : ""}
      </p>
      {rejecting ? (
        <div className="space-y-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is rejected" className={input} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setRejecting(false)} className={secondary}>
              Back
            </button>
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => void review(false)}
              className="flex h-12 flex-1 items-center justify-center rounded-lg bg-danger-600 text-[0.9375rem] font-semibold text-white disabled:opacity-40"
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setRejecting(true)} className={secondary}>
            Not received
          </button>
          <button type="button" disabled={busy} onClick={() => void review(true)} className={primary}>
            {busy ? "Saving…" : `Received ${rupees(h.amount)}`}
          </button>
        </div>
      )}
      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
    </div>
  );
}

function RecentRow({ h }: { h: HandoverRow }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const voided = Boolean(h.voided_at);

  async function cancel() {
    setError(null);
    const { error: err } = await createClient().rpc("void_cash_handover", { p_id: h.id, p_reason: reason });
    if (err) return setError(err.message);
    router.refresh();
  }

  const state = voided
    ? `Cancelled: ${h.void_reason}`
    : h.status === "REJECTED"
      ? `Rejected: ${h.reject_reason}`
      : `Received by ${METHOD_LABEL[h.method]}`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`min-w-0 truncate font-semibold ${voided || h.status === "REJECTED" ? "text-slate-500" : "text-slate-900"}`}>
          {h.staff_name}
        </p>
        <p className={`shrink-0 tabular-nums ${voided || h.status === "REJECTED" ? "text-slate-500 line-through" : "font-semibold text-slate-950"}`}>
          {rupees(h.amount)}
        </p>
      </div>
      <p className="text-sm text-slate-600">
        {state} · {when(h.reviewed_at ?? h.declared_at)}
      </p>
      {!voided && h.status === "CONFIRMED" ? (
        cancelling ? (
          <div className="flex gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why cancel it" className={input} />
            <button type="button" disabled={!reason.trim()} onClick={() => void cancel()} className={secondary}>
              Cancel it
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setCancelling(true)} className="text-sm font-medium text-slate-600 underline">
            Wrong? Cancel this handover
          </button>
        )
      ) : null}
      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
    </div>
  );
}

/** Folded until needed: a row that opens the "cash received" form. */
function RecordSection({ staff }: { staff: { id: string; full_name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <p className="section-label pb-2">Cash handed back</p>
      <div className="sheet -mx-4 px-4 py-3">
        {open ? (
          <RecordForm staff={staff} />
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={`${secondary} w-full`}>
            Record cash received from staff
          </button>
        )}
      </div>
    </section>
  );
}

function RecordForm({ staff }: { staff: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const [who, setWho] = useState(staff[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    const { error: err } = await createClient().rpc("record_cash_handover", {
      p_staff_id: who,
      p_amount: Number(amount),
      p_method: method,
      p_note: note || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(`Recorded ${rupees(Number(amount))} from ${staff.find((s) => s.id === who)?.full_name ?? "them"}.`);
    setAmount("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">From</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className={input}>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Amount received (₹)</span>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          className={`${input} tabular-nums`}
        />
      </label>
      <MethodPicker value={method} onChange={setMethod} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={input} />
      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
      {done ? <p className="text-sm font-medium text-ok-700">{done}</p> : null}
      <button type="button" disabled={busy || !who || !Number(amount)} onClick={() => void save()} className={primary}>
        {busy ? "Saving…" : "Record as received"}
      </button>
    </div>
  );
}
