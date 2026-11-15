import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { getJobDetail } from "@/lib/data/jobs";
import { AppShell } from "@/components/AppShell";
import { JobDetailView } from "@/components/JobDetailView";
import { createClient } from "@/lib/supabase/server";
import { parseEwkbPoint } from "@/lib/location-link";
import type { ApprovalStatus, JobStatus } from "@/lib/domain/database";
import { PAYMENTS_START_AT, rupees } from "@/lib/domain/payments";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";
import { JobFlow, type FlowUnit, type NextJob } from "./JobFlow";
import { CollectPayment } from "./CollectPayment";

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

  // One job at a time: an earlier job today that is still open comes first.
  const { data: earlier } = await supabase
    .from("jobs")
    .select("job_number, scheduled_start, client:clients(name)")
    .eq("assigned_supervisor_id", job.assigned_supervisor_id ?? "")
    .eq("service_date", job.service_date)
    .neq("id", job.id)
    .lt("scheduled_start", job.scheduled_start)
    .not("status", "in", "(COMPLETED,CANCELLED,NO_SHOW,DRAFT)")
    .order("scheduled_start")
    .limit(1);
  const first = earlier?.[0] as { job_number: string; client: { name: string } | null } | undefined;
  const waitFor = first ? { jobNumber: first.job_number, client: first.client?.name ?? "the earlier job" } : null;

  // Once this job is done, the completed screen hands over to whatever is
  // still open today (or to check-out), so the supervisor never has to go
  // back to Today to find the next Start trip.
  let next: NextJob = null;
  if (job.status === "COMPLETED") {
    const { data: open } = await supabase
      .from("jobs")
      .select("id, job_number, status, site_address, site_location, client:clients(name)")
      .eq("assigned_supervisor_id", job.assigned_supervisor_id ?? "")
      .eq("service_date", job.service_date)
      .neq("id", job.id)
      .not("status", "in", "(COMPLETED,CANCELLED,NO_SHOW,DRAFT)")
      .order("scheduled_start")
      .limit(1);
    const n = open?.[0] as
      | { id: string; job_number: string; status: JobStatus; site_address: string; site_location: unknown; client: { name: string } | null }
      | undefined;
    next = n
      ? {
          kind: "job",
          id: n.id,
          jobNumber: n.job_number,
          client: n.client?.name ?? n.job_number,
          status: n.status,
          mapsUrl: mapsLink(n.site_address, parseEwkbPoint(n.site_location)),
        }
      : { kind: "checkout" };
  }

  const siteMaps = mapsLink(job.site_address, parseEwkbPoint(job.site_location));
  const depot = roster?.submitted_at ? (roster.approval_status as ApprovalStatus) : "none";
  // The location is the reward for an approved depot check-in.
  const unlocked = depot === "APPROVED";

  // The customer pays when the work is finished, not when the office approves
  // the photos, so this opens as soon as the after photos are sent.
  const canCollect =
    (job.status === "COMPLETED" && Boolean(job.completed_at) && new Date(job.completed_at!) >= new Date(PAYMENTS_START_AT)) ||
    (job.status === "IN_PROGRESS" && job.after_review !== null);
  const [{ data: paid }, { data: workers }, { data: upiSetting }, { data: contact }] = canCollect
    ? await Promise.all([
        supabase
          .from("payments")
          .select("id, amount, mode, verified_at, note, proof_kind, proof_confirmed_at")
          .eq("job_id", job.id)
          .is("voided_at", null),
        supabase.rpc("list_workers"),
        supabase.from("app_settings").select("value").eq("key", "payments.upi").maybeSingle(),
        supabase.rpc("office_contact_for_job", { p_job_id: job.id }),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];
  const office = contact?.[0] ?? null;
  const callPending = (paid ?? []).some((p) => p.proof_kind === "call" && !p.proof_confirmed_at);

  return (
    <AppShell
      profile={profile}
      title={detail.client?.name ?? detail.job.job_number}
      back="/s"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/payments", label: "Payments" },
      ]}
    >
      <div className="space-y-4 pb-32">
        <JobHeader
          phone={detail.client?.phone ?? null}
          service={service?.name ?? null}
          when={`${formatIstDate(job.scheduled_start)} · ${formatIstTime(job.scheduled_start)}`}
          address={job.site_address}
          landmark={job.site_landmark}
          // A later job's amount stays hidden until it is this job's turn.
          quoted={job.quoted_amount != null && !waitFor ? Number(job.quoted_amount) : null}
          // The location is the reward for an approved depot check-in.
          // Directions only once the trip has started (Start trip opens them).
          mapsHref={unlocked && !waitFor && job.status === "EN_ROUTE" ? siteMaps : null}
          jobNumber={job.job_number}
          mapNote={
            job.status === "COMPLETED"
              ? "Job finished"
              : waitFor
                ? "Opens after the earlier job"
                : !unlocked
                  ? "Map opens after check-in"
                  : ["ASSIGNED", "CHECKED_IN"].includes(job.status)
                    ? "Start trip opens the map"
                    : "You are at the site"
          }
        />
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
          waitFor={waitFor}
          mapsUrl={unlocked && !waitFor ? siteMaps : null}
          next={next}
          unpaid={canCollect && !paid?.length}
        />
        {canCollect && paid?.length ? (
          <section className="sheet -mx-4 px-4 py-4">
            <h2 className="text-lg font-semibold text-ok-700">Payment marked</h2>
            <ul className="mt-1 text-sm text-ok-700">
              {paid.map((p) => (
                <li key={p.id}>
                  {p.mode === "upi" ? "UPI" : "Cash"} {rupees(p.amount)}
                  {p.mode === "upi"
                    ? p.verified_at
                      ? " · checked by office"
                      : p.proof_kind === "call"
                        ? p.proof_confirmed_at
                          ? " · confirmed on call"
                          : " · waiting for the office to confirm on call"
                        : p.proof_kind
                          ? " · proof added, office to check"
                          : " · office to check"
                    : " · with you"}
                </li>
              ))}
            </ul>
            {paid[0].note ? <p className="mt-1 text-sm text-ok-700">Note: {paid[0].note}</p> : null}
            {callPending && office ? (
              <a
                href={`tel:${office.phone.replace(/[^\d+]/g, "")}`}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-950 font-semibold text-white active:bg-brand-900"
              >
                Call {office.full_name} to confirm
              </a>
            ) : null}
            <p className="mt-2 text-xs text-ok-700">Wrong? Call the office. They can cancel it so you can mark it again.</p>
          </section>
        ) : canCollect ? (
          <CollectPayment
            jobId={job.id}
            jobNumber={job.job_number}
            quoted={job.quoted_amount != null ? Number(job.quoted_amount) : null}
            upi={(upiSetting?.value as { id: string; name: string } | undefined) ?? null}
            workers={workers ?? []}
            office={office}
          />
        ) : null}
        {waitFor ? (
          <p className="flex items-center gap-2 px-1 text-sm text-slate-600">
            <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" />
            </svg>
            The job size and amount show once {waitFor.client} is finished.
          </p>
        ) : (
          <JobDetailView detail={detail} hideSummary />
        )}
      </div>
    </AppShell>
  );
}

function mapsLink(address: string, pin: { lat: number; lng: number } | null): string {
  // Hand off to whichever map app the supervisor already knows. Building a
  // turn-by-turn view would be worse than Google's in every respect. The pin
  // goes first: it is what the rep placed (often pasted from the client's own
  // WhatsApp location), and Indian street addresses rarely geocode exactly.
  const q = pin ? `${pin.lat},${pin.lng}` : encodeURIComponent(address);
  return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=two-wheeler`;
}

/** Who, what, when and where, with the two things a supervisor taps most. */
function JobHeader({
  phone,
  service,
  when,
  address,
  landmark,
  quoted,
  mapsHref,
  mapNote,
  jobNumber,
}: {
  phone: string | null;
  service: string | null;
  when: string;
  address: string;
  landmark: string | null;
  quoted: number | null;
  mapsHref: string | null;
  /** Shown in place of Navigate when there is no map to open. */
  mapNote: string;
  jobNumber: string;
}) {
  return (
    <section className="-mx-4 -mt-4">
      {/* Continues the app bar: who and when, on the shift colour. */}
      <div className="bg-brand-950 px-4 pb-5 pt-1 text-white">
        <p className="text-[0.9375rem] font-medium tabular-nums text-white/90">
          {when}
          {quoted != null ? <span className="text-white/60"> · </span> : null}
          {quoted != null ? rupees(quoted) : null}
        </p>
        <p className="mt-0.5 text-[0.8125rem] text-white/70">
          {service ?? "Job"} · {jobNumber}
        </p>
      </div>
      <div className="sheet space-y-4 border-t-0 px-4 py-4">
        <p className="flex items-start gap-2 text-sm text-slate-700">
          <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 text-brand-700" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
          </svg>
          <span>
            {address}
            {landmark ? <span className="block text-slate-500">{landmark}</span> : null}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-brand-950/15 text-[0.9375rem] font-semibold text-brand-950 active:bg-brand-50"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m3 11 18-8-8 18-2-8-8-2Z" />
              </svg>
              Navigate
            </a>
          ) : (
            <span className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-brand-950/10 px-2 text-center text-xs font-medium text-slate-500">
              {mapNote}
            </span>
          )}
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-brand-950/15 text-[0.9375rem] font-semibold text-brand-950 active:bg-brand-50"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
              </svg>
              Call client
            </a>
          ) : (
            <span className="flex h-12 items-center justify-center rounded-lg border border-brand-950/10 text-xs font-medium text-slate-500">
              No phone number
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
