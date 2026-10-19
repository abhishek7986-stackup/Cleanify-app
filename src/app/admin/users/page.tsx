import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Today" },
  { href: "/sales/approvals", label: "Approvals" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/services", label: "Services" },
];

export default async function UsersPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, is_active, base_address")
    .order("role");

  const staff = data ?? [];

  return (
    <AppShell profile={profile} title="Staff" nav={NAV}>
      <div className="space-y-3">
        <p className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
          Adding and editing staff from here arrives in <b>Milestone 5</b>. For
          now use <code className="rounded bg-white px-1">npm run seed:users</code>,
          or the <code className="rounded bg-white px-1">admin_upsert_staff</code> function
          in the SQL editor — both are already built.
        </p>

        <ul className="space-y-2">
          {staff.map((s) => (
            <li key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{s.full_name}</p>
                  <p className="text-sm text-slate-500">{s.phone ?? "no phone"}</p>
                  {s.base_address ? (
                    <p className="mt-1 text-xs text-slate-400">Depot: {s.base_address}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {s.role.replace("_", " ")}
                  </span>
                  {!s.is_active ? (
                    <span className="rounded-full bg-danger-100 px-2 py-0.5 text-xs font-semibold text-danger-700">
                      inactive
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
