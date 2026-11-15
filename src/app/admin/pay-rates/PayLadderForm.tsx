"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Tier = { from_earned: number; percent: number };
type Draft = { from: string; pct: string };

const DEFAULT: Record<"worker" | "supervisor", Draft[]> = {
  worker: [{ from: "0", pct: "14" }],
  supervisor: [{ from: "0", pct: "15" }],
};

/** One kind's ladder: rows of "from Rs X earned -> Y%", saved together. */
export function PayLadderForm({
  kind,
  title,
  initial,
}: {
  kind: "worker" | "supervisor";
  title: string;
  initial: Tier[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(
    initial.length ? initial.map((t) => ({ from: String(t.from_earned), pct: String(t.percent) })) : DEFAULT[kind],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (i: number, patch: Partial<Draft>) => {
    setSaved(false);
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("set_pay_tiers", {
      p_kind: kind,
      p_tiers: rows.map((r) => ({ from_earned: Number(r.from) || 0, percent: Number(r.pct) })),
    });
    setBusy(false);
    if (err) return setError(err.message);
    setSaved(true);
    router.refresh();
  }

  const input =
    "h-12 w-full rounded-lg border border-brand-950/15 bg-white px-3 text-base tabular-nums text-slate-900 outline-none focus:border-brand-950";

  return (
    <section className="pt-5">
      <p className="section-label px-4 pb-2">{title}</p>
      <div className="sheet px-4 py-4">
        {!initial.length ? (
          <p className="mb-3 text-sm text-amber-800">
            Not set yet: {title.toLowerCase()} still rise one point a month to their maximum. Save a ladder to use earnings
            milestones instead.
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_6.5rem_3rem] items-end gap-x-2 gap-y-3">
          <span className="text-xs font-medium text-slate-600">After earning (₹)</span>
          <span className="text-xs font-medium text-slate-600">Percentage</span>
          <span />
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <input
                inputMode="numeric"
                aria-label={`Milestone ${i + 1}, earnings in rupees`}
                value={r.from}
                disabled={i === 0}
                onChange={(e) => set(i, { from: e.target.value.replace(/[^\d]/g, "") })}
                className={`${input} disabled:bg-slate-50 disabled:text-slate-600`}
              />
              <div className="relative">
                <input
                  inputMode="decimal"
                  aria-label={`Milestone ${i + 1}, percentage`}
                  value={r.pct}
                  onChange={(e) => set(i, { pct: e.target.value.replace(/[^\d.]/g, "") })}
                  className={`${input} pr-7`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
              </div>
              {i === 0 ? (
                <span />
              ) : (
                <button
                  type="button"
                  aria-label={`Remove milestone ${i + 1}`}
                  onClick={() => {
                    setSaved(false);
                    setRows((rs) => rs.filter((_, j) => j !== i));
                  }}
                  className="flex size-12 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            const last = rows[rows.length - 1];
            setRows((rs) => [...rs, { from: String((Number(last?.from) || 0) + 20000), pct: String((Number(last?.pct) || 14) + 1) }]);
          }}
          className="mt-3 flex h-12 items-center gap-2 text-[0.9375rem] font-semibold text-brand-950"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a raise
        </button>
        <p className="mt-1 text-sm text-slate-600">
          {rows
            .map((r, i) =>
              i === 0
                ? `Starts at ${r.pct || "?"}%`
                : `${r.pct || "?"}% after ₹${Number(r.from || 0).toLocaleString("en-IN")} earned`,
            )
            .join(", then ")}
          .
        </p>
        {error ? <p className="mt-3 rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="mt-4 h-12 w-full rounded-lg bg-brand-950 text-[0.9375rem] font-semibold text-white active:bg-brand-900 disabled:opacity-40"
        >
          {busy ? "Saving…" : saved ? "Saved" : `Save ${title.toLowerCase()} rates`}
        </button>
      </div>
    </section>
  );
}
