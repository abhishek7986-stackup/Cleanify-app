import { requireRole } from "@/lib/data/session";
import { getServicesWithSchemas } from "@/lib/data/services";
import { AppShell } from "@/components/AppShell";

export const metadata = { title: "Services" };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Today" },
  { href: "/sales/approvals", label: "Approvals" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/services", label: "Services" },
];

export default async function ServicesPage() {
  const profile = await requireRole("admin");
  const services = await getServicesWithSchemas();

  return (
    <AppShell profile={profile} title="Services" nav={NAV}>
      <div className="space-y-3">
        <p className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
          The drag-and-drop field builder is <b>Milestone 5</b>. The data model
          behind it is already live — these fields are rows, not code, and a new
          service can be added today by inserting into{" "}
          <code className="rounded bg-white px-1">service_fields</code> with no deploy.
        </p>

        {services.map((s) => (
          <section key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{s.name}</p>
                <p className="text-sm text-slate-500">{s.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                {s.default_duration_min} min
              </span>
            </div>

            <FieldList title="Job fields" fields={s.jobFields} />
            {s.has_line_items ? (
              <FieldList title={`Per ${s.line_item_singular?.toLowerCase()} fields`} fields={s.lineItemFields} />
            ) : null}
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function FieldList({
  title,
  fields,
}: {
  title: string;
  fields: { id: string; label: string; field_type: string; is_required: boolean }[];
}) {
  if (!fields.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</p>
      <ul className="mt-1 space-y-1">
        {fields.map((f) => (
          <li key={f.id} className="flex justify-between gap-3 text-sm">
            <span className="text-slate-700">
              {f.label}
              {f.is_required ? <span className="text-danger-600"> *</span> : null}
            </span>
            <span className="shrink-0 text-slate-400">{f.field_type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
