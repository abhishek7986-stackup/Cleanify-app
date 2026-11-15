"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Asks the server for real travel times on these supervisor-days in the
 * background, and refreshes the screen if any came back. Renders nothing.
 * Legs already answered are not asked again, so opening a page is cheap.
 */
export function TravelRefresh({ days }: { days: { supervisorId: string; date: string }[] }) {
  const router = useRouter();
  const key = days.map((d) => `${d.supervisorId}|${d.date}`).sort().join(",");
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!key || done.current === key) return;
    done.current = key;
    void (async () => {
      let any = false;
      for (const d of key.split(",")) {
        const [supervisorId, date] = d.split("|");
        const res = await fetch("/api/travel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supervisorId, date }),
        }).catch(() => null);
        const json = res?.ok ? ((await res.json()) as { filled?: number }) : null;
        if (json?.filled) any = true;
      }
      if (any) router.refresh();
    })();
  }, [key, router]);

  return null;
}

/** Fire-and-forget version for after booking or moving a job. */
export function requestTravel(supervisorId: string | null | undefined, date: string | null | undefined) {
  if (!supervisorId || !date) return;
  void fetch("/api/travel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supervisorId, date }),
    keepalive: true,
  }).catch(() => {});
}
