import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * How many things a sales rep or admin could approve right now: depot
 * check-ins plus before/after photos. Two head-only counts, no rows fetched.
 */
export async function getPendingApprovalCount(): Promise<number> {
  const supabase = await createClient();
  const [rosters, jobs] = await Promise.all([
    supabase
      .from("day_rosters")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "PENDING")
      .not("submitted_at", "is", null),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .or("before_review.eq.PENDING,after_review.eq.PENDING"),
  ]);
  return (rosters.count ?? 0) + (jobs.count ?? 0);
}
