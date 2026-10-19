"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { DayRoster, PhotoKind } from "@/lib/domain/database";

type PhotoView = {
  id: string;
  kind: PhotoKind;
  url: string | null;
  flagged: boolean;
  flagReason: string | null;
};

const KIND_LABEL: Partial<Record<PhotoKind, string>> = {
  EQUIPMENT: "Machinery",
  PPE_SELFIE: "Selfie",
  ODOMETER: "Scooter km",
};

export function ApprovalCard({
  roster,
  supervisorName,
  submittedLabel,
  photos,
}: {
  roster: DayRoster;
  supervisorName: string;
  submittedLabel: string;
  photos: PhotoView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("review_roster", {
      p_roster_id: roster.id,
      p_approve: approve,
      p_reason: approve ? null : reason,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setRejecting(false);
    router.refresh();
  }

  const decided = roster.approval_status !== "PENDING";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{supervisorName}</p>
          <p className="text-sm text-slate-500">{submittedLabel}</p>
        </div>
        <StatusBadge status={roster.approval_status} lateness={roster.checkin_status} />
      </div>

      {roster.start_odometer_km != null ? (
        <p className="mt-2 text-sm text-slate-700">
          Km reading typed: <b className="tabular-nums">{Number(roster.start_odometer_km)} km</b>
          <span className="text-slate-400"> (check it against the photo)</span>
        </p>
      ) : null}

      {/* Anything the system found odd. Flags inform the human decision; they
          never block the supervisor in the field. */}
      {roster.flags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {roster.flags.map((f) => (
            <span key={f} className="rounded-full bg-warn-100 px-2 py-0.5 text-xs font-medium text-warn-700">
              {f.replace(/_/g, " ")}
            </span>
          ))}
          {roster.distance_from_expected_m ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {Math.round(Number(roster.distance_from_expected_m))} m from depot
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {photos.map((p) => (
          <figure key={p.id}>
            {p.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.url}
                alt={KIND_LABEL[p.kind] ?? p.kind}
                className="aspect-[3/4] w-full rounded-xl object-cover"
              />
            ) : (
              <div className="flex aspect-[3/4] items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
                no image
              </div>
            )}
            <figcaption className="mt-1 text-xs text-slate-500">
              {KIND_LABEL[p.kind] ?? p.kind}
              {p.flagged ? (
                <span className="ml-1 font-semibold text-warn-700">· {p.flagReason}</span>
              ) : null}
            </figcaption>
          </figure>
        ))}
        {photos.length === 0 ? (
          <p className="col-span-2 text-sm text-slate-500">No photos on this check-in.</p>
        ) : null}
      </div>

      {roster.rejection_reason ? (
        <p className="mt-3 rounded-xl bg-danger-50 p-3 text-sm text-danger-700">
          Rejected: {roster.rejection_reason}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}

      {!decided ? (
        rejecting ? (
          <div className="mt-3 space-y-2">
            <textarea
              rows={2}
              autoFocus
              placeholder="What is wrong with these photos?"
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
              {busy ? "…" : "Approve"}
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}

function StatusBadge({ status, lateness }: { status: string; lateness: string | null }) {
  const tones: Record<string, string> = {
    PENDING: "bg-warn-100 text-warn-700",
    APPROVED: "bg-ok-100 text-ok-700",
    REJECTED: "bg-danger-100 text-danger-700",
  };
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[status]}`}>
        {status.toLowerCase()}
      </span>
      {lateness === "LATE" ? (
        <span className="rounded-full bg-danger-100 px-2 py-0.5 text-xs font-semibold text-danger-700">
          late
        </span>
      ) : null}
    </div>
  );
}
