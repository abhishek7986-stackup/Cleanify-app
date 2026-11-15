import os from "node:os";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pickOdometerKm } from "@/lib/odometer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reads the km off an odometer photo the supervisor has just taken.
 *
 *   POST { photoId }  ->  { km: number | null, engine }
 *
 * Google Cloud Vision when GOOGLE_VISION_API_KEY is set (far better on
 * digital and dirty displays); otherwise a free reader (Tesseract) running
 * here on the server, so the phone downloads nothing.
 *
 * The result only PRE-FILLS the km box. The supervisor confirms or corrects
 * it, and both numbers are kept, so a wrong read costs a tap, never the data.
 * Only the person who took the photo can ask, and only for an odometer photo.
 */

const ODOMETER_KINDS = ["ODOMETER", "CHECKOUT_ODOMETER"];

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { photoId?: unknown } | null;
  const photoId = typeof body?.photoId === "string" ? body.photoId : null;
  if (!photoId) return NextResponse.json({ error: "photoId is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: photo } = await admin
    .from("photos")
    .select("id, kind, roster_id, storage_path, uploaded_by")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo || photo.uploaded_by !== auth.user.id || !ODOMETER_KINDS.includes(photo.kind)) {
    return NextResponse.json({ error: "Not your odometer photo" }, { status: 404 });
  }

  // Asked twice (a retry, a slow network): answer from the first read.
  const { data: existing } = await admin
    .from("odometer_readings")
    .select("read_km, engine")
    .eq("photo_id", photoId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ km: existing.read_km != null ? Number(existing.read_km) : null, engine: existing.engine });
  }

  const { data: file, error: dlErr } = await admin.storage
    .from("checkin-photos")
    .download(photo.storage_path);
  if (dlErr || !file) return NextResponse.json({ error: "Photo not found in storage" }, { status: 404 });
  const image = Buffer.from(await file.arrayBuffer());

  const lastKm = await lastKnownKm(admin, auth.user.id, photo.kind, photo.roster_id);

  // Google first when a key is set; if Google refuses (billing off, quota, an
  // outage) the free reader takes over, so a photo is never left unread.
  const visionKey = process.env.GOOGLE_VISION_API_KEY;
  let engine: "google_vision" | "tesseract" = "tesseract";
  let text = "";
  if (visionKey) {
    try {
      text = await readWithVision(image, visionKey);
      engine = "google_vision";
    } catch (e) {
      console.error("Google Vision failed, using the free reader", e);
    }
  }
  if (engine === "tesseract") {
    try {
      text = await readWithTesseract(image);
    } catch (e) {
      console.error("odometer read failed", e);
    }
  }
  const km = text ? pickOdometerKm(text, lastKm) : null;

  await admin
    .from("odometer_readings")
    .upsert({ photo_id: photoId, read_km: km, engine, raw_text: text.slice(0, 2000) || null }, { onConflict: "photo_id", ignoreDuplicates: true });

  return NextResponse.json({ km, engine });
}

/**
 * The reading this one should be at or just above: this morning's for a
 * check-out, otherwise the supervisor's latest reading on any earlier day.
 */
async function lastKnownKm(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  kind: string,
  rosterId: string | null,
): Promise<number | null> {
  if (kind === "CHECKOUT_ODOMETER" && rosterId) {
    const { data } = await admin.from("day_rosters").select("start_odometer_km").eq("id", rosterId).maybeSingle();
    if (data?.start_odometer_km != null) return Number(data.start_odometer_km);
  }
  const { data } = await admin
    .from("day_rosters")
    .select("start_odometer_km, end_odometer_km")
    .eq("supervisor_id", userId)
    .is("voided_at", null)
    .not("start_odometer_km", "is", null)
    .order("roster_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = data?.end_odometer_km ?? data?.start_odometer_km;
  return v != null ? Number(v) : null;
}

async function readWithVision(image: Buffer, key: string): Promise<string> {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      requests: [{ image: { content: image.toString("base64") }, features: [{ type: "TEXT_DETECTION" }] }],
    }),
  });
  if (!res.ok) throw new Error(`Vision ${res.status}`);
  const json = (await res.json()) as {
    responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[];
  };
  const r = json.responses?.[0];
  if (r?.error) throw new Error(`Vision: ${r.error.message ?? "error"}`);
  return r?.fullTextAnnotation?.text ?? "";
}

// One reader kept warm between requests: starting it takes a few seconds.
let tesseractWorker: Promise<import("tesseract.js").Worker> | null = null;

async function readWithTesseract(image: Buffer): Promise<string> {
  if (!tesseractWorker) {
    tesseractWorker = (async () => {
      const { createWorker } = await import("tesseract.js");
      // The language data is cached in the system temp folder, never the project.
      const w = await createWorker("eng", 1, { cachePath: os.tmpdir() });
      await w.setParameters({ tessedit_char_whitelist: "0123456789 .,kmKM" });
      return w;
    })().catch((e) => {
      tesseractWorker = null;
      throw e;
    });
  }
  const worker = await tesseractWorker;
  const { data } = await worker.recognize(image);
  return data.text ?? "";
}
