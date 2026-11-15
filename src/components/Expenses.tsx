"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rupees } from "@/lib/domain/payments";
import { compressImage as compress } from "@/lib/compress-image";

export type Category = "fuel" | "chemicals" | "tools" | "food" | "travel" | "other";
export const CATEGORY_LABEL: Record<Category, string> = {
  fuel: "Fuel",
  chemicals: "Chemicals",
  tools: "Tools",
  food: "Food",
  travel: "Travel",
  other: "Other",
};

export type ExpenseRow = {
  id: string;
  staff_name?: string;
  spent_on: string;
  category: Category;
  amount: number;
  paid_from: "customer_cash" | "own_money";
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reject_reason: string | null;
  bill_url: string | null;
};

const input =
  "h-12 w-full rounded-lg border border-brand-950/15 bg-white px-3 text-base text-slate-900 outline-none focus:border-brand-950";
const primary =
  "flex h-12 w-full items-center justify-center rounded-lg bg-brand-950 text-[0.9375rem] font-semibold text-white active:bg-brand-900 disabled:bg-slate-200 disabled:text-slate-500";
const secondary =
  "flex h-12 items-center justify-center rounded-lg border border-brand-950/15 px-4 text-[0.9375rem] font-semibold text-brand-950 active:bg-brand-50 disabled:opacity-40";

function dayLabel(iso: string) {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/* -------------------------------------------------------------- supervisor */

/** "Add expense": amount, what for, whose money, the bill photo, a note. */
export function AddExpense() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("fuel");
  const [paidFrom, setPaidFrom] = useState<"customer_cash" | "own_money">("customer_cash");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${secondary} w-full`}>
        Add an expense with the bill
      </button>
    );
  }

  async function save() {
    if (!photo) return setError("Take a photo of the bill");
    setError(null);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in again");
    try {
      setBusy("Uploading the bill…");
      const blob = await compress(photo);
      const path = `${auth.user.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("expense-bills").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw new Error(up.error.message);
      setBusy("Saving…");
      const { error: err } = await supabase.rpc("add_expense", {
        p_amount: Number(amount),
        p_category: category,
        p_paid_from: paidFrom,
        p_bill_path: path,
        p_note: note || null,
      });
      if (err) throw new Error(err.message);
      setOpen(false);
      setAmount("");
      setNote("");
      setPhoto(null);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Amount spent (₹)</span>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className={`${input} tabular-nums`} />
      </label>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">What for</span>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`h-11 rounded-lg text-sm font-semibold ${
                category === c ? "bg-brand-950 text-white" : "border border-brand-950/15 text-slate-700"
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Paid with</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900/[0.05] p-1">
          {(
            [
              ["customer_cash", "Customers' cash"],
              ["own_money", "My own money"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={paidFrom === v}
              onClick={() => setPaidFrom(v)}
              className={`h-10 rounded-md text-sm font-semibold ${
                paidFrom === v ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(11_53_50/0.12)]" : "text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-slate-600">
          {paidFrom === "customer_cash"
            ? "Once approved, it comes off the cash in your hand."
            : "Once approved, the office pays it back to you on Monday."}
        </p>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Photo of the bill</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setPhoto(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
        {preview ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="block w-full overflow-hidden rounded-lg border border-brand-950/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Bill photo" className="max-h-56 w-full object-contain bg-slate-50" />
            <span className="block py-2 text-sm font-medium text-brand-950">Retake photo</span>
          </button>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} className={`${secondary} w-full border-dashed`}>
            Take photo of the bill
          </button>
        )}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. petrol for Kondapur job" className={input} />
      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className={secondary}>
          Cancel
        </button>
        <button type="button" disabled={busy !== null || !Number(amount) || !photo} onClick={() => void save()} className={primary}>
          {busy ?? `Send ${amount ? rupees(Number(amount)) : ""} for approval`}
        </button>
      </div>
    </div>
  );
}

/** A supervisor's own recent expenses with their status. */
export function MyExpenses({ rows }: { rows: ExpenseRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-brand-950/[0.07]">
      {rows.map((x) => (
        <li key={x.id} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`size-2 shrink-0 rounded-full ${
                x.status === "APPROVED" ? "bg-ok-600" : x.status === "REJECTED" ? "bg-danger-600" : "animate-pulse bg-amber-500"
              }`}
              aria-hidden
            />
            <span className="truncate text-slate-700">
              {CATEGORY_LABEL[x.category]} · {dayLabel(x.spent_on)} ·{" "}
              {x.status === "APPROVED" ? "approved" : x.status === "REJECTED" ? `rejected: ${x.reject_reason}` : "waiting"}
            </span>
          </span>
          <span className={`shrink-0 font-semibold tabular-nums ${x.status === "REJECTED" ? "text-slate-500 line-through" : "text-slate-900"}`}>
            {rupees(x.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ office */

/** Expenses waiting for the office, each with its bill photo. */
export function ReviewExpenses({ rows }: { rows: ExpenseRow[] }) {
  if (!rows.length) return null;
  return (
    <section>
      <p className="section-label pb-2 text-amber-800">Expenses to approve</p>
      <ul className="sheet -mx-4 divide-y divide-brand-950/[0.07]">
        {rows.map((x) => (
          <li key={x.id} className="px-4 py-3">
            <ReviewRow x={x} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ x }: { x: ExpenseRow }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("review_expense", { p_id: x.id, p_approve: approve, p_reason: approve ? null : reason });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-semibold text-slate-900">
          {x.staff_name} · {CATEGORY_LABEL[x.category]}
        </p>
        <p className="shrink-0 font-semibold tabular-nums text-slate-950">{rupees(x.amount)}</p>
      </div>
      <p className="text-sm text-slate-600">
        {dayLabel(x.spent_on)} · {x.paid_from === "customer_cash" ? "paid from customers' cash" : "paid from own money"}
        {x.note ? ` · “${x.note}”` : ""}
      </p>
      {x.bill_url ? (
        <a href={x.bill_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-brand-950/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={x.bill_url} alt={`Bill for ${rupees(x.amount)}`} className="max-h-60 w-full bg-slate-50 object-contain" />
        </a>
      ) : (
        <p className="text-sm text-danger-700">Bill photo not found</p>
      )}
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
            Reject
          </button>
          <button type="button" disabled={busy} onClick={() => void review(true)} className={primary}>
            {busy ? "Saving…" : `Approve ${rupees(x.amount)}`}
          </button>
        </div>
      )}
      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
    </div>
  );
}
