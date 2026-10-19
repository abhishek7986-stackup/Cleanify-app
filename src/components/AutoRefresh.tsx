"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the page's server data every few seconds while it is on screen.
 *
 * Used wherever someone is waiting on someone else: a supervisor waiting for
 * an approval, an approver waiting for photos. Polling while visible is all
 * this needs; Realtime would be more moving parts for the same result.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, seconds * 1000);
    // Coming back to the app should show the latest straight away.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);

  return null;
}
