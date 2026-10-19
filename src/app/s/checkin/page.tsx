import { getSessionUserId, requireRole } from "@/lib/data/session";
import { getSupervisorDay } from "@/lib/data/supervisor";
import { AppShell } from "@/components/AppShell";
import { formatIstTime } from "@/lib/domain/checkin-policy";
import type { PhotoKind } from "@/lib/domain/database";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DayPhotosFlow } from "@/components/DayPhotosFlow";

export const metadata = { title: "Depot check-in" };
export const dynamic = "force-dynamic";

export default async function CheckinPage() {
  // In parallel: the user id comes from the JWT locally, so the day's data
  // need not wait for the profile row.
  const userId = (await getSessionUserId()) ?? "";
  const [profile, day] = await Promise.all([requireRole("supervisor"), getSupervisorDay(userId)]);
  const r = day.roster;

  const retake = Boolean(r?.submitted_at && r.approval_status === "REJECTED");
  // After a rejection only photos taken since then count, matching the server.
  const since = retake && r?.approved_at ? new Date(r.approved_at).getTime() : -Infinity;
  const alreadyHave = [
    ...new Set(
      day.checkinPhotos
        .filter((p) => new Date(p.captured_at_server).getTime() > since)
        .map((p) => p.kind as PhotoKind),
    ),
  ];

  return (
    <AppShell
      profile={profile}
      title="Depot check-in"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/history", label: "History" },
      ]}
    >
      {!r ? (
        <Notice title="Nothing to check in for" body="You have no jobs today." />
      ) : r.submitted_at && !retake ? (
        <Notice
          title={r.approval_status === "APPROVED" ? "Check-in approved" : "Waiting for approval"}
          body={`Checked in at ${formatIstTime(r.submitted_at)}${r.checkin_status === "LATE" ? " (late)" : ""}. ${
            r.approval_status === "APPROVED"
              ? "Your jobs are unlocked."
              : "Your jobs unlock as soon as the photos are approved."
          }`}
          ok={r.approval_status === "APPROVED"}
          waiting={r.approval_status === "PENDING"}
        />
      ) : (
        <DayPhotosFlow
          mode="checkin"
          rosterId={r.id}
          rosterDate={r.roster_date}
          deadline={r.required_checkin_at}
          retake={retake}
          rejectionReason={r.rejection_reason}
          alreadyHave={alreadyHave}
        />
      )}
    </AppShell>
  );
}

function Notice({ title, body, ok, waiting }: { title: string; body: string; ok?: boolean; waiting?: boolean }) {
  return (
    <div className="space-y-4">
      {waiting ? <AutoRefresh seconds={8} /> : null}
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
