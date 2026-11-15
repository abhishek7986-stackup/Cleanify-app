import Link from "next/link";
import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { createAdminClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { RouteMap, type RouteStop } from "@/components/RouteMap";
import { parseEwkbPoint } from "@/lib/location-link";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";

export const metadata = { title: "Roadmap" };
export const dynamic = "force-dynamic";

/**
 * The day as a route: depot, then each job in the order of its booked time.
 *
 * Locations are the reward for an approved depot check-in, the same rule as
 * the job screen, so the map and "Start route" open only after approval.
 * Before that the list still shows times and addresses, as Today does.
 */
export default async function RoadmapPage() {
  // In parallel: the user id comes from the JWT locally, so the day's data
  // need not wait for the profile row.
  const userId = (await getSessionUserId()) ?? "";
  const [profile, day, depot] = await Promise.all([
    requireRole("supervisor"),
    getSupervisorDay(userId),
    ownDepot(userId),
  ]);

  const unlocked = day.roster?.approval_status === "APPROVED";
  const active = day.jobs.filter((j) => !["CANCELLED", "NO_SHOW", "DRAFT"].includes(j.status));
  const stops: (RouteStop & { job: (typeof active)[number] })[] = [];
  active.forEach((job, i) => {
    const pin = parseEwkbPoint(job.site_location);
    if (pin) stops.push({ id: job.id, n: i + 1, lat: pin.lat, lng: pin.lng, done: job.status === "COMPLETED", job });
  });
  const remaining = stops.filter((s) => !s.done);
  const routeHref = remaining.length ? googleRoute(remaining) : null;

  return (
    <AppShell
      profile={profile}
      title="Roadmap"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
        { href: "/s/payments", label: "Payments" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex items-baseline justify-between px-1">
          <p className="text-sm font-medium text-slate-500">{formatIstDate(day.date)}</p>
          {day.roster?.depart_by ? (
            <p className="text-sm text-slate-500">
              Leave by <b className="text-slate-900">{formatIstTime(day.roster.depart_by)}</b>
            </p>
          ) : null}
        </div>

        {active.length === 0 ? (
          <p className="card p-8 text-center text-slate-500">No stops today.</p>
        ) : unlocked && stops.length ? (
          <section className="card overflow-hidden p-1.5">
            <RouteMap stops={stops.map(({ id, n, lat, lng, done }) => ({ id, n, lat, lng, done }))} depot={depot} />
            <div className="p-3.5 pt-3">
              {routeHref ? (
                <a
                  href={routeHref}
                  target="_blank"
                  rel="noreferrer"
                  className="tap-lg flex items-center justify-center gap-2 rounded-2xl bg-brand-900 text-base font-bold text-white active:scale-[0.98]"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m3 11 18-8-8 18-2-8-8-2Z" />
                  </svg>
                  Start route · {remaining.length} stop{remaining.length === 1 ? "" : "s"}
                </a>
              ) : (
                <p className="flex items-center justify-center gap-2 py-2 text-sm font-semibold text-ok-700">
                  All stops done today
                </p>
              )}
              <p className="mt-2 text-center text-xs text-slate-500">
                Opens Google Maps with every stop in order, from where you are now.
              </p>
            </div>
          </section>
        ) : (
          <section className="card flex items-center gap-3 p-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-canvas text-slate-500">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="font-bold text-slate-900">
                {unlocked ? "No map pins on today's jobs" : "Map opens after check-in"}
              </p>
              <p className="text-sm text-slate-500">
                {unlocked
                  ? "Ask the office to add the location pin to each job."
                  : "Once the office approves your depot photos, the route and directions appear here."}
              </p>
            </div>
          </section>
        )}

        {active.length ? (
          <ol className="relative space-y-3">
            {/* The thread joining the stops, under the numbered dots. */}
            <span aria-hidden className="absolute bottom-6 left-[17px] top-6 w-0.5 bg-slate-900/10" />
            {active.map((job, i) => {
              const done = job.status === "COMPLETED";
              return (
                <li key={job.id} className="relative flex items-start gap-3">
                  <span
                    className={`relative z-10 mt-4 flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-4 ring-canvas ${
                      done ? "bg-ok-600 text-white" : "bg-brand-950 text-white"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <Link href={`/s/jobs/${job.id}`} className={`card block min-w-0 flex-1 p-4 active:scale-[0.99] ${done ? "opacity-70" : ""}`}>
                    <p className="text-sm font-medium text-slate-500">
                      {formatIstTime(job.scheduled_start)}
                      {job.travel_minutes != null ? ` · ~${job.travel_minutes} min drive` : ""}
                    </p>
                    <p className="truncate font-bold text-slate-900">{job.client?.name ?? "Client"}</p>
                    <p className="truncate text-sm text-slate-500">{job.site_address}</p>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </AppShell>
  );
}

/** This supervisor's own depot. The column is admin-only, so read it server-side. */
async function ownDepot(userId: string): Promise<{ lat: number; lng: number } | null> {
  if (!userId) return null;
  const { data } = await createAdminClient().from("profiles").select("base_location").eq("id", userId).maybeSingle();
  return parseEwkbPoint(data?.base_location ?? null);
}

/**
 * Google Maps directions through every remaining stop, in order. No origin,
 * so it starts from wherever the phone is. Free: it is a link, not an API call.
 */
function googleRoute(stops: { lat: number; lng: number }[]): string {
  const pt = (s: { lat: number; lng: number }) => `${s.lat},${s.lng}`;
  const dest = stops[stops.length - 1];
  const via = stops.slice(0, -1).map(pt).join("|");
  const q = new URLSearchParams({ api: "1", destination: pt(dest), travelmode: "driving" });
  if (via) q.set("waypoints", via);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
