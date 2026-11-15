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
      title="Check in"
      back="/s"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/payments", label: "Payments" },
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
          odometerPhotoId={
            day.checkinPhotos
              .filter((p) => p.kind === "ODOMETER" && new Date(p.captured_at_server).getTime() > since)
              .at(-1)?.id ?? null
          }
        />
      )}
    </AppShell>
  );
}

function Notice({ title, body, ok, waiting }: { title: string; body: string; ok?: boolean; waiting?: boolean }) {
  return (
    <div className="-mx-4 -mt-4">
      {waiting ? <AutoRefresh seconds={8} /> : null}
      <section className="sheet border-t-0 px-4 py-5">
        <p className="flex items-center gap-2.5 text-lg font-semibold text-slate-900">
          <span
            className={`size-2.5 shrink-0 rounded-full ${ok ? "bg-ok-600" : waiting ? "animate-pulse bg-amber-500" : "bg-slate-400"}`}
            aria-hidden
          />
          {title}
        </p>
        <p className="mt-1 text-[0.9375rem] tabular-nums text-slate-600">{body}</p>
      </section>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-950/10 bg-white px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3">
        <a
          href="/s"
          className="mx-auto flex h-14 w-full max-w-3xl items-center justify-center rounded-lg bg-brand-950 text-base font-semibold text-white active:bg-brand-900"
        >
          Back to today
        </a>
      </div>
    </div>
  );
}
