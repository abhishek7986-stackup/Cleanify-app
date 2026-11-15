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
  const nextJob = active.find((j) => j.status !== "COMPLETED") ?? null;
  const nextId = nextJob?.id ?? null;
  const nextPin = nextJob ? parseEwkbPoint(nextJob.site_location) : null;
  const nextName = nextJob?.client?.name?.replace(/\s*\(.*?\)\s*/g, "") ?? "the next stop";

  return (
    <AppShell
      profile={profile}
      title="Roadmap"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/payments", label: "Payments" },
      ]}
      action={
        nextPin && unlocked ? (
          <a
            href={googleRoute([nextPin])}
            target="_blank"
            rel="noreferrer"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-950 text-base font-semibold text-white active:bg-brand-900"
          >
            <Glyph d="m3 11 18-8-8 18-2-8-8-2Z" />
            Navigate to {nextName}
          </a>
        ) : undefined
      }
      status={
        <dl className="grid grid-cols-3 divide-x divide-white/15 rounded-lg bg-white/[0.08] py-2 text-white">
          <Stat label={formatIstDate(day.date)} value={`${active.length} stop${active.length === 1 ? "" : "s"}`} />
          <Stat label={totalMin ? `Riding · ~${fmtMin(totalMin)}` : "Riding"} value={totalKm ? `≈ ${fmtKm(totalKm)}` : "—"} />
          <Stat label="Leave depot" value={day.roster?.depart_by ? formatIstTime(day.roster.depart_by) : "—"} />
        </dl>
      }
    >
      <div className="space-y-4">

        {active.length === 0 ? (
          <section className="sheet -mx-4 -mt-4 border-t-0 px-4 py-6">
            <p className="text-lg font-semibold text-slate-900">No stops today</p>
            <p className="mt-1 text-sm text-slate-600">Nothing is booked for you today.</p>
          </section>
        ) : unlocked && stops.length ? (
          <section className="-mx-4 -mt-4">
            <RouteMap flush stops={stops.map(({ id, n, lat, lng, done }) => ({ id, n, lat, lng, done }))} depot={depot} />
            {routeHref ? (
              <a
                href={routeHref}
                target="_blank"
                rel="noreferrer"
                className="sheet flex min-h-12 items-center justify-between border-t-0 px-4 text-[0.9375rem] font-medium text-slate-700 active:bg-slate-50"
              >
                <span className="flex items-center gap-2">
                  <Glyph small d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4ZM9 4v13M15 6.5v13" />
                  Open the whole route in Google Maps
                </span>
                <Glyph small d="m9 5 7 7-7 7" />
              </a>
            ) : null}
          </section>
        ) : (
          <section className="sheet -mx-4 -mt-4 border-t-0 px-4 py-5">
            <p className="flex items-center gap-2.5 text-lg font-semibold text-slate-900">
              <span className="size-2.5 rounded-full bg-amber-500" aria-hidden />
              {unlocked ? "No map pins on today's jobs" : "Map opens after check-in"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {unlocked
                ? "Ask the office to add the location pin to each job."
                : "Once the office approves your depot photos, the route and directions appear here."}
            </p>
          </section>
        )}

        {active.length ? (
          <section className="-mx-4">
            <p className="section-label px-4 pb-2">Stops in order</p>
            <ol className="sheet divide-y divide-brand-950/[0.07]">
              <li className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  <Glyph small d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">Depot</p>
                  <p className="text-sm tabular-nums text-slate-600">
                    {day.roster?.depart_by ? `Leave by ${formatIstTime(day.roster.depart_by)}` : "Start of the day"}
                  </p>
                </div>
              </li>
              {active.map((job, i) => {
                const done = job.status === "COMPLETED";
                const isNext = job.id === nextId;
                const leg = legs[i];
                return (
                  <li key={job.id}>
                    <Link href={`/s/jobs/${job.id}`} className={`flex items-center gap-3 px-4 py-3 active:bg-slate-50 ${isNext ? "bg-brand-50/60" : ""}`}>
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                          done ? "bg-ok-600 text-white" : isNext ? "bg-brand-950 text-white" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {done ? <Glyph small d="m5 12.5 4.5 4.5L19 7.5" /> : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate font-semibold ${done ? "text-slate-500" : "text-slate-900"}`}>
                          {job.client?.name ?? "Client"}
                          {isNext ? <span className="font-medium text-brand-950"> · next</span> : null}
                        </p>
                        <p className="truncate text-sm text-slate-600">{job.site_address}</p>
                        <p className="text-sm tabular-nums text-slate-600">
                          {leg.km != null ? `≈ ${fmtKm(leg.km)}` : "Distance unknown"}
                          {leg.minutes != null ? ` · ~${fmtMin(leg.minutes)}` : ""} from {leg.from}
                          {leg.estimated ? " (estimate)" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                        {formatIstTime(job.scheduled_start)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
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

/** One figure in the app bar's shift strip. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 px-3">
      <dt className="truncate text-[0.6875rem] font-medium text-white/60">{label}</dt>
      <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular-nums">
        {value}
        {sub ? <span className="font-normal text-white/60"> {sub}</span> : null}
      </dd>
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
