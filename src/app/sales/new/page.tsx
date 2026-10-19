import { requireRole } from "@/lib/data/session";
import { getServicesWithSchemas, getSupervisors } from "@/lib/data/services";
import { AppShell } from "@/components/AppShell";
import { NewJobWizard } from "./NewJobWizard";

export const metadata = { title: "New job" };
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const profile = await requireRole("sales_rep");
  const [services, supervisors] = await Promise.all([
    getServicesWithSchemas(),
    getSupervisors(),
  ]);

  return (
    <AppShell
      profile={profile}
      title="New job"
      nav={[
        { href: "/sales", label: "Today" },
        { href: "/sales/new", label: "New job" },
        { href: "/sales/approvals", label: "Approvals" },
      ]}
    >
      <NewJobWizard services={services} supervisors={supervisors} />
    </AppShell>
  );
}
