import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  Job, JobLineItem, ServiceField, Client, Service, JobEvent, Photo,
} from "@/lib/domain/database";

export type JobDetail = {
  job: Job;
  client: Client | null;
  service: Service | null;
  lineItems: JobLineItem[];
  lineItemFields: ServiceField[];
  jobFields: ServiceField[];
  events: JobEvent[];
  photos: Photo[];
  supervisorName: string | null;
  payment: { amount: string; mode: string; collected_at: string | null } | null;
};

/**
 * Loads a job with the schema it was PINNED to at creation, not whatever the
 * service looks like today. That is the whole reason job_field_schema_id
 * exists: a job booked in March must still render correctly after an admin
 * republishes the service in June.
 */
export const getJobDetail = cache(async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const j = job as Job;

  const [clientRes, serviceRes, itemsRes, fieldsRes, eventsRes, photosRes, supRes, payRes] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", j.client_id).maybeSingle(),
      supabase.from("services").select("*").eq("id", j.service_id).maybeSingle(),
      supabase.from("job_line_items").select("*").eq("job_id", jobId).order("position"),
      supabase
        .from("service_fields")
        .select("*")
        .in(
          "schema_id",
          [j.job_field_schema_id, j.line_item_schema_id].filter(Boolean) as string[],
        )
        .order("sort_order"),
      supabase
        .from("job_events")
        .select("*")
        .eq("job_id", jobId)
        .order("occurred_at", { ascending: false })
        .limit(50),
      supabase.from("photos").select("*").eq("job_id", jobId).is("replaced_at", null),
      j.assigned_supervisor_id
        ? supabase
            .from("staff_directory")
            .select("full_name")
            .eq("id", j.assigned_supervisor_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("payments")
        .select("amount, mode, collected_at")
        .eq("job_id", jobId)
        .maybeSingle(),
    ]);

  const allFields = (fieldsRes.data ?? []) as ServiceField[];

  return {
    job: j,
    client: (clientRes.data as Client | null) ?? null,
    service: (serviceRes.data as Service | null) ?? null,
    lineItems: (itemsRes.data ?? []) as JobLineItem[],
    jobFields: allFields.filter((f) => f.schema_id === j.job_field_schema_id),
    lineItemFields: allFields.filter((f) => f.schema_id === j.line_item_schema_id),
    events: (eventsRes.data ?? []) as JobEvent[],
    photos: (photosRes.data ?? []) as Photo[],
    supervisorName:
      (supRes.data as { full_name?: string } | null)?.full_name ?? null,
    payment:
      (payRes.data as { amount: string; mode: string; collected_at: string | null } | null) ??
      null,
  };
});

/** The day timetable, for the sales rep and admin. */
export async function getDayJobs(serviceDate: string) {
  const supabase = await createClient();
  type Row = {
    id: string;
    job_number: string;
    status: string;
    scheduled_start: string;
    site_address: string;
    is_late: boolean;
    late_blameless: boolean;
    sequence_in_day: number | null;
    travel_minutes: number | null;
    itinerary_flags: string[];
    quoted_amount: string | null;
    client: { name: string; phone: string | null } | null;
    service: { name: string } | null;
    assigned_supervisor_id: string | null;
  };

  // NOTE: no embedded join to `profiles`. RLS restricts that table to
  // self-or-admin, so for a sales rep the join silently returns null and every
  // job reads "Unassigned". Names come from the staff_directory view instead,
  // which is exactly what it exists for.
  const [jobsRes, staffRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        `id, job_number, status, scheduled_start, site_address, is_late, late_blameless,
         sequence_in_day, travel_minutes, itinerary_flags, quoted_amount,
         assigned_supervisor_id,
         client:clients(name, phone),
         service:services(name)`,
      )
      .eq("service_date", serviceDate)
      .order("scheduled_start")
      .overrideTypes<Row[], { merge: false }>(),
    supabase.from("staff_directory").select("id, full_name"),
  ]);

  const names = new Map((staffRes.data ?? []).map((s) => [s.id, s.full_name]));

  return (jobsRes.data ?? []).map((j) => ({
    ...j,
    supervisor: j.assigned_supervisor_id
      ? { full_name: names.get(j.assigned_supervisor_id) ?? "Unknown" }
      : null,
  }));
}
