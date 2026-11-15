import { createClient } from "@/lib/supabase/server";
import { formatIstDate, formatIstTime, istDate } from "@/lib/domain/checkin-policy";

type Roster = {
  id: string;
  supervisor_id: string;
  roster_date: string;
  submitted_at: string | null;
  required_checkin_at: string | null;
  checkin_status: string | null;
  approval_status: string;
  start_odometer_km: string | null;
  end_odometer_km: string | null;
  checked_out_at: string | null;
};

const SELECT =
  "id, supervisor_id, roster_date, submitted_at, required_checkin_at, checkin_status, approval_status, start_odometer_km, end_odometer_km, checked_out_at";

/**
 * For the office: each supervisor's check-in and check-out on a day, and any
 * recent day someone never checked out of. Check-out is only possible on the
 * day itself, so a missed one stays visible here.
 */
export async function ShiftTimes({ date }: { date: string }) {
  const supabase = await createClient();
  const today = istDate();
  const weekAgo = istDate(new Date(Date.parse(`${today}T12:00:00+05:30`) - 7 * 86_400_000));
  const [dayRes, missedRes, staffRes] = await Promise.all([
    supabase.from("day_rosters").select(SELECT).eq("roster_date", date).overrideTypes<Roster[], { merge: false }>(),
    supabase
      .from("day_rosters")
      .select(SELECT)
      .gte("roster_date", weekAgo)
      .lt("roster_date", today)
      .not("submitted_at", "is", null)
      .is("checked_out_at", null)
      .order("roster_date", { ascending: false })
      .overrideTypes<Roster[], { merge: false }>(),
    supabase.from("staff_directory").select("id, full_name"),
  ]);
  const nameOf = (id: string) => (staffRes.data ?? []).find((s) => s.id === id)?.full_name ?? "Supervisor";
  const rosters = dayRes.data ?? [];
  const missed = (missedRes.data ?? []).filter((r) => r.roster_date !== date);
  const past = date < today;
  const now = currentTime();
  if (!rosters.length && !missed.length) return null;

  return (
    <section>
      {rosters.length ? (
        <>
          <p className="section-label pb-2">Supervisors {date === today ? "today" : `on ${formatIstDate(`${date}T12:00:00+05:30`)}`}</p>
          <ul className="sheet -mx-4 divide-y divide-brand-950/[0.07]">
            {rosters.map((r) => {
              const start = r.start_odometer_km != null ? Number(r.start_odometer_km) : null;
              const end = r.end_odometer_km != null ? Number(r.end_odometer_km) : null;
              const lateIn = !r.submitted_at && (past || (r.required_checkin_at != null && Date.parse(r.required_checkin_at) < now));
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-slate-900">{nameOf(r.supervisor_id)}</p>
                    <p className="shrink-0 text-sm tabular-nums text-slate-600">
                      {start != null && end != null ? `${end - start} km` : start != null ? `from ${start} km` : ""}
                    </p>
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Check-in</dt>
                      <dd className={`font-medium tabular-nums ${r.submitted_at ? "text-slate-900" : lateIn ? "text-danger-700" : "text-slate-500"}`}>
                        {r.submitted_at
                          ? `${formatIstTime(r.submitted_at)}${r.checkin_status === "LATE" ? " · late" : ""}${
                              r.approval_status === "PENDING" ? " · waiting" : r.approval_status === "REJECTED" ? " · rejected" : ""
                            }`
                          : lateIn
                            ? "Not checked in"
                            : "Not yet"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Check-out</dt>
                      <dd
                        className={`font-medium tabular-nums ${
                          r.checked_out_at ? "text-slate-900" : !r.submitted_at ? "text-slate-400" : past ? "text-danger-700" : "text-amber-700"
                        }`}
                      >
                        {r.checked_out_at
                          ? formatIstTime(r.checked_out_at)
                          : !r.submitted_at
                            ? "—"
                            : past
                              ? "Did not check out"
                              : "Not checked out yet"}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {missed.length ? (
        <>
          <p className="section-label pb-2 pt-4 text-danger-700">Did not check out</p>
          <ul className="sheet -mx-4 divide-y divide-brand-950/[0.07]">
            {missed.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate font-semibold text-slate-900">{nameOf(r.supervisor_id)}</span>
                <span className="shrink-0 text-sm tabular-nums text-slate-600">
                  {formatIstDate(`${r.roster_date}T12:00:00+05:30`)} · in {formatIstTime(r.submitted_at!)}
                </span>
              </li>
            ))}
          </ul>
          <p className="pt-2 text-xs text-slate-500">Days in the last week with a check-in but no check-out.</p>
        </>
      ) : null}
    </section>
  );
}

/** Read once per request, outside rendering. */
function currentTime() {
  return Date.now();
}
