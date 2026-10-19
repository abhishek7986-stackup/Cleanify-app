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
}: {
  deadline: string | null;
  submittedAt: string | null;
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

  if (submittedAt) {
    return (
      <p className="text-sm font-medium text-ok-700">
        Checked in at {formatIstTime(submittedAt)}
      </p>
    );
  }

  if (!deadline) {
    return <p className="text-sm text-slate-500">No check-in required today.</p>;
  }

  if (!ready || !state) {
    return <p className="text-sm text-slate-500">Checking the time…</p>;
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
