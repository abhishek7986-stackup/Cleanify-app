"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PayStaff } from "@/lib/domain/database";

/** With `staff`, edits that person. Without it, adds a new worker. */
export function StaffForm({ staff, today }: { staff?: PayStaff; today: string }) {
  const router = useRouter();
  const isWorker = !staff || staff.kind === "worker";
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(staff?.full_name ?? "");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [joined, setJoined] = useState(staff?.joined_on ?? today);
  const [start, setStart] = useState(String(staff?.start_percent != null ? Number(staff.start_percent) : 14));
  const [fixed, setFixed] = useState(staff?.fixed_percent != null ? String(Number(staff.fixed_percent)) : "");
  const [active, setActive] = useState(staff?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("upsert_pay_staff", {
      p_id: staff?.id ?? null,
      p_full_name: name,
      p_phone: phone,
      p_joined_on: joined,
      p_start_percent: Number(start),
      p_fixed_percent: fixed.trim() === "" ? null : Number(fixed),
      p_is_active: active,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setOpen(false);
    if (!staff) {
      setName("");
      setPhone("");
      setJoined(today);
      setStart("14");
      setFixed("");
    }
    router.refresh();
  }

  if (!open) {
    return staff ? (
      <button type="button" onClick={() => setOpen(true)} className="tap mt-1 text-sm font-semibold text-brand-700">
        Change
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap w-full rounded-2xl border-2 border-brand-600 font-semibold text-brand-700"
      >
        Add a worker
      </button>
    );
  }

  const input = "tap mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-brand-600";

  return (
    <div className={`space-y-3 ${staff ? "mt-3 border-t border-slate-100 pt-3" : "rounded-2xl border border-slate-200 bg-white p-4"}`}>
      {!staff ? <h2 className="font-semibold text-slate-900">New worker</h2> : null}
      {isWorker ? (
        <>
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Mobile <span className="font-normal text-slate-400">(optional)</span>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
          </label>
        </>
      ) : null}
      <label className="block text-sm font-medium text-slate-700">
        Joining date
        <input type="date" value={joined} onChange={(e) => setJoined(e.target.value)} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-slate-700">
          Start %
          <input type="number" inputMode="decimal" min="0" max="100" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Fixed % <span className="font-normal text-slate-400">(optional)</span>
          <input type="number" inputMode="decimal" min="0" max="100" value={fixed} onChange={(e) => setFixed(e.target.value)} className={input} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Fill in Fixed % only to stop the monthly rise and use that figure instead.</p>
      {staff && isWorker ? (
        <label className="tap flex items-center gap-3 text-sm font-medium text-slate-700">
          <input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Still working with us
        </label>
      ) : null}
      {error ? <p className="rounded-xl bg-danger-50 p-2 text-sm text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="tap flex-1 rounded-xl border-2 border-slate-200 font-semibold text-slate-600">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className="tap flex-1 rounded-xl bg-brand-700 font-semibold text-white disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
