"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PhotoKind } from "@/lib/domain/database";
import { LiveCameraCapture } from "@/components/LiveCameraCapture";
import { CheckinCountdown } from "@/components/CheckinCountdown";
import { getBestFix } from "@/lib/geolocation";
import { flushUploadQueue, listQueue } from "@/lib/upload-queue";
import { formatIstTime } from "@/lib/domain/checkin-policy";

/**
 * ============================================================================
 * Start and end of the supervisor's day
 * ============================================================================
 *
 * The same three things, morning and evening: a selfie, a photo of the
 * scooter's odometer, and the km reading typed in. The two readings give the
 * day's distance.
 *
 *   check-in   late is never refused, only marked LATE; jobs unlock once a
 *              sales rep or admin approves the photos
 *   check-out  any time, ideally after the last job; nobody approves it, and
 *              open jobs are allowed (recorded, not blocked)
 *
 * The photo pipeline (capture token, upload, offline queue) lives in
 * LiveCameraCapture. This screen only sequences it and submits.
 */

type Shot = "none" | "uploaded" | "queued";
type Mode = "checkin" | "checkout";
type PhotoStep = { kind: PhotoKind; title: string; hint: string; facing: "user" | "environment" };

const STEPS: Record<Mode, PhotoStep[]> = {
  checkin: [
    { kind: "PPE_SELFIE", title: "Selfie", hint: "In uniform, face inside the outline", facing: "user" },
    { kind: "ODOMETER", title: "Scooter km reading", hint: "The odometer, numbers clearly visible", facing: "environment" },
  ],
  checkout: [
    { kind: "CHECKOUT_SELFIE", title: "Selfie", hint: "Face inside the outline", facing: "user" },
    { kind: "CHECKOUT_ODOMETER", title: "Scooter km reading", hint: "The odometer, numbers clearly visible", facing: "environment" },
  ],
};

export function DayPhotosFlow({
  mode,
  rosterId,
  rosterDate,
  deadline = null,
  retake = false,
  rejectionReason = null,
  alreadyHave,
  startKm = null,
  openJobs = 0,
}: {
  mode: Mode;
  rosterId: string;
  rosterDate: string;
  /** Check-in only: the deadline, for the countdown. */
  deadline?: string | null;
  /** Check-in only: a sales rep rejected the last photos. */
  retake?: boolean;
  rejectionReason?: string | null;
  /** Photo kinds already on the server that still count. */
  alreadyHave: PhotoKind[];
  /** Check-out only: this morning's reading, to show km driven. */
  startKm?: number | null;
  /** Check-out only: jobs today that are not finished. */
  openJobs?: number;
}) {
  const steps = STEPS[mode];
  const [shots, setShots] = useState<Record<string, Shot>>(() =>
    Object.fromEntries(steps.map((p) => [p.kind, alreadyHave.includes(p.kind) ? "uploaded" : "none"])),
  );
  const [km, setKm] = useState("");
  const [camera, setCamera] = useState<PhotoStep | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ at: string; late?: boolean; kmToday?: number | null } | null>(null);

  const kmValue = km.trim() === "" ? null : Number(km);
  const kmValid = kmValue !== null && Number.isFinite(kmValue) && kmValue >= 0;
  // A rejected check-in keeps this morning's reading; only the photos are redone.
  const kmNeeded = !(mode === "checkin" && retake);
  const photosReady = steps.every((p) => shots[p.kind] !== "none");
  const ready = photosReady && (!kmNeeded || kmValid);
  const verb = mode === "checkin" ? "Check in" : "Check out";

  async function submit() {
    setError(null);

    if (mode === "checkout" && kmValue !== null && startKm !== null && kmValue < startKm) {
      setError(`That is lower than this morning's reading (${startKm} km). Check the number.`);
      return;
    }

    // Photos taken with no signal are still in the phone's queue; the server
    // will not accept the step until it has both, so push them first.
    if (Object.values(shots).includes("queued")) {
      setSubmitting("Uploading photos…");
      await flushUploadQueue();
      const left = (await listQueue()).filter((q) => q.rosterId === rosterId);
      if (left.length) {
        setSubmitting(null);
        setError(`Your photos are saved but not uploaded yet. Move to where there is signal and tap ${verb} again.`);
        return;
      }
    }

    setSubmitting("Getting your location…");
    const fix = await getBestFix({ timeoutMs: 10_000 });
    setSubmitting(mode === "checkin" ? "Checking in…" : "Checking out…");

    const supabase = createClient();
    const common = {
      p_roster_date: rosterDate,
      p_lat: fix?.lat ?? null,
      p_lng: fix?.lng ?? null,
      p_accuracy_m: fix?.accuracyM ?? null,
      p_client_clock: new Date().toISOString(),
    };
    const { data, error: err } =
      mode === "checkin"
        ? await supabase.rpc("submit_checkin", {
            ...common,
            p_user_agent: navigator.userAgent,
            p_odometer_km: kmValue,
          })
        : await supabase.rpc("submit_checkout", { ...common, p_odometer_km: kmValue ?? 0 });
    setSubmitting(null);

    if (err) {
      setError(err.message);
      return;
    }
    const r = data as {
      submitted_at: string;
      checked_out_at: string | null;
      checkin_status: string | null;
      start_odometer_km: string | null;
      end_odometer_km: string | null;
    };
    setDone(
      mode === "checkin"
        ? { at: r.submitted_at, late: r.checkin_status === "LATE" }
        : {
            at: r.checked_out_at ?? new Date().toISOString(),
            kmToday:
              r.start_odometer_km != null && r.end_odometer_km != null
                ? Number(r.end_odometer_km) - Number(r.start_odometer_km)
                : null,
          },
    );
  }

  /* ---------------------------------------------------------------- done */
  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-ok-100 bg-ok-50 p-5">
          {mode === "checkin" ? (
            <>
              <p className="text-lg font-semibold text-ok-700">
                {retake ? "New photos sent" : "Photos sent for approval"}
              </p>
              <p className="mt-1 text-ok-700">
                {retake ? "" : `Checked in at ${formatIstTime(done.at)}${done.late ? " (late)" : ""}. `}
                Your jobs unlock as soon as the photos are approved.
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-ok-700">Checked out. Have a good evening.</p>
              <p className="mt-1 text-ok-700">
                {formatIstTime(done.at)}
                {done.kmToday != null ? ` · ${done.kmToday} km today` : ""}
              </p>
            </>
          )}
        </div>
        <a
          href="/s"
          className="tap-lg flex items-center justify-center rounded-2xl bg-brand-700 font-semibold text-white"
        >
          {mode === "checkin" ? "See today's jobs" : "Back to today"}
        </a>
      </div>
    );
  }

  /* ---------------------------------------------------------------- form */
  return (
    <div className="space-y-4">
      {mode === "checkin" ? (
        retake ? (
          <div className="rounded-2xl bg-danger-50 p-4 text-sm text-danger-700">
            <p className="font-semibold">Your check-in photos were rejected</p>
            {rejectionReason ? <p className="mt-1">{rejectionReason}</p> : null}
            <p className="mt-1">Take both photos again and send them.</p>
          </div>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <CheckinCountdown deadline={deadline} submittedAt={null} />
          </section>
        )
      ) : openJobs > 0 ? (
        <div className="rounded-2xl bg-warn-50 p-4 text-sm text-warn-700">
          <p className="font-semibold">
            {openJobs} job{openJobs === 1 ? " is" : "s are"} not finished yet
          </p>
          <p className="mt-1">You can still check out. The office will see that it was left open.</p>
        </div>
      ) : (
        <p className="rounded-2xl bg-ok-50 p-4 text-sm font-medium text-ok-700">
          All of today&apos;s jobs are done. Check out to finish your day.
        </p>
      )}

      <ol className="space-y-3">
        {steps.map((p, i) => {
          const state = shots[p.kind];
          return (
            <li key={p.kind} className="flex items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  state === "none" ? "bg-slate-100 text-slate-500" : "bg-ok-600 text-white"
                }`}
                aria-hidden
              >
                {state === "none" ? i + 1 : "✓"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{p.title}</p>
                <p className="text-sm text-slate-500">
                  {state === "uploaded"
                    ? "Photo saved"
                    : state === "queued"
                      ? "Saved on this phone, will upload when there is signal"
                      : p.hint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCamera(p)}
                className={`tap shrink-0 rounded-xl px-4 text-sm font-semibold ${
                  state === "none" ? "bg-brand-700 text-white" : "border-2 border-slate-200 text-slate-600"
                }`}
              >
                {state === "none" ? "Take photo" : "Retake"}
              </button>
            </li>
          );
        })}
      </ol>

      {kmNeeded ? (
        <label className="block rounded-2xl border-2 border-slate-200 bg-white p-4">
          <span className="mb-1.5 block font-semibold text-slate-900">
            Km reading <span className="text-danger-600">*</span>
          </span>
          <span className="mb-2 block text-sm text-slate-500">
            Type the number shown on the scooter
            {mode === "checkout" && startKm != null ? ` (this morning: ${startKm} km)` : ""}.
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            placeholder="e.g. 12450"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            className="tap w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-lg tabular-nums outline-none focus:border-brand-600"
          />
          {mode === "checkout" && startKm != null && kmValid && kmValue! >= startKm ? (
            <span className="mt-1.5 block text-sm font-medium text-brand-700">
              {Math.round((kmValue! - startKm) * 10) / 10} km today
            </span>
          ) : null}
        </label>
      ) : null}

      {error ? <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!ready || submitting !== null}
        className="tap-lg w-full rounded-2xl bg-brand-700 font-semibold text-white disabled:opacity-40"
      >
        {submitting ?? (retake ? "Send new photos" : verb)}
      </button>
      {!ready ? (
        <p className="text-center text-sm text-slate-500">
          {!photosReady ? "Take both photos" : "Type the km reading"} to {verb.toLowerCase()}.
        </p>
      ) : null}

      {camera ? (
        <LiveCameraCapture
          kind={camera.kind}
          rosterId={rosterId}
          facing={camera.facing}
          title={camera.title}
          hint={camera.hint}
          onCancel={() => setCamera(null)}
          onCaptured={({ queued }) => {
            setShots((s) => ({ ...s, [camera.kind]: queued ? "queued" : "uploaded" }));
            setCamera(null);
          }}
        />
      ) : null}
    </div>
  );
}
