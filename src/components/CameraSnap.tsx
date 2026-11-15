"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compressToJpeg } from "@/lib/image";

/**
 * A plain live-camera shot: the rear camera opens full screen, one tap takes
 * the photo, then Retake or Use. No file picker, so it can never offer the
 * gallery. (LiveCameraCapture does the same for job photos, with its own
 * upload tokens; this one just hands the photo back.)
 */
export function CameraSnap({
  title,
  hint,
  onDone,
  onCancel,
}: {
  title: string;
  hint?: string;
  onDone: (photo: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "review" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open the camera. Use Chrome on Android or Safari on iPhone.");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("live");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera for this site in your browser settings, then try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : "The camera could not be started. Close any other app using it and try again.",
      );
      setPhase("error");
    }
  }, [stop]);

  useEffect(() => {
    // Opening the camera is the whole point of this screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return stop;
  }, [start, stop]);

  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot]);

  async function capture() {
    const video = videoRef.current;
    if (!video || phase !== "live") return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const { blob } = await compressToJpeg(canvas, { maxEdge: 1600, quality: 0.82 });
    stop();
    setShot({ blob, url: URL.createObjectURL(blob) });
    setPhase("review");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-[calc(var(--safe-top)+0.75rem)]">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {hint ? <p className="truncate text-sm text-white/70">{hint}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => {
            stop();
            onCancel();
          }}
          className="tap shrink-0 rounded-full px-4 text-sm font-medium text-white/80"
        >
          Cancel
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
        {phase === "review" && shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local photo just taken
          <img src={shot.url} alt="Photo just taken" className="camera-surface" />
        ) : (
          <video ref={videoRef} playsInline muted autoPlay className="camera-surface" aria-label="Live camera" />
        )}
        {phase === "starting" ? (
          <p className="absolute inset-0 flex items-center justify-center text-white/80">Starting camera…</p>
        ) : null}
        {phase === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-balance text-white/90">{error}</p>
            <button type="button" onClick={() => void start()} className="tap rounded-xl bg-white px-6 font-semibold text-slate-900">
              Try again
            </button>
          </div>
        ) : null}
      </div>

      <footer className="px-4 pb-[calc(var(--safe-bottom)+1.25rem)] pt-4">
        {phase === "review" && shot ? (
          <div className="flex gap-3">
            <button type="button" onClick={() => void start()} className="tap-lg flex-1 rounded-lg border-2 border-white/40 font-semibold">
              Retake
            </button>
            <button type="button" onClick={() => onDone(shot.blob)} className="tap-lg flex-[2] rounded-lg bg-brand-500 font-semibold text-white">
              Use this photo
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void capture()}
              disabled={phase !== "live"}
              aria-label="Take photo"
              className="size-20 rounded-full border-4 border-white bg-white/25 disabled:opacity-40"
            />
          </div>
        )}
      </footer>
    </div>
  );
}
