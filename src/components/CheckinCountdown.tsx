"use client";

import { useEffect, useState } from "react";
import {
  countdownTo,
  formatIstTime,
  syncServerClock,
  type CountdownState,
} from "@/lib/domain/checkin-policy";

/**
 * The live countdown to the depot check-in.
 *
 * This runs against a SERVER-SYNCED clock, and it does not depend on a push
 * arriving. That matters more than it sounds: on iPhone, push is delivered
 * only to an installed PWA, so for some devices the notification genuinely
 * never comes. The countdown is the mechanism; push is the nudge.
 */
export function CheckinCountdown({
  deadline,
  submittedAt,
  tone = "card",
}: {
  deadline: string | null;
  submittedAt: string | null;
  /** "hero" sits on the coloured check-in card: white text, a big timer. */
  tone?: "card" | "hero";
}) {
  const [state, setState] = useState<CountdownState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void syncServerClock().then(() => alive && setReady(true));

    const tick = () => alive && setState(countdownTo(deadline));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [deadline]);

  const hero = tone === "hero";

  if (submittedAt) {
    return (
      <p className={`text-sm font-medium ${hero ? "text-white" : "text-ok-700"}`}>
        Checked in at {formatIstTime(submittedAt)}
      </p>
    );
  }

  if (!deadline) {
    return <p className={`text-sm ${hero ? "text-white/80" : "text-slate-500"}`}>No check-in required today.</p>;
  }

  if (!ready || !state) {
    // Same height as the timer, so nothing jumps when the clock arrives.
    return hero ? (
      <div aria-label="Checking the time" className="space-y-2 py-1">
        <div className="h-11 w-40 animate-pulse rounded-xl bg-white/20" />
        <div className="h-4 w-48 animate-pulse rounded bg-white/15" />
      </div>
    ) : (
      <div aria-label="Checking the time" className="space-y-2 rounded-xl bg-slate-100 p-3">
        <div className="h-7 w-28 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  if (hero) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/75">
          {state.late ? "Late by" : "Check in within"}
        </p>
        <p className="mt-0.5 text-[2.75rem] font-extrabold leading-none tracking-tight tabular-nums text-white">
          {state.label}
        </p>
        <p className={`mt-2 text-sm ${state.late ? "font-semibold text-white" : "text-white/85"}`}>
          {state.late
            ? `Was due at ${formatIstTime(deadline)}. Check in now.`
            : `Due at ${formatIstTime(deadline)}`}
        </p>
      </div>
    );
  }

  if (state.late) {
    return (
      <div className="rounded-xl bg-danger-50 p-3">
        <p className="text-lg font-bold text-danger-700">
          You&rsquo;re late by {state.label}
        </p>
        <p className="text-sm text-danger-600">
          Check-in was due at {formatIstTime(deadline)}. Check in now.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl p-3 ${state.urgent ? "bg-warn-50" : "bg-slate-100"}`}>
      <p
        className={`text-2xl font-bold tabular-nums ${
          state.urgent ? "text-warn-700" : "text-slate-900"
        }`}
      >
        {state.label}
      </p>
      <p className="text-sm text-slate-600">
        until check-in, due {formatIstTime(deadline)}
      </p>
    </div>
  );
}
