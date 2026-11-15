"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Shares the supervisor's position with the office, about once a minute,
 * while the app is open and the supervisor is on duty.
 *
 * The server decides "on duty" (between today's check-in and check-out) and
 * simply ignores reports outside it, so this never sends anything off the
 * clock. The chip appears only while reports are actually being kept, so the
 * supervisor always knows when they are visible.
 *
 * A web app cannot run while closed or locked; that is a phone rule, not a
 * setting. The office map shows how old each position is.
 */
const EVERY_MS = 60_000;

export function LocationSharer() {
  const [state, setState] = useState<"off" | "sharing" | "blocked">("off");
  const last = useRef(0);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const supabase = createClient();
    let alive = true;

    async function send(pos: GeolocationPosition) {
      if (Date.now() - last.current < EVERY_MS - 5_000) return;
      last.current = Date.now();
      const { data, error } = await supabase.rpc("report_location", {
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
        p_accuracy_m: Math.round(pos.coords.accuracy),
      });
      if (alive) setState(!error && data ? "sharing" : "off");
    }

    const watch = navigator.geolocation.watchPosition(
      (pos) => void send(pos),
      (err) => {
        if (alive && err.code === err.PERMISSION_DENIED) setState("blocked");
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );

    // watchPosition only fires on movement; standing still for a long job
    // still needs a "still here" now and then.
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition((pos) => void send(pos), () => {}, {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 20_000,
      });
    }, EVERY_MS);

    return () => {
      alive = false;
      navigator.geolocation.clearWatch(watch);
      clearInterval(tick);
    };
  }, []);

  if (state === "sharing") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok-50 px-1.5 py-0.5 text-[10px] font-semibold text-ok-700 ring-1 ring-ok-100">
        <span className="size-1.5 animate-pulse rounded-full bg-ok-600" aria-hidden />
        Sharing location
      </span>
    );
  }
  if (state === "blocked") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-warn-50 px-1.5 py-0.5 text-[10px] font-semibold text-warn-700 ring-1 ring-warn-100">
        Location off
      </span>
    );
  }
  return null;
}
