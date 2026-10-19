"use client";

/**
 * Downscale and re-encode before upload.
 *
 * This is the single highest-leverage performance decision in the app: the
 * difference between a three-second upload and a forty-five second one on a
 * weak edge cell on a rooftop. It is also what keeps storage growth sane —
 * roughly 8 photos a job, 20 jobs a day.
 */
export async function compressToJpeg(
  source: HTMLCanvasElement,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  const maxEdge = opts.maxEdge ?? 1280;
  const quality = opts.quality ?? 0.75;

  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);

  let out: HTMLCanvasElement | OffscreenCanvas;
  if (scale === 1) {
    out = source;
  } else {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    out = c;
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    (out as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Could not encode the photo");
  return { blob, width: w, height: h };
}
