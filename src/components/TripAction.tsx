"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getBestFix } from "@/lib/geolocation";
import type { JobStatus } from "@/lib/domain/database";

/**
 * The trip steps done right where the supervisor is, in one tap:
 *   Start trip        -> marks the job on the way, then opens Google Maps to the site
 *   I've reached      -> records arrival (with location), then opens the job for photos
 * The job screen's own bar runs the same steps, so whichever screen they are on,
 * one tap does the step; nothing asks twice.
 */
export function TripAction({
  jobId,
  status,
  mapsUrl,
  className,
}: {
  jobId: string;
  status: JobStatus;
  mapsUrl: string | null;
  className: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onTheWay = status === "EN_ROUTE";

  async function advance(path: JobStatus[], meta: Record<string, unknown> = {}) {
    const supabase = createClient();
    for (let i = 0; i < path.length; i++) {
      const { error: err } = await supabase.rpc("advance_job_status", {
        p_job_id: jobId,
        p_to: path[i],
        p_meta: i === path.length - 1 ? meta : {},
      });
      if (err) throw new Error(err.message);
    }
  }

  async function run() {
    setError(null);
    try {
      if (onTheWay) {
        setBusy("Getting your location…");
        const fix = await getBestFix({ timeoutMs: 8000, samples: 2 });
        setBusy("Marking reached…");
        await advance(["ON_SITE"], fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: Math.round(fix.accuracyM) } : {});
        router.push(`/s/jobs/${jobId}`);
      } else {
        setBusy("Starting trip…");
        await advance(status === "ASSIGNED" ? ["CHECKED_IN", "EN_ROUTE"] : ["EN_ROUTE"]);
        router.refresh();
        // Straight into turn-by-turn directions; back in the app, the step is "I've reached".
        if (mapsUrl) window.location.href = mapsUrl;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error ? <p className="mb-2 rounded-lg bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}
      <button type="button" disabled={busy !== null} onClick={() => void run()} className={className}>
        <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path
            d={
              onTheWay
                ? "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
                : "m3 11 18-8-8 18-2-8-8-2Z"
            }
          />
        </svg>
        {busy ?? (onTheWay ? "I've reached the site" : "Start trip")}
      </button>
    </div>
  );
}
