"use client";

import { createClient } from "@/lib/supabase/client";
import type { PhotoKind } from "@/lib/domain/database";

/**
 * Offline photo queue.
 *
 * Water tanks are on terraces and in underground sumps; solar arrays are on
 * roofs behind parapets. Connectivity dies exactly where the work happens, so
 * a capture that cannot upload immediately must survive and retry rather than
 * be lost.
 *
 * Background Sync does not exist on iOS, so the flush is driven by the page on
 * foreground/online (see ServiceWorkerRegistrar), not by the browser.
 */

const DB_NAME = "cleanify";
const DB_VERSION = 1;
const STORE = "uploads";

export type QueuedUpload = {
  id: string;
  kind: PhotoKind;
  rosterId: string | null;
  jobId: string | null;
  lineItemId: string | null;
  tokenId: string;
  storagePath: string;
  blob: Blob;
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  cameraFacing: "user" | "environment" | null;
  captureLatencyMs: number | null;
  /** When the shutter actually fired on the device. Preserved across retries. */
  clientClockAt: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function enqueueUpload(item: QueuedUpload): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
  notifyListeners();
}

export async function listQueue(): Promise<QueuedUpload[]> {
  try {
    return (await tx<QueuedUpload[]>("readonly", (s) => s.getAll())) ?? [];
  } catch {
    return [];
  }
}

async function removeFromQueue(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  notifyListeners();
}

/* --- pending-count subscription, for the "2 items waiting to sync" chip --- */
type Listener = (count: number) => void;
const listeners = new Set<Listener>();

export function onQueueChange(fn: Listener): () => void {
  listeners.add(fn);
  void listQueue().then((q) => fn(q.length));
  return () => listeners.delete(fn);
}

function notifyListeners() {
  void listQueue().then((q) => listeners.forEach((l) => l(q.length)));
}

/* ------------------------------------------------------------------------ */

let flushing = false;

export async function flushUploadQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { sent: 0, failed: 0 };
  }

  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    const supabase = createClient();
    const queue = await listQueue();

    for (const item of queue) {
      try {
        let tokenId = item.tokenId;
        let path = item.storagePath;

        // A capture token lives about five minutes. Anything queued on a roof
        // with no signal will outlive it, so re-issue rather than drop the
        // photo. The ORIGINAL device capture time is preserved either way, and
        // the server still stamps its own clock on arrival — so the delay is
        // visible in the audit trail instead of being silently erased.
        const expired = await isTokenUnusable(supabase, tokenId);
        if (expired) {
          const { data: fresh, error } = await supabase.rpc("issue_capture_token", {
            p_kind: item.kind,
            p_roster_id: item.rosterId,
            p_job_id: item.jobId,
            p_job_line_item_id: item.lineItemId,
          });
          if (error || !fresh) throw error ?? new Error("could not re-issue capture token");
          tokenId = (fresh as { id: string; storage_path: string }).id;
          path = (fresh as { id: string; storage_path: string }).storage_path;
        }

        const up = await supabase.storage
          .from("checkin-photos")
          .upload(path, item.blob, { contentType: item.mime, upsert: false });
        // A retry after the upload landed but record_photo failed finds the
        // object already there. That is success, not an error.
        if (up.error && !isAlreadyUploaded(up.error)) throw up.error;

        const { error: recErr } = await supabase.rpc("record_photo", {
          p_token_id: tokenId,
          p_sha256: item.sha256,
          p_mime_type: item.mime,
          p_bytes: item.bytes,
          p_width: item.width,
          p_height: item.height,
          p_camera_facing: item.cameraFacing,
          p_capture_latency_ms: item.captureLatencyMs,
          p_client_clock: item.clientClockAt,
          p_lat: item.lat,
          p_lng: item.lng,
          p_accuracy_m: item.accuracyM,
        });
        if (recErr) throw recErr;

        await removeFromQueue(item.id);
        sent++;
      } catch (err) {
        failed++;
        await tx("readwrite", (s) =>
          s.put({
            ...item,
            attempts: item.attempts + 1,
            lastError: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  } finally {
    flushing = false;
    notifyListeners();
  }

  return { sent, failed };
}

function isAlreadyUploaded(err: unknown): boolean {
  const e = err as { statusCode?: string | number; message?: string };
  return String(e.statusCode) === "409" || /already exists|duplicate/i.test(e.message ?? "");
}

async function isTokenUnusable(
  supabase: ReturnType<typeof createClient>,
  tokenId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("capture_tokens")
    .select("expires_at, consumed_at")
    .eq("id", tokenId)
    .maybeSingle();
  if (!data) return true;
  if (data.consumed_at) return true;
  return new Date(data.expires_at).getTime() <= Date.now();
}

/* ------------------------------------------------------------------------ */

/** Hex SHA-256 of the exact bytes — the server indexes this to spot reuse. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
