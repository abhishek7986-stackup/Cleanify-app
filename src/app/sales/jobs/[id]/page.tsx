import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { getJobDetail } from "@/lib/data/jobs";
import { getReasons, getSupervisors } from "@/lib/data/services";
import { AppShell } from "@/components/AppShell";
import { JobDetailView } from "@/components/JobDetailView";
import { JobActions } from "./JobActions";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/sales/jobs/[id]">) {
  const { id } = await props.params;
  const detail = await getJobDetail(id);
  return { title: detail?.job.job_number ?? "Job" };
}

export default async function SalesJobPage(props: PageProps<"/sales/jobs/[id]">) {
  const { id } = await props.params;
  const profile = await requireRole("sales_rep");
  const detail = await getJobDetail(id);
  if (!detail) notFound();

  const [rescheduleReasons, cancelReasons, supervisors] = await Promise.all([
    getReasons("reschedule"),
    getReasons("cancellation"),
    getSupervisors(),
  ]);

  return (
    <AppShell
      profile={profile}
      title={detail.job.job_number}
      nav={[
        { href: "/sales", label: "Today" },
        { href: "/sales/new", label: "New job" },
        { href: "/sales/approvals", label: "Approvals" },
      ]}
    >
      <div className="space-y-4">
        <JobActions
          job={detail.job}
          supervisors={supervisors}
          rescheduleReasons={rescheduleReasons}
          cancelReasons={cancelReasons}
        />
        <JobDetailView detail={detail} showAudit />
      </div>
    </AppShell>
  );
}
