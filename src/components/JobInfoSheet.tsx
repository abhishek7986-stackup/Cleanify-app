"use client";

import { useEffect, useState } from "react";

export type JobInfo = {
  service: string | null;
  total: number | null;
  sharePercent: number | null;
  unitsLabel: string;
  units: { label: string; facts: string[] }[];
  facts: { label: string; value: string }[];
  /** Workers on the supervisor's team and their current rate. */
  team: { name: string; percent: number; training: boolean }[];
};

const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;

/**
 * The (i) button on the current stop: the job's size and money in a bottom
 * sheet. Only the current job has it; later jobs stay plain until it is their turn.
 */
export function JobInfoSheet({ info, title }: { info: JobInfo; title: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const share = info.total != null && info.sharePercent != null ? Math.round((info.total * info.sharePercent) / 100) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Job details"
        className="flex size-12 shrink-0 items-center justify-center rounded-full text-brand-950 active:bg-brand-50"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7.5v.5" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={`${title} details`}>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/40" />
          <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-3 shadow-[0_-8px_24px_rgb(11_53_50/0.18)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-600">{info.service ?? "Job"}</p>
                <p className="text-lg font-semibold text-slate-950">{title}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-2 flex size-12 shrink-0 items-center justify-center rounded-full text-slate-500 active:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-brand-950/10">
              <div className="bg-white p-3">
                <dt className="text-xs font-medium text-slate-600">Job total</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-950">{info.total != null ? inr(info.total) : "—"}</dd>
              </div>
              <div className="bg-white p-3">
                <dt className="text-xs font-medium text-slate-600">
                  Your share{info.sharePercent != null ? ` · ${info.sharePercent}%` : ""}
                </dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ok-700">{share != null ? inr(share) : "—"}</dd>
              </div>
            </dl>

            {info.team.length ? (
              <>
                <p className="section-label pb-1 pt-4">Workers&apos; share, if they work this job</p>
                <ul className="divide-y divide-brand-950/[0.07]">
                  {info.team.map((w) => (
                    <li key={w.name} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">{w.name}</span>
                        <span className="block text-sm text-slate-600">{w.training ? "In training · 0%" : `${w.percent}%`}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                        {info.total != null ? inr(Math.round((info.total * w.percent) / 100)) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {info.units.length ? (
              <>
                <p className="section-label pb-1 pt-4">
                  {info.units.length} {info.unitsLabel}
                </p>
                <ul className="divide-y divide-brand-950/[0.07]">
                  {info.units.map((u) => (
                    <li key={u.label} className="py-2.5">
                      <p className="font-semibold text-slate-900">{u.label}</p>
                      {u.facts.length ? <p className="text-sm text-slate-600">{u.facts.join(" · ")}</p> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {info.facts.length ? (
              <dl className="mt-2 divide-y divide-brand-950/[0.07] border-t border-brand-950/[0.07] text-[0.9375rem]">
                {info.facts.map((f) => (
                  <div key={f.label} className="flex justify-between gap-3 py-2.5">
                    <dt className="text-slate-600">{f.label}</dt>
                    <dd className="text-right font-medium text-slate-900">{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">
              Shares are worked out on the amount actually collected, for the people ticked on the job at payment.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
