"use client";

import { useRouter } from "next/navigation";
import { formatIstDate } from "@/lib/domain/checkin-policy";

/** Prev / next / jump-to-date, all driven through the URL so the page stays shareable. */
export function DayPicker({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter();

  const shift = (days: number) => {
    const d = new Date(`${date}T00:00:00+05:30`);
    d.setDate(d.getDate() + days);
    router.push(`${basePath}?date=${d.toISOString().slice(0, 10)}`);
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => shift(-1)} aria-label="Previous day" className="tap rounded-xl border-2 border-slate-200 bg-white px-4 font-semibold text-slate-600">
        ‹
      </button>
      <div className="relative flex-1">
        <input
          type="date"
          value={date}
          onChange={(e) => router.push(`${basePath}?date=${e.target.value}`)}
          className="tap w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-center text-base"
          aria-label="Date"
        />
        <span className="pointer-events-none absolute inset-x-0 -bottom-5 text-center text-xs text-slate-400">
          {formatIstDate(`${date}T00:00:00+05:30`)}
        </span>
      </div>
      <button type="button" onClick={() => shift(1)} aria-label="Next day" className="tap rounded-xl border-2 border-slate-200 bg-white px-4 font-semibold text-slate-600">
        ›
      </button>
    </div>
  );
}
