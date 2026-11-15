"use client";

import { useEffect, useRef, useState } from "react";
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
  odometerPhotoId = null,
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
  /** An odometer photo already taken (e.g. before a reload), to read on open. */
  odometerPhotoId?: string | null;
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
  // What the app read off the odometer photo. It pre-fills the km box; the
  // supervisor confirms or corrects, and the office sees both if they differ.
  const [reading, setReading] = useState<{ state: "reading" | "read" | "unread" | "offline"; km?: number } | null>(null);

  async function readOdometer(photoId: string) {
    // A retake replaces the number only if the supervisor never changed it.
    const previousRead = reading?.km != null ? String(reading.km) : null;
    setReading({ state: "reading" });
    try {
      const res = await fetch("/api/odometer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
      const json = (await res.json()) as { km?: number | null };
      if (res.ok && typeof json.km === "number") {
        setReading({ state: "read", km: json.km });
        setKm((cur) => (cur.trim() === "" || cur.trim() === previousRead ? String(json.km) : cur));
      } else {
        setReading({ state: "unread" });
      }
    } catch {
      setReading({ state: "unread" });
    }
  }

  // A km photo taken before this screen was reopened: read it straight away.
  const readOnOpen = useRef(false);
  useEffect(() => {
    if (!odometerPhotoId || readOnOpen.current) return;
    readOnOpen.current = true;
    void readOdometer(odometerPhotoId);
    // readOdometer is stable enough for a one-off read on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [odometerPhotoId]);

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
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-2 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-ok-600 text-white">
          <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
        {mode === "checkin" ? (
          <>
            <p className="mt-5 text-2xl font-semibold text-slate-900">{retake ? "New photos sent" : "You're checked in"}</p>
            <p className="mt-2 max-w-xs text-slate-600">
              {retake ? "" : `At ${formatIstTime(done.at)}${done.late ? " (late)" : ""}. `}
              Your jobs unlock as soon as the office approves the photos.
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 text-2xl font-semibold text-slate-900">Checked out</p>
            <p className="mt-2 text-slate-600">
              {formatIstTime(done.at)}
              {done.kmToday != null ? ` · ${done.kmToday} km today` : ""}. Have a good evening.
            </p>
          </>
        )}
        <a
          href="/s"
          className="tap-lg mt-8 flex w-full items-center justify-center rounded-lg bg-brand-950 active:bg-brand-900 text-base font-semibold text-white active:scale-[0.98]"
        >
          {mode === "checkin" ? "See today's jobs" : "Back to today"}
        </a>
      </div>
    );
  }

  const doneCount = steps.filter((p) => shots[p.kind] !== "none").length + (kmNeeded && kmValid ? 1 : 0);
  const totalCount = steps.length + (kmNeeded ? 1 : 0);

  /* ---------------------------------------------------------------- form */
  return (
    <div className="space-y-5 pb-28">
      {mode === "checkin" ? (
        retake ? (
          <div className="rounded-xl bg-danger-50 p-4 text-sm text-danger-700 ring-1 ring-danger-100">
            <p className="font-semibold">Your check-in photos were rejected</p>
            {rejectionReason ? <p className="mt-1">&ldquo;{rejectionReason}&rdquo;</p> : null}
            <p className="mt-1">Take both photos again and send them.</p>
          </div>
        ) : (
          <section className="-mx-4 -mt-4 bg-brand-950 px-4 pb-6 pt-1 text-white">
            <CheckinCountdown tone="hero" deadline={deadline} submittedAt={null} />
          </section>
        )
      ) : openJobs > 0 ? (
        <div className="rounded-xl bg-warn-50 p-4 text-sm text-warn-700 ring-1 ring-warn-100">
          <p className="font-semibold">
            {openJobs} job{openJobs === 1 ? " is" : "s are"} not finished yet
          </p>
          <p className="mt-1">You can still check out. The office will see that it was left open.</p>
        </div>
      ) : (
        <p className="rounded-xl bg-ok-50 p-4 text-sm font-semibold text-ok-700 ring-1 ring-ok-100">
          All of today&apos;s jobs are done. Check out to finish your day.
        </p>
      )}

      <div>
        <div className="mb-2.5 flex items-baseline justify-between px-1">
          <h2 className="text-lg font-semibold text-slate-900">Steps</h2>
          <span className="text-sm font-medium text-slate-500">
            {doneCount} of {totalCount} done
          </span>
        </div>
        <ol className="grid grid-cols-2 gap-3">
          {steps.map((p, i) => {
            const state = shots[p.kind];
            const taken = state !== "none";
            return (
              <li key={p.kind}>
                <button
                  type="button"
                  onClick={() => setCamera(p)}
                  className={`relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-xl p-3 text-center active:scale-[0.98] ${
                    taken
                      ? "bg-ok-50 ring-2 ring-ok-600"
                      : "border-2 border-dashed border-brand-600/50 bg-white"
                  }`}
                >
                  <span className="absolute left-3 top-3 text-xs font-semibold text-slate-500">{i + 1}</span>
                  <span
                    className={`flex size-14 items-center justify-center rounded-full ${
                      taken ? "bg-ok-600 text-white" : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {taken ? (
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      ) : p.facing === "user" ? (
                        <>
                          <circle cx="12" cy="9" r="3.5" />
                          <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
                        </>
                      ) : (
                        <>
                          <path d="M4 15a8 8 0 1 1 16 0" />
                          <path d="m12 15 3.5-4.5" />
                          <path d="M4 19h16" />
                        </>
                      )}
                    </svg>
                  </span>
                  <span className="text-sm font-semibold leading-tight text-slate-900">{p.title}</span>
                  <span className="text-xs leading-snug text-slate-500">
                    {state === "uploaded" ? "Saved · tap to retake" : state === "queued" ? "Saved, uploads with signal" : p.hint}
                  </span>
                  {!taken ? (
                    <span className="mt-1 rounded-full bg-brand-950 active:bg-brand-900 px-3 py-1 text-xs font-semibold text-white">Open camera</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {kmNeeded ? (
        <label className="block card p-5">
          <span className="block text-lg font-semibold text-slate-900">Km reading</span>
          <span className="mt-0.5 block text-sm text-slate-500">
            The number on the scooter
            {mode === "checkout" && startKm != null ? ` (this morning: ${startKm} km)` : ""}
          </span>
          <span className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-4 ring-2 ring-slate-200 focus-within:ring-brand-600">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              placeholder="12450"
              value={km}
              onChange={(e) => setKm(e.target.value)}
              className="h-16 min-w-0 flex-1 bg-transparent text-3xl font-semibold tabular-nums tracking-tight text-slate-900 outline-none placeholder:text-slate-300"
            />
            <span className="text-lg font-semibold text-slate-500">km</span>
          </span>
          <OdometerHint reading={reading} typed={kmValid ? kmValue : null} />
          {mode === "checkout" && startKm != null && kmValid && kmValue! >= startKm ? (
            <span className="mt-2 block text-sm font-semibold text-brand-700">
              {Math.round((kmValue! - startKm) * 10) / 10} km today
            </span>
          ) : null}
        </label>
      ) : null}

      {error ? <p className="rounded-lg bg-danger-50 p-3 text-sm font-medium text-danger-700">{error}</p> : null}

      {/* The one action, always under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready || submitting !== null}
            className="tap-lg w-full rounded-lg bg-brand-950 active:bg-brand-900 text-base font-semibold text-white active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
          >
            {submitting ?? (ready ? (retake ? "Send new photos" : verb) : !photosReady ? "Take both photos first" : "Type the km reading")}
          </button>
        </div>
      </div>

      {camera ? (
        <LiveCameraCapture
          kind={camera.kind}
          rosterId={rosterId}
          facing={camera.facing}
          title={camera.title}
          hint={camera.hint}
          onCancel={() => setCamera(null)}
          onCaptured={({ queued, photoId }) => {
            setShots((s) => ({ ...s, [camera.kind]: queued ? "queued" : "uploaded" }));
            if (camera.kind === "ODOMETER" || camera.kind === "CHECKOUT_ODOMETER") {
              if (photoId) void readOdometer(photoId);
              else setReading({ state: "offline" });
            }
            setCamera(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Under the km box: what the photo said, and whether the typed number matches. */
function OdometerHint({
  reading,
  typed,
}: {
  reading: { state: "reading" | "read" | "unread" | "offline"; km?: number } | null;
  typed: number | null;
}) {
  if (!reading) {
    return <span className="mt-2 block text-sm text-slate-500">Take the km photo and the number fills in by itself.</span>;
  }
  if (reading.state === "reading") {
    return (
      <span className="mt-2 flex items-center gap-2 text-sm font-medium text-brand-800">
        <span className="size-3.5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
        Reading the km from your photo…
      </span>
    );
  }
  if (reading.state === "offline") {
    return <span className="mt-2 block text-sm text-slate-500">No signal to read the photo. Type the number shown.</span>;
  }
  if (reading.state === "unread" || reading.km == null) {
    return <span className="mt-2 block text-sm text-warn-700">Couldn&apos;t read the number. Type it from the scooter.</span>;
  }
  const fmt = reading.km.toLocaleString("en-IN");
  if (typed != null && typed !== reading.km) {
    return (
      <span className="mt-2 block text-sm font-medium text-warn-700">
        The photo reads {fmt} km. You typed a different number; the office will see both.
      </span>
    );
  }
  return (
    <span className="mt-2 flex items-center gap-1.5 text-sm font-medium text-ok-700">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
      Read from your photo. Check it matches the scooter.
    </span>
  );
}
