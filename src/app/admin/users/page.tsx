import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { getSignedStaffDocUrls } from "@/lib/data/staff-docs";
import { parseEwkbPoint } from "@/lib/location-link";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";
import type { StaffApplication, StaffDocument } from "@/lib/domain/database";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { JoinRequestCard, type DepotOption } from "./JoinRequestCard";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Today" },
  { href: "/sales/approvals", label: "Approvals" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/services", label: "Services" },
];

const DOC_LABEL: Record<string, string> = {
  AADHAAR_FRONT: "Aadhaar card",
  AADHAAR_BACK: "Aadhaar (back)",
  DRIVING_LICENCE: "Driving licence",
};

export default async function UsersPage() {
  const supabase = await createClient();
  const [profile, staffRes, appsRes] = await Promise.all([
    requireRole("admin"),
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active, base_address, base_location")
      .order("role"),
    supabase
      .from("staff_applications")
      .select("*, staff_documents(*)")
      .eq("status", "PENDING")
      .order("submitted_at", { ascending: true })
      .overrideTypes<(StaffApplication & { staff_documents: StaffDocument[] })[], { merge: false }>(),
  ]);

  const staff = (staffRes.data ?? []) as {
    id: string;
    full_name: string;
    phone: string | null;
    role: string;
    is_active: boolean;
    base_address: string | null;
    base_location: string | null;
  }[];
  const pending = appsRes.data ?? [];
  const pendingIds = new Set(pending.map((a) => a.user_id));
  const signed = await getSignedStaffDocUrls(
    pending.flatMap((a) => a.staff_documents.map((d) => d.storage_path)),
  );

  // Depots already in use, for one-tap assignment.
  const depots: DepotOption[] = [];
  for (const s of staff) {
    const p = parseEwkbPoint(s.base_location);
    if (!p || s.role !== "supervisor") continue;
    const label = s.base_address ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    if (!depots.some((d) => d.label === label)) depots.push({ label, ...p });
  }

  return (
    <AppShell profile={profile} title="Staff" nav={NAV}>
      <div className="space-y-4">
        {pending.length ? <AutoRefresh seconds={30} /> : null}

        <section className="space-y-3">
          <h2 className="px-1 font-semibold text-slate-900">
            Join requests {pending.length ? `(${pending.length})` : ""}
          </h2>
          {pending.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No one is waiting. New workers create their account from the sign-in screen and appear here.
            </p>
          ) : (
            pending.map((a) => (
              <JoinRequestCard
                key={a.id}
                id={a.id}
                fullName={a.full_name}
                phone={a.phone}
                address={a.address}
                submittedLabel={`applied ${formatIstDate(a.submitted_at)}, ${formatIstTime(a.submitted_at)}`}
                depots={depots}
                docs={[...a.staff_documents]
                  .sort((x, y) => (x.kind === "AADHAAR_FRONT" ? -1 : y.kind === "AADHAAR_FRONT" ? 1 : 0))
                  .map((d) => ({
                    kind: d.kind,
                    label: DOC_LABEL[d.kind] ?? d.kind,
                    url: signed[d.storage_path] ?? null,
                    isPdf: d.mime_type === "application/pdf",
                  }))}
              />
            ))
          )}
        </section>

        <section className="space-y-2">
          <h2 className="px-1 font-semibold text-slate-900">Staff</h2>
          <ul className="space-y-2">
            {staff
              .filter((s) => !pendingIds.has(s.id))
              .map((s) => (
                <li key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{s.full_name}</p>
                      <p className="text-sm text-slate-500">{s.phone ?? "no phone"}</p>
                      {s.base_address ? <p className="mt-1 text-xs text-slate-400">Depot: {s.base_address}</p> : null}
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
        </section>
      </div>
    </AppShell>
  );
}
