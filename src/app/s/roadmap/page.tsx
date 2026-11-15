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

  // Each leg of the day as the deadlines chain it: depot -> stop 1, then the
  // previous site -> the next stop.
  const legs = active.map((job, i) => {
    const to = parseEwkbPoint(job.site_location);
    const fromPin = i === 0 ? depot : parseEwkbPoint(active[i - 1].site_location);
    const km = to && fromPin ? roadKm(fromPin, to) : null;
    return {
      from: i === 0 ? "Depot" : (active[i - 1].client?.name ?? `Stop ${i}`),
      km,
      minutes: job.travel_minutes,
      estimated: job.deadline_state !== "ok",
    };
  });
  const totalKm = legs.reduce((a, l) => a + (l.km ?? 0), 0);
  const totalMin = legs.reduce((a, l) => a + (l.minutes ?? 0), 0);
  const nextId = active.find((j) => j.status !== "COMPLETED")?.id ?? null;

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
        <section className="grid grid-cols-3 gap-px overflow-hidden rounded-3xl bg-slate-900/[0.06] ring-1 ring-slate-900/[0.06]">
          <Stat label={formatIstDate(day.date)} value={`${active.length} stop${active.length === 1 ? "" : "s"}`} />
          <Stat label="Riding" value={totalKm ? `≈ ${fmtKm(totalKm)}` : "—"} sub={totalMin ? `~${fmtMin(totalMin)}` : undefined} />
          <Stat
            label="Leave depot"
            value={day.roster?.depart_by ? formatIstTime(day.roster.depart_by) : "—"}
          />
        </section>

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
                  className="tap flex items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-slate-700 ring-1 ring-slate-900/10 active:bg-slate-50"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4ZM9 4v13M15 6.5v13" />
                  </svg>
                  See the whole route · {remaining.length} stop{remaining.length === 1 ? "" : "s"}
                </a>
              ) : (
                <p className="flex items-center justify-center gap-2 py-2 text-sm font-semibold text-ok-700">
                  All stops done today
                </p>
              )}
              <p className="mt-2 text-center text-xs text-slate-500">
                Just to look at the day. For directions, use Navigate here on the next stop.
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
          <ol>
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-900 ring-1 ring-slate-900/10">
                <Glyph d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />
              </span>
              <p className="text-sm font-semibold text-slate-700">
                Start at the depot
                {day.roster?.depart_by ? (
                  <span className="font-normal text-slate-500"> · leave by {formatIstTime(day.roster.depart_by)}</span>
                ) : null}
              </p>
            </li>
            {active.map((job, i) => {
              const done = job.status === "COMPLETED";
              const isNext = job.id === nextId;
              const leg = legs[i];
              const pin = parseEwkbPoint(job.site_location);
              return (
                <li key={job.id}>
                  {/* The leg into this stop. */}
                  <div className="flex items-stretch gap-3">
                    <span className="flex w-9 shrink-0 justify-center" aria-hidden>
                      <span className={`my-1 w-0.5 border-l-2 border-dashed ${done ? "border-ok-600/40" : "border-brand-900/25"}`} />
                    </span>
                    <div className="my-2 flex min-w-0 flex-1 items-center gap-2 text-xs">
                      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-900/10">
                        <Glyph small d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM7 17h8M17 17l-2-6h-4l-1 3M9 8h3l1 3" />
                        {leg.km != null ? `≈ ${fmtKm(leg.km)}` : "Distance unknown"}
                        {leg.minutes != null ? ` · ~${fmtMin(leg.minutes)}` : ""}
                      </span>
                      <span className="truncate text-slate-400">
                        from {leg.from}
                        {leg.estimated ? " · estimate" : ""}
                      </span>
                    </div>
                  </div>

                  {/* The stop. */}
                  <div className="flex items-start gap-3">
                    <span
                      className={`relative z-10 mt-4 flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        done ? "bg-ok-600 text-white" : isNext ? "bg-brand-900 text-white ring-4 ring-brand-100" : "bg-white text-slate-500 ring-1 ring-slate-900/10"
                      }`}
                    >
                      {done ? <Glyph small d="m5 12.5 4.5 4.5L19 7.5" /> : i + 1}
                    </span>
                    <div className={`card min-w-0 flex-1 overflow-hidden ${done ? "opacity-70" : ""} ${isNext ? "ring-2 ring-brand-900" : ""}`}>
                      <Link href={`/s/jobs/${job.id}`} className="block p-4 active:bg-slate-50">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-500">{formatIstTime(job.scheduled_start)}</p>
                          {isNext ? (
                            <span className="rounded-full bg-brand-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Next</span>
                          ) : done ? (
                            <span className="text-xs font-semibold text-ok-700">Done</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate font-bold text-slate-900">{job.client?.name ?? "Client"}</p>
                        <p className="truncate text-sm text-slate-500">{job.site_address}</p>
                      </Link>
                      {isNext && unlocked && pin ? (
                        <a
                          href={googleRoute([pin])}
                          target="_blank"
                          rel="noreferrer"
                          className="tap-lg flex items-center justify-center gap-2 bg-brand-900 text-base font-bold text-white active:bg-brand-950"
                        >
                          <Glyph d="m3 11 18-8-8 18-2-8-8-2Z" />
                          Navigate here
                        </a>
                      ) : null}
                    </div>
                  </div>
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
  // Supervisors ride scooters; Google Maps routes two-wheelers in India.
  const q = new URLSearchParams({ api: "1", destination: pt(dest), travelmode: "two-wheeler" });
  if (via) q.set("waypoints", via);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/**
 * Approximate road distance: straight line x 1.3, the usual detour factor for
 * city roads. Shown as "≈" because it is an estimate, not a routed distance.
 */
function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.3;
}

function fmtKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function fmtMin(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white px-3 py-3">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900">{value}</p>
      {sub ? <p className="text-xs font-medium tabular-nums text-slate-500">{sub}</p> : null}
    </div>
  );
}

/** A line icon; `d` is the SVG path. */
function Glyph({ d, small }: { d: string; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${small ? "size-4" : "size-5"} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
