import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { AppShell } from "@/components/AppShell";
import { DayPhotosFlow } from "@/components/DayPhotosFlow";
import { formatIstTime } from "@/lib/domain/checkin-policy";
import type { PhotoKind } from "@/lib/domain/database";

export const metadata = { title: "Check out" };
export const dynamic = "force-dynamic";

const DONE_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW", "DRAFT"];

export default async function CheckoutPage() {
  const userId = (await getSessionUserId()) ?? "";
  const [profile, day] = await Promise.all([requireRole("supervisor"), getSupervisorDay(userId)]);
  const r = day.roster;
  const startKm = r?.start_odometer_km != null ? Number(r.start_odometer_km) : null;
  const openJobs = day.jobs.filter((j) => !DONE_STATUSES.includes(j.status)).length;

  return (
    <AppShell
      profile={profile}
      title="Check out"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
      ]}
    >
      {!r?.submitted_at ? (
        <Notice title="You have not checked in today" body="Check-out is for the end of a day you checked in." />
      ) : r.checked_out_at ? (
        <Notice
          ok
          title="Checked out"
          body={`At ${formatIstTime(r.checked_out_at)}${
            r.end_odometer_km != null && startKm != null
              ? ` · ${Number(r.end_odometer_km) - startKm} km today`
              : ""
          }.`}
        />
      ) : (
        <DayPhotosFlow
          mode="checkout"
          rosterId={r.id}
          rosterDate={r.roster_date}
          startKm={startKm}
          openJobs={openJobs}
          alreadyHave={[...new Set(day.checkinPhotos.map((p) => p.kind as PhotoKind))]}
        />
      )}
    </AppShell>
  );
}

function Notice({ title, body, ok }: { title: string; body: string; ok?: boolean }) {
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-5 ${ok ? "border-ok-100 bg-ok-50" : "border-slate-200 bg-white"}`}>
        <p className={`text-lg font-semibold ${ok ? "text-ok-700" : "text-slate-900"}`}>{title}</p>
        <p className={`mt-1 ${ok ? "text-ok-700" : "text-slate-600"}`}>{body}</p>
      </div>
      <a
        href="/s"
        className="tap-lg flex items-center justify-center rounded-2xl border-2 border-slate-300 font-semibold"
      >
        Back to today
      </a>
    </div>
  );
}
