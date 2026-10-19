import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { istDate, formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";

export const metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const profile = await requireRole("supervisor");
  const supabase = await createClient();
  const today = istDate();

  const { data } = await supabase
    .from("jobs")
    .select("id, job_number, status, scheduled_start, service_date, site_address, client:clients(name)")
    .eq("assigned_supervisor_id", profile.id)
    .lt("service_date", today)
    .order("scheduled_start", { ascending: false })
    .limit(40)
    .overrideTypes<
      {
        id: string; job_number: string; status: string; scheduled_start: string;
        service_date: string; site_address: string; client: { name: string } | null;
      }[],
      { merge: false }
    >();

  const jobs = data ?? [];
  const byDay = new Map<string, typeof jobs>();
  for (const j of jobs) {
    if (!byDay.has(j.service_date)) byDay.set(j.service_date, []);
    byDay.get(j.service_date)!.push(j);
  }

  return (
    <AppShell
      profile={profile}
      title="History"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
      ]}
    >
      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          Nothing in the past yet.
        </p>
      ) : (
        <div className="space-y-5">
          {[...byDay.entries()].map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 px-1 text-sm font-semibold text-slate-500">
                {formatIstDate(`${day}T00:00:00+05:30`)}
              </h2>
              <ul className="space-y-2">
                {rows.map((j) => (
                  <li key={j.id}>
                    <Link href={`/s/jobs/${j.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{j.client?.name ?? j.job_number}</p>
                        <p className="truncate text-sm text-slate-500">
                          {formatIstTime(j.scheduled_start)} · {j.site_address}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {j.status.replace("_", " ").toLowerCase()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
