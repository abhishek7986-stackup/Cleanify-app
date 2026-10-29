"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseCoordinates } from "@/lib/location-link";

/**
 * One new worker's sign-up, for the admin to check and decide.
 *
 * Approving switches the account on and sets the depot the worker starts the
 * day from (their check-in deadline is measured from it), so a depot must be
 * chosen: one already used by other supervisors, or a pasted location.
 */

export type DepotOption = { label: string; lat: number; lng: number };
export type DocView = { kind: string; label: string; url: string | null; isPdf: boolean };

export function JoinRequestCard({
  id,
  fullName,
  phone,
  address,
  submittedLabel,
  docs,
  depots,
}: {
  id: string;
  fullName: string;
  phone: string;
  address: string;
  submittedLabel: string;
  docs: DocView[];
  depots: DepotOption[];
}) {
  const router = useRouter();
  const [depot, setDepot] = useState(depots.length ? "0" : "new");
  const [pasted, setPasted] = useState("");
  const [newDepotName, setNewDepotName] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  async function decide(approve: boolean) {
    setError(null);
    let lat: number | null = null;
    let lng: number | null = null;
    let label: string | null = null;
    if (approve) {
      if (depot === "new") {
        const p = parseCoordinates(pasted);
        if (!p) return setError("Paste the depot's Google Maps link or coordinates.");
        lat = p.lat;
        lng = p.lng;
        label = newDepotName.trim() || "Depot";
      } else {
        const d = depots[Number(depot)];
        lat = d.lat;
        lng = d.lng;
        label = d.label;
      }
    }
    setBusy(true);
    const { error: err } = await createClient().rpc("admin_review_staff_application", {
      p_application_id: id,
      p_approve: approve,
      p_reason: approve ? null : reason.trim(),
      p_depot_lat: lat,
      p_depot_lng: lng,
      p_depot_address: label,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(approve ? "approved" : "rejected");
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-2xl border-2 border-warn-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{fullName}</p>
          <p className="text-sm text-slate-600">
            {phone} · {submittedLabel}
          </p>
          <p className="mt-1 text-sm text-slate-500">{address}</p>
        </div>
        <span className="shrink-0 rounded-full bg-warn-100 px-2.5 py-1 text-xs font-semibold text-warn-700">new staff</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {docs.map((d) => (
          <figure key={d.kind} className="min-w-0">
            {d.url && !d.isPdf ? (
              <a href={d.url} target="_blank" rel="noreferrer" title="Open full size">
                {/* A ten-minute signed URL to a private file. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.url} alt={d.label} className="aspect-[4/3] w-full rounded-xl bg-slate-100 object-cover" />
              </a>
            ) : d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-brand-700"
              >
                Open PDF
              </a>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
                missing
              </div>
            )}
            <figcaption className="mt-1 text-xs font-medium text-slate-500">{d.label}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-slate-500">Tap a document to open it full size.</p>

      {done ? (
        <p className={`text-sm font-semibold ${done === "approved" ? "text-ok-700" : "text-danger-700"}`}>
          {done === "approved" ? "Approved. They can now sign in with their mobile number." : "Rejected."}
        </p>
      ) : rejecting ? (
        <div className="space-y-2">
          <textarea
            rows={2}
            autoFocus
            placeholder="Why? The applicant sees this."
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
              onClick={() => void decide(false)}
              className="tap flex-1 rounded-xl bg-danger-600 font-semibold text-white disabled:opacity-50"
            >
              Send rejection
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Starts the day from</span>
            <select
              className="tap w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base"
              value={depot}
              onChange={(e) => setDepot(e.target.value)}
            >
              {depots.map((d, i) => (
                <option key={i} value={String(i)}>
                  {d.label}
                </option>
              ))}
              <option value="new">Another place (paste a location)</option>
            </select>
          </label>
          {depot === "new" ? (
            <div className="grid gap-2">
              <input
                className="tap w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base"
                placeholder="Google Maps link or 17.4401, 78.3489"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <input
                className="tap w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base"
                placeholder="Name, e.g. Kakkanad depot"
                value={newDepotName}
                onChange={(e) => setNewDepotName(e.target.value)}
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => setRejecting(true)} className="tap flex-1 rounded-xl border-2 border-danger-500 font-semibold text-danger-600">
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="tap flex-[2] rounded-xl bg-brand-700 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Approve"}
            </button>
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-danger-600">{error}</p> : null}
    </section>
  );
}
