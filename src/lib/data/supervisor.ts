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
