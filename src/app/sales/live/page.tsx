import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { TeamMap, type TeamPin } from "@/components/TeamMap";
import { officeNav } from "@/lib/nav";
import { formatIstTime } from "@/lib/domain/checkin-policy";

export const metadata = { title: "Team now" };
export const dynamic = "force-dynamic";

const STALE_MIN = 10;

/**
 * Where the supervisors on duty are right now: their last reported position
 * while the app was open, how long ago that was, and how their day is going.
 * Refreshes itself every 30 seconds.
 */
export default async function TeamNowPage() {
  const profile = await requireRole("sales_rep");
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_locations");
  const rows = data ?? [];
  const ago = minutesAgo;
  const pins: TeamPin[] = rows
    .filter((r) => r.lat != null && r.lng != null && !r.checked_out_at)
    .map((r) => ({
      id: r.supervisor_id,
      name: r.full_name.replace(/\s*\(.*?\)\s*/g, ""),
      initials: initials(r.full_name),
      lat: Number(r.lat),
      lng: Number(r.lng),
      stale: (ago(r.recorded_at) ?? 999) > STALE_MIN,
    }));

  return (
    <AppShell profile={profile} title="Team now" nav={officeNav(profile)}>
      <AutoRefresh seconds={30} />
      <div className="space-y-4">
        {pins.length ? (
          <section className="card overflow-hidden p-1.5">
            <TeamMap pins={pins} />
          </section>
        ) : (
          <section className="card p-6 text-center">
            <p className="font-bold text-slate-900">No live positions yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Positions appear once a supervisor has checked in and has Cleanify open on their phone.
            </p>
          </section>
        )}

        <section>
          <h2 className="mb-2.5 flex items-baseline justify-between px-1">
            <span className="text-lg font-bold text-slate-900">On duty today</span>
            <span className="text-sm font-medium text-slate-500">updates every 30 s</span>
          </h2>
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
              Nobody has checked in yet today.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => {
                const mins = ago(r.recorded_at);
                const out = Boolean(r.checked_out_at);
                const status = out
                  ? { text: `Checked out ${formatIstTime(r.checked_out_at!)}`, tone: "text-slate-500", dot: "bg-slate-300" }
                  : mins == null
                    ? { text: "No position yet: app not opened since check-in", tone: "text-warn-700", dot: "bg-warn-500" }
                    : mins <= STALE_MIN
                      ? { text: mins <= 1 ? "Live · just now" : `Live · ${mins} min ago`, tone: "text-ok-700", dot: "bg-ok-600" }
                      : { text: `Last seen ${fmtAgo(mins)} ago: app closed?`, tone: "text-warn-700", dot: "bg-warn-500" };
                return (
                  <li key={r.supervisor_id} className="card flex items-center gap-3 p-4">
                    <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-950 text-sm font-bold text-white">
                      {initials(r.full_name)}
                      <span className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-white ${status.dot}`} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-900">{r.full_name}</p>
                      <p className={`truncate text-sm font-medium ${status.tone}`}>{status.text}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-slate-900">
                        {r.jobs_done}/{r.jobs_total}
                      </p>
                      <p className="text-xs text-slate-500">jobs done</p>
                    </div>
                    {r.lat != null && r.lng != null ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${r.full_name}'s position in Google Maps`}
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-900 active:bg-brand-100"
                      >
                        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
                        </svg>
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 px-1 text-xs text-slate-500">
            Phones share their position only between check-in and check-out, and only while Cleanify is open. A
            closed app or locked phone stops updates; the time shows how fresh each position is.
          </p>
        </section>
      </div>
    </AppShell>
  );
}

/** Whole minutes since a time, or null when there is none. */
function minutesAgo(iso: string | null): number | null {
  return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)) : null;
}

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function fmtAgo(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d`;
}
