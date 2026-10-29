import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionProfile } from "./session";

/**
 * Signed URLs for new staff's ID documents (Aadhaar, licence).
 *
 * These are the most sensitive files in the system, so: admin only (checked
 * here, before the service-role client is touched), ten-minute links, and no
 * caching. The bucket has no read policy for anyone; this is the only way in.
 */
export async function getSignedStaffDocUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const profile = await getSessionProfile();
  if (profile?.role !== "admin" || !profile.is_active) return {};

  const { data } = await createAdminClient()
    .storage.from("staff-documents")
    .createSignedUrls(paths, 600);

  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out[row.path] = row.signedUrl;
  }
  return out;
}
