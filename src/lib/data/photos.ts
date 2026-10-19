import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionProfile } from "./session";

/**
 * Signed URLs for check-in and site photos.
 *
 * The storage bucket is private and its RLS policy grants direct SELECT to
 * nobody but admin, so every read goes through here: we establish who is
 * asking FIRST, then use the service-role client to sign. That keeps a single
 * authorisation decision in one place instead of widening the storage policy
 * and hoping the UI never leaks a URL.
 *
 * URLs are REUSED while they have plenty of life left. The Approvals page
 * refreshes itself every 15 seconds; minting fresh URLs each time changed every
 * <img src>, so the browser threw the photos away and downloaded them again,
 * and on a phone they never finished loading before the next refresh. A
 * stable URL is cached by the browser and costs nothing on refresh.
 *
 * An hour is the trade-off: a signed URL is a bearer token, so it should not
 * live forever, but it must outlive a review session. Paths are unguessable
 * (they contain a random UUID) and only staff ever receive them.
 */
const TTL_SECONDS = 60 * 60;
const REUSE_MIN_REMAINING_MS = 15 * 60 * 1000;
const cache = new Map<string, { url: string; expiresAt: number }>();

export async function getSignedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};

  const profile = await getSessionProfile();
  if (!profile || !["admin", "sales_rep"].includes(profile.role)) return {};

  const now = Date.now();
  const out: Record<string, string> = {};
  const toSign: string[] = [];
  for (const path of new Set(paths)) {
    const hit = cache.get(path);
    if (hit && hit.expiresAt - now > REUSE_MIN_REMAINING_MS) out[path] = hit.url;
    else toSign.push(path);
  }
  if (toSign.length === 0) return out;

  const admin = createAdminClient();
  const { data } = await admin.storage.from("checkin-photos").createSignedUrls(toSign, TTL_SECONDS);

  const expiresAt = now + TTL_SECONDS * 1000;
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) {
      out[row.path] = row.signedUrl;
      cache.set(row.path, { url: row.signedUrl, expiresAt });
    }
  }

  // Keep the cache from growing without bound on a long-running server.
  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  return out;
}
