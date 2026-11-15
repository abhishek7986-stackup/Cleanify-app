import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { istDate } from "@/lib/domain/checkin-policy";
import type { DayRoster, Job, Photo } from "@/lib/domain/database";

/** Photos that hang off the day rather than a job: check-in and check-out. */
export const ROSTER_PHOTO_KINDS = [
  "EQUIPMENT",
  "PPE_SELFIE",
  "ODOMETER",
  "CHECKOUT_SELFIE",
  "CHECKOUT_ODOMETER",
] as const;

export type SupervisorDay = {
  date: string;
  roster: DayRoster | null;
  jobs: (Job & { client: { name: string; phone: string | null } | null })[];
  checkinPhotos: Photo[];
};

/**
 * Everything the Today screen needs, in one round trip per table.
 *
 * `service_date` is a stored generated column in IST, so this filter is an
 * index lookup and can never disagree with what the scheduler computed.
 */
export const getSupervisorDay = cache(async function getSupervisorDay(
  supervisorId: string,
  date: string = istDate(),
): Promise<SupervisorDay> {
  const supabase = await createClient();

  // One round trip for everything: the roster brings its own current photos.
  const [rosterRes, jobsRes] = await Promise.all([
    supabase
      .from("day_rosters")
      .select("*, photos(*)")
      .eq("supervisor_id", supervisorId)
      .eq("roster_date", date)
      .is("photos.replaced_at", null)
      .in("photos.kind", [...ROSTER_PHOTO_KINDS])
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("*, client:clients(name, phone)")
      .eq("assigned_supervisor_id", supervisorId)
      .eq("service_date", date)
      .order("sequence_in_day", { ascending: true, nullsFirst: false })
      .order("scheduled_start", { ascending: true })
      .overrideTypes<SupervisorDay["jobs"], { merge: false }>(),
  ]);

  const row = rosterRes.data as (DayRoster & { photos: Photo[] }) | null;
  const { photos: checkinPhotos = [], ...roster } = row ?? { photos: [] };

  return {
    date,
    roster: row ? (roster as DayRoster) : null,
    jobs: jobsRes.data ?? [],
    checkinPhotos,
  };
});

/** The first day the app took payments; older jobs were settled outside it. */
const PAYMENTS_FROM_DATE = "2026-11-05";

/**
 * Finished jobs of the day with no payment marked. Check-out waits for these
 * (the database refuses it too), so the supervisor never leaves money unaccounted for.
 */
export async function getUnpaidFinishedJobs(
  jobs: { id: string; status: string; service_date: string; job_number: string; client: { name: string } | null }[],
): Promise<{ id: string; name: string }[]> {
  const done = jobs.filter((j) => j.status === "COMPLETED" && j.service_date >= PAYMENTS_FROM_DATE);
  if (!done.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("job_id")
    .in("job_id", done.map((j) => j.id))
    .is("voided_at", null);
  const paid = new Set((data ?? []).map((p) => p.job_id));
  return done.filter((j) => !paid.has(j.id)).map((j) => ({ id: j.id, name: j.client?.name ?? j.job_number }));
}
