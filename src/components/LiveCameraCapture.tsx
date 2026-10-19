"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PhotoKind } from "@/lib/domain/database";
import { compressToJpeg } from "@/lib/image";
import { getBestFix, type Fix } from "@/lib/geolocation";
import { enqueueUpload, flushUploadQueue, sha256Hex } from "@/lib/upload-queue";

/**
 * ============================================================================
 * Live camera capture
 * ============================================================================
 *
 * There is deliberately NO <input type="file"> anywhere in this component, and
 * there must never be one. The frame comes from getUserMedia, is drawn to a
 * canvas, and is encoded in the page. `<input capture>` is not used because
 * iOS Safari has historically ignored it and offered the photo library anyway.
 *
 * The UI alone is not the control, though. A camera-only screen proves nothing
 * if the upload endpoint accepts any blob — anyone with dev tools can POST a
 * photo from last week. The real guarantee is the server-issued capture token:
 * single-use, short-lived, and it is the token (not the client) that decides
 * the object path the storage policy will accept.
 */

type Props = {
  kind: PhotoKind;
  rosterId?: string | null;
  jobId?: string | null;
  lineItemId?: string | null;
  /** Front camera for selfies, rear for the odometer and site shots. */
  facing?: "user" | "environment";
  title: string;
  hint?: string;
  onCaptured: (info: { photoId: string | null; queued: boolean }) => void;
  onCancel?: () => void;
};

type Phase = "starting" | "live" | "review" | "uploading" | "error";

export function LiveCameraCapture({
  kind,
  rosterId = null,
  jobId = null,
  lineItemId = null,
  facing = "environment",
  title,
  hint,
  onCaptured,
  onCancel,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openedAtRef = useRef<number>(0);

  // These are read during render (the accuracy chip) and inside confirm(), so
  // they are state, not refs. As refs the chip would sit on "Finding your
  // location..." forever, because arriving data would not trigger a render.
  const [token, setToken] = useState<{ id: string; storage_path: string } | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [shot, setShot] = useState<{
    blob: Blob;
    width: number;
    height: number;
    latencyMs: number;
    takenAt: string;
  } | null>(null);
  const [currentFacing, setCurrentFacing] = useState(facing);

  /* --------------------------------------------------------------- camera */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(
    async (want: "user" | "environment") => {
      stopCamera();

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "This browser cannot open the camera. Use Chrome on Android or Safari on iPhone.",
        );
        setPhase("error");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: want, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        openedAtRef.current = performance.now();
        setPhase("live");
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Open your browser settings for this site and allow the camera, then try again."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : "The camera could not be started. Close any other app using it and try again.",
        );
        setPhase("error");
      }
    },
    [stopCamera],
  );

  useEffect(() => {
    let cancelled = false;
    // Deferred one frame: kicking this off synchronously inside the effect
    // would setState during the effect phase and cascade a re-render.
    const raf = requestAnimationFrame(() => {
      if (!cancelled) void startCamera(currentFacing);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopCamera();
    };
  }, [currentFacing, startCamera, stopCamera]);

  /* ------------------------------------------------ token + location prep */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("issue_capture_token", {
        p_kind: kind,
        p_roster_id: rosterId,
        p_job_id: jobId,
        p_job_line_item_id: lineItemId,
      });
      if (!cancelled && !err && data) {
        setToken(data as { id: string; storage_path: string });
      }
    })();

    // Warm up the GPS while the supervisor is framing the shot, so the fix is
    // already good by the time the shutter fires.
    void getBestFix().then((f) => {
      if (!cancelled) setFix(f);
    });

    return () => {
      cancelled = true;
    };
  }, [kind, rosterId, jobId, lineItemId]);

  /* -------------------------------------------------------------- shutter */
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || phase !== "live") return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const { blob, width, height } = await compressToJpeg(canvas);
    // Both an implausibly fast and an implausibly slow shutter are signals
    // worth recording; neither blocks the capture.
    const latencyMs = Math.round(performance.now() - openedAtRef.current);

    setShot({ blob, width, height, latencyMs, takenAt: new Date().toISOString() });
    setPreview(URL.createObjectURL(blob));
    setPhase("review");
    stopCamera();
  }, [phase, stopCamera]);

  const retake = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setShot(null);
    setPhase("starting");
    void startCamera(currentFacing);
  }, [preview, startCamera, currentFacing]);

  /* --------------------------------------------------------------- upload */
  const confirm = useCallback(async () => {
    if (!shot) return;
    setPhase("uploading");

    const sha = await sha256Hex(shot.blob);

    // No token means the RPC failed earlier (usually offline). Queue it: the
    // flush will mint a fresh token, and the original capture time is kept.
    if (!token) {
      await enqueueUpload({
        id: crypto.randomUUID(),
        kind,
        rosterId,
        jobId,
        lineItemId,
        tokenId: "",
        storagePath: "",
        blob: shot.blob,
        sha256: sha,
        mime: "image/jpeg",
        bytes: shot.blob.size,
        width: shot.width,
        height: shot.height,
        cameraFacing: currentFacing,
        captureLatencyMs: shot.latencyMs,
        clientClockAt: shot.takenAt,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        accuracyM: fix?.accuracyM ?? null,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      });
      onCaptured({ photoId: null, queued: true });
      return;
    }

    const supabase = createClient();
    try {
      const up = await supabase.storage
        .from("checkin-photos")
        .upload(token.storage_path, shot.blob, {
          contentType: "image/jpeg",
          // Never overwrite: every token names a fresh path, and supervisors
          // have no UPDATE policy on storage, so upsert would be refused.
          upsert: false,
        });
      if (up.error) throw up.error;

      const { data, error: recErr } = await supabase.rpc("record_photo", {
        p_token_id: token.id,
        p_sha256: sha,
        p_mime_type: "image/jpeg",
        p_bytes: shot.blob.size,
        p_width: shot.width,
        p_height: shot.height,
        p_camera_facing: currentFacing,
        p_capture_latency_ms: shot.latencyMs,
        p_client_clock: shot.takenAt,
        p_lat: fix?.lat ?? null,
        p_lng: fix?.lng ?? null,
        p_accuracy_m: fix?.accuracyM ?? null,
      });
      if (recErr) throw recErr;

      onCaptured({ photoId: (data as { id: string } | null)?.id ?? null, queued: false });
    } catch {
      // Upload failed — almost always signal. Never lose the photo.
      await enqueueUpload({
        id: crypto.randomUUID(),
        kind,
        rosterId,
        jobId,
        lineItemId,
        tokenId: token.id,
        storagePath: token.storage_path,
        blob: shot.blob,
        sha256: sha,
        mime: "image/jpeg",
        bytes: shot.blob.size,
        width: shot.width,
        height: shot.height,
        cameraFacing: currentFacing,
        captureLatencyMs: shot.latencyMs,
        clientClockAt: shot.takenAt,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        accuracyM: fix?.accuracyM ?? null,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      });
      void flushUploadQueue();
      onCaptured({ photoId: null, queued: true });
    }
  }, [shot, token, fix, kind, rosterId, jobId, lineItemId, currentFacing, onCaptured]);

  /* ----------------------------------------------------------------- view */
  const accuracyLabel = fix
    ? `Located to ±${Math.round(fix.accuracyM)} m`
    : "Finding your location…";
  // Above this a fix is UNUSABLE, which is a different accusation from
  // "suspicious location" — the copy stays neutral on purpose.
  const accuracyPoor = (fix?.accuracyM ?? 0) > 150;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-[calc(var(--safe-top)+0.75rem)]">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {hint ? <p className="truncate text-sm text-white/70">{hint}</p> : null}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onCancel();
            }}
            className="tap shrink-0 rounded-full px-4 text-sm font-medium text-white/80"
          >
            Cancel
          </button>
        ) : null}
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
        {phase === "review" && preview ? (
          // A blob: URL from the camera. next/image cannot optimise it and the
          // bytes are already local, so the plain tag is the right call.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Captured photo" className="camera-surface" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="camera-surface"
            aria-label="Live camera"
          />
        )}

        {(kind === "PPE_SELFIE" || kind === "CHECKOUT_SELFIE") && phase === "live" ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-[70%] w-[62%] rounded-[45%] border-2 border-dashed border-white/60" />
          </div>
        ) : null}

        {phase === "starting" ? (
          <p className="absolute inset-0 flex items-center justify-center text-white/80">
            Starting camera…
          </p>
        ) : null}

        {phase === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-balance text-white/90">{error}</p>
            <button
              type="button"
              onClick={() => void startCamera(currentFacing)}
              className="tap rounded-xl bg-white px-6 font-semibold text-slate-900"
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      <footer className="space-y-3 px-4 pb-[calc(var(--safe-bottom)+1.25rem)] pt-4">
        <p className={`text-center text-sm ${accuracyPoor ? "text-amber-300" : "text-white/70"}`}>
          {accuracyLabel}
          {accuracyPoor ? " — move into the open if you can" : ""}
        </p>

        {phase === "review" ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={retake}
              className="tap-lg flex-1 rounded-2xl border-2 border-white/40 font-semibold"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              className="tap-lg flex-[2] rounded-2xl bg-brand-500 font-semibold text-white"
            >
              Use this photo
            </button>
          </div>
        ) : phase === "uploading" ? (
          <div className="tap-lg flex items-center justify-center rounded-2xl bg-white/15 font-semibold">
            Uploading…
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() =>
                setCurrentFacing((f) => (f === "user" ? "environment" : "user"))
              }
              className="tap rounded-full px-4 text-sm text-white/80"
            >
              Flip
            </button>
            <button
              type="button"
              onClick={() => void capture()}
              disabled={phase !== "live"}
              aria-label="Take photo"
              className="size-20 rounded-full border-4 border-white bg-white/25 disabled:opacity-40"
            />
            <span className="w-16" aria-hidden />
          </div>
        )}
      </footer>
    </div>
  );
}
