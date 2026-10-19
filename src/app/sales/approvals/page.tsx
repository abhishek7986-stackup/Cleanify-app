import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { getSignedPhotoUrls } from "@/lib/data/photos";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { renderValue } from "@/components/JobDetailView";
import { ApprovalCard } from "./ApprovalCard";
import { SiteReviewCard } from "./SiteReviewCard";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";
import type { DayRoster, Job, JobLineItem, Photo, ServiceField } from "@/lib/domain/database";

export const metadata = { title: "Approvals" };

// Morning check-in photos. EQUIPMENT is the old machinery photo, still shown
// for check-ins sent before the scooter km photo replaced it.
const CHECKIN_KINDS: Photo["kind"][] = ["PPE_SELFIE", "ODOMETER", "EQUIPMENT"];
export const dynamic = "force-dynamic";

type SiteJob = Job & {
  client: { name: string } | null;
  service: { name: string } | null;
  job_line_items: JobLineItem[];
};

/**
 * Everything the field team is waiting on, newest first:
 *   - depot check-ins (unlock the day's jobs)
 *   - before photos + tank details (unlock cleaning)
 *   - after photos (closes the job)
 *
 * Supervisors are blocked until these are decided, so this page refreshes
 * itself and puts what is waiting at the top.
 */
export default async function ApprovalsPage() {
  const supabase = await createClient();

  const [profile, rosterRes, siteRes, staffRes] = await Promise.all([
    requireRole("sales_rep"),
    supabase
      .from("day_rosters")
      .select("*")
      .not("submitted_at", "is", null)
      .eq("approval_status", "PENDING")
      .order("submitted_at", { ascending: true }),
    supabase
      .from("jobs")
      .select("*, client:clients(name), service:services(name), job_line_items(*)")
      .or("before_review.eq.PENDING,after_review.eq.PENDING")
      .order("updated_at", { ascending: true })
      .overrideTypes<SiteJob[], { merge: false }>(),
    supabase.from("staff_directory").select("id, full_name"),
  ]);

  const rosters = (rosterRes.data ?? []) as DayRoster[];
  const siteJobs = siteRes.data ?? [];
  const nameOf = (id: string | null) =>
    (staffRes.data ?? []).find((s) => s.id === id)?.full_name ?? "Supervisor";

  // Photos and field labels for everything above, in one round trip each.
  const rosterIds = rosters.map((r) => r.id);
  const jobIds = siteJobs.map((j) => j.id);
  const schemaIds = [...new Set(siteJobs.map((j) => j.line_item_schema_id).filter(Boolean))] as string[];
  const [photoRes, fieldRes] = await Promise.all([
    rosterIds.length || jobIds.length
      ? supabase
          .from("photos")
          .select("*")
          .is("replaced_at", null)
          .or(
            [
              rosterIds.length ? `roster_id.in.(${rosterIds.join(",")})` : null,
              jobIds.length ? `job_id.in.(${jobIds.join(",")})` : null,
            ]
              .filter(Boolean)
              .join(","),
          )
      : Promise.resolve({ data: [] }),
    schemaIds.length
      ? supabase.from("service_fields").select("*").in("schema_id", schemaIds).order("sort_order")
      : Promise.resolve({ data: [] }),
  ]);
  const photos = (photoRes.data ?? []) as Photo[];
  const fields = (fieldRes.data ?? []) as ServiceField[];
  const signed = await getSignedPhotoUrls(photos.map((p) => p.storage_path));

  const reviews = siteJobs.flatMap((j) =>
    (["before", "after"] as const)
      .filter((stage) => (stage === "before" ? j.before_review : j.after_review) === "PENDING")
      .map((stage) => ({ job: j, stage })),
  );
  // Only what is waiting. Once decided, a card leaves this page, so the next
  // thing to review is always at the top.
  const pendingRosters = rosters;

  const rosterCard = (r: DayRoster) => (
    <ApprovalCard
      key={r.id}
      roster={r}
      supervisorName={nameOf(r.supervisor_id)}
      submittedLabel={`${formatIstDate(r.roster_date)} · checked in ${formatIstTime(r.submitted_at)}`}
      photos={photos
        .filter((p) => p.roster_id === r.id && CHECKIN_KINDS.includes(p.kind))
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          url: signed[p.storage_path] ?? null,
          flagged: p.flagged,
          flagReason: p.flag_reason,
        }))}
    />
  );

  const nav =
    profile.role === "admin"
      ? [
          { href: "/admin", label: "Today" },
          { href: "/sales/approvals", label: "Approvals" },
          { href: "/admin/users", label: "Users" },
        ]
      : [
          { href: "/sales", label: "Today" },
          { href: "/sales/new", label: "New job" },
          { href: "/sales/approvals", label: "Approvals" },
        ];

  return (
    <AppShell profile={profile} title="Approvals" nav={nav}>
      <AutoRefresh seconds={15} />
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Supervisors wait on these: their jobs unlock when the depot photos are approved, and cleaning
          starts when the before photos are approved. Approving the after photos closes the job.
        </p>

        {reviews.length === 0 && pendingRosters.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            Nothing waiting for review. This page updates by itself.
          </p>
        ) : null}

        {pendingRosters.length ? (
          <h2 className="px-1 font-semibold text-slate-900">Depot check-ins ({pendingRosters.length})</h2>
        ) : null}
        {pendingRosters.map(rosterCard)}

        {reviews.length ? (
          <h2 className="px-1 font-semibold text-slate-900">Site photos ({reviews.length})</h2>
        ) : null}
        {reviews.map(({ job, stage }) => {
          const kind = stage === "before" ? "SITE_BEFORE" : "SITE_AFTER";
          const itemFields = fields.filter((f) => f.schema_id === job.line_item_schema_id);
          return (
            <SiteReviewCard
              key={`${job.id}-${stage}`}
              jobId={job.id}
              jobNumber={job.job_number}
              stage={stage}
              clientName={job.client?.name ?? "Client"}
              serviceName={job.service?.name ?? ""}
              supervisorName={nameOf(job.assigned_supervisor_id)}
              sentLabel={`sent ${formatIstTime(stage === "before" ? job.before_submitted_at : job.after_submitted_at)}`}
              arrivedDistanceM={job.arrived_distance_m != null ? Number(job.arrived_distance_m) : null}
              note={stage === "after" ? job.completion_note : null}
              units={[...job.job_line_items]
                .sort((a, b) => a.position - b.position)
                .map((li) => {
                  const photo = photos.find((p) => p.job_line_item_id === li.id && p.kind === kind);
                  // After photos are judged against the before photo of the same tank.
                  const beforePhoto =
                    stage === "after"
                      ? photos.find((p) => p.job_line_item_id === li.id && p.kind === "SITE_BEFORE")
                      : undefined;
                  return {
                    id: li.id,
                    label: li.label ?? `Item ${li.position}`,
                    photoUrl: photo ? (signed[photo.storage_path] ?? null) : null,
                    beforeUrl: beforePhoto ? (signed[beforePhoto.storage_path] ?? null) : null,
                    details: itemFields
                      .filter((f) => li.details?.[f.key] !== undefined && li.details?.[f.key] !== "")
                      .map((f) => ({ label: f.label, value: renderValue(f, li.details[f.key]) })),
                  };
                })}
            />
          );
        })}
      </div>
    </AppShell>
  );
}
