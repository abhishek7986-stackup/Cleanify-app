"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Before or after photos from a job site, waiting for a decision.
 *
 * Before photos come with the tank details the supervisor confirmed on site.
 * After photos are shown next to the before photo of the same tank, and
 * approving them closes the job. Sales or admin can decide either.
 */

export type SiteUnitView = {
  id: string;
  label: string;
  photoUrl: string | null;
  /** For after photos: the same tank's before photo, shown alongside. */
  beforeUrl?: string | null;
  details: { label: string; value: string }[];
};

export function SiteReviewCard({
  jobId,
  jobNumber,
  stage,
  clientName,
  serviceName,
  supervisorName,
  sentLabel,
  arrivedDistanceM,
  note,
  units,
}: {
  jobId: string;
  jobNumber: string;
  stage: "before" | "after";
  clientName: string;
  serviceName: string;
  supervisorName: string;
  sentLabel: string;
  arrivedDistanceM: number | null;
  note: string | null;
  units: SiteUnitView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("review_site_photos", {
      p_job_id: jobId,
      p_stage: stage,
      p_approve: approve,
      p_reason: approve ? null : reason.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(approve ? "approved" : "rejected");
    router.refresh();
  }

  return (
    <section className="rounded-2xl border-2 border-warn-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {clientName} <span className="font-normal text-slate-400">· {jobNumber}</span>
          </p>
          <p className="text-sm text-slate-500">
            {serviceName} · {supervisorName} · {sentLabel}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            stage === "before" ? "bg-brand-100 text-brand-800" : "bg-warn-100 text-warn-700"
          }`}
        >
          {stage === "before" ? "before" : "after · finish"}
        </span>
      </div>

      {arrivedDistanceM != null ? (
        <p
          className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            arrivedDistanceM > 500 ? "bg-warn-100 text-warn-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          Marked reached {arrivedDistanceM < 1000 ? `${Math.round(arrivedDistanceM)} m` : `${(arrivedDistanceM / 1000).toFixed(1)} km`} from the booked pin
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {units.map((u) =>
          stage === "after" ? (
            <div key={u.id}>
              <p className="mb-1 text-sm font-semibold text-slate-800">{u.label}</p>
              <div className="grid grid-cols-2 gap-2">
                <Photo url={u.beforeUrl ?? null} caption="Before" />
                <Photo url={u.photoUrl} caption="After" />
              </div>
            </div>
          ) : (
            <div key={u.id} className="flex gap-3">
              <div className="w-28 shrink-0">
                <Photo url={u.photoUrl} caption="Before" />
              </div>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-slate-800">{u.label}</p>
                {u.details.map((d) => (
                  <p key={d.label} className="text-slate-600">
                    <span className="text-slate-400">{d.label}:</span> {d.value}
                  </p>
                ))}
              </div>
            </div>
          ),
        )}
      </div>

      {note ? (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <span className="font-semibold">Work done:</span> {note}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}

      {done ? (
        <p className={`mt-3 text-sm font-semibold ${done === "approved" ? "text-ok-700" : "text-danger-700"}`}>
          {done === "approved" ? "Approved" : "Rejected"}
        </p>
      ) : rejecting ? (
        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            autoFocus
            placeholder="What needs fixing?"
            className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-base outline-none focus:border-brand-600"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setRejecting(false)} className="tap flex-1 rounded-xl border-2 border-slate-300 font-semibold">
              Back
            </button>
            <button
              type="button"
              disabled={busy || reason.trim().length < 3}
              onClick={() => review(false)}
              className="tap flex-1 rounded-xl bg-danger-600 font-semibold text-white disabled:opacity-50"
            >
              Send rejection
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setRejecting(true)} className="tap flex-1 rounded-xl border-2 border-danger-500 font-semibold text-danger-600">
            Reject
          </button>
          <button type="button" disabled={busy} onClick={() => review(true)} className="tap flex-[2] rounded-xl bg-brand-700 font-semibold text-white disabled:opacity-50">
            {busy ? "…" : stage === "before" ? "Approve, start cleaning" : "Approve and close job"}
          </button>
        </div>
      )}
    </section>
  );
}

function Photo({ url, caption }: { url: string | null; caption: string }) {
  return (
    <figure>
      {url ? (
        // A short-lived signed URL; next/image would only re-host it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={caption} loading="lazy" className="aspect-[3/4] w-full rounded-xl object-cover" />
      ) : (
        <div className="flex aspect-[3/4] w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
          no image
        </div>
      )}
      <figcaption className="mt-1 text-xs font-medium text-slate-500">{caption}</figcaption>
    </figure>
  );
}
