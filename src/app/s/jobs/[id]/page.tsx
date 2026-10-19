import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { getJobDetail } from "@/lib/data/jobs";
import { AppShell } from "@/components/AppShell";
import { JobDetailView } from "@/components/JobDetailView";
import { createClient } from "@/lib/supabase/server";
import { parseEwkbPoint } from "@/lib/location-link";
import type { ApprovalStatus } from "@/lib/domain/database";
import { JobFlow, type FlowUnit } from "./JobFlow";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/s/jobs/[id]">) {
  const { id } = await props.params;
  const detail = await getJobDetail(id);
  return { title: detail?.job.job_number ?? "Job" };
}

export default async function SupervisorJobPage(props: PageProps<"/s/jobs/[id]">) {
  const { id } = await props.params;
  const [profile, detail] = await Promise.all([requireRole("supervisor"), getJobDetail(id)]);

  // RLS already restricts the query to this supervisor's own jobs, so a miss
  // here means either no such job or not theirs. Both are a 404 to them.
  if (!detail) notFound();

  const { job, lineItems, photos, service, lineItemFields } = detail;
  const supabase = await createClient();
  const { data: roster } = await supabase
    .from("day_rosters")
    .select("submitted_at, approval_status")
    .eq("supervisor_id", profile.id)
    .eq("roster_date", job.service_date)
    .is("voided_at", null)
    .maybeSingle();

  const has = (itemId: string, kind: string) =>
    photos.some((p) => p.job_line_item_id === itemId && p.kind === kind) ? "saved" : "none";
  const units: FlowUnit[] = lineItems.map((li) => ({
    id: li.id,
    label: li.label ?? `${service?.line_item_singular ?? "Item"} ${li.position}`,
    details: li.details ?? {},
    before: has(li.id, "SITE_BEFORE"),
    after: has(li.id, "SITE_AFTER"),
  }));

  const depot = roster?.submitted_at ? (roster.approval_status as ApprovalStatus) : "none";
  // The location is the reward for an approved depot check-in.
  const unlocked = depot === "APPROVED";

  return (
    <AppShell
      profile={profile}
      title={detail.job.job_number}
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
      ]}
    >
      <div className="space-y-4">
        {unlocked && job.status !== "COMPLETED" ? (
          <NavigateButton address={job.site_address} pin={parseEwkbPoint(job.site_location)} />
        ) : null}
        <JobFlow
          // Remount when the server state moves (e.g. an approval arrives via
          // AutoRefresh) so local state never shows a stale step.
          key={`${job.status}|${depot}|${job.before_review}|${job.after_review}`}
          jobId={job.id}
          initialStatus={job.status}
          depot={depot}
          units={units}
          unitFields={lineItemFields}
          unitNoun={service?.line_item_singular ?? "Item"}
          before={{ status: job.before_review, reason: job.before_rejection_reason }}
          after={{ status: job.after_review, reason: job.after_rejection_reason }}
          completedAt={job.completed_at}
        />
        <JobDetailView detail={detail} />
        <Link
          href="/s"
          className="tap-lg flex items-center justify-center rounded-2xl border-2 border-slate-300 font-semibold text-slate-700"
        >
          Back to today
        </Link>
      </div>
    </AppShell>
  );
}

function NavigateButton({
  address,
  pin,
}: {
  address: string;
  pin: { lat: number; lng: number } | null;
}) {
  // Hand off to whichever map app the supervisor already knows. Building a
  // turn-by-turn view would be worse than Google's in every respect. The pin
  // goes first: it is what the rep placed (often pasted from the client's own
  // WhatsApp location), and Indian street addresses rarely geocode exactly.
  const q = pin ? `${pin.lat},${pin.lng}` : encodeURIComponent(address);
  return (
    <a
      href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
      target="_blank"
      rel="noreferrer"
      className="tap-lg flex items-center justify-center rounded-2xl bg-brand-700 font-semibold text-white"
    >
      Navigate there
    </a>
  );
}
