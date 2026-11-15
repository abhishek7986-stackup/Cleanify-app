"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** How many of a new worker's first working days are unpaid training. */
export function TrainingDaysForm({ initial }: { initial: number }) {
  const router = useRouter();
  const [days, setDays] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("set_training_days", { p_days: Number(days) });
    setBusy(false);
    if (err) return setError(err.message);
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="pt-5">
      <p className="section-label px-4 pb-2">Training days</p>
      <div className="sheet px-4 py-4">
        <p className="text-sm text-slate-600">
          A new worker&apos;s first working days are unpaid training (0%). Several jobs on one day count as one day. Their
          normal rate starts the day after. Supervisors are not affected.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <label className="block flex-1">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Unpaid training days</span>
            <input
              inputMode="numeric"
              value={days}
              onChange={(e) => {
                setSaved(false);
                setDays(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
              }}
              className="h-12 w-full rounded-lg border border-brand-950/15 bg-white px-3 text-base tabular-nums text-slate-900 outline-none focus:border-brand-950"
            />
          </label>
          <button
            type="button"
            disabled={busy || days === ""}
            onClick={() => void save()}
            className="h-12 rounded-lg bg-brand-950 px-5 text-[0.9375rem] font-semibold text-white active:bg-brand-900 disabled:opacity-40"
          >
            {busy ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
        {error ? <p className="mt-3 rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
      </div>
    </section>
  );
}
