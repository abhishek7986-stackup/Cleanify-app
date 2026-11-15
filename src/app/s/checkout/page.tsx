import { getSessionUserId, requireRole } from "@/lib/data/session";
import Link from "next/link";
import { getSupervisorDay, getUnpaidFinishedJobs } from "@/lib/data/supervisor";
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
  const unpaid = openJobs === 0 && r && !r.checked_out_at ? await getUnpaidFinishedJobs(day.jobs) : [];

  return (
    <AppShell
      profile={profile}
      title="Check out"
      back="/s"
      nav={[
        { href: "/s", label: "Today" },
        { href: "/s/roadmap", label: "Roadmap" },
        { href: "/s/payments", label: "Payments" },
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
      ) : openJobs > 0 ? (
        <Notice
          title="Check-out opens after your last job"
          body={`${openJobs} job${openJobs === 1 ? " is" : "s are"} still waiting to be finished and approved. Once the last one is approved, come back here to check out.`}
        />
      ) : unpaid.length ? (
        <>
          <Notice
            title="Mark the payment first"
            body={`Check-out opens once every finished job has its payment marked. If the customer has not paid, call the office.`}
          />
          <ul className="sheet -mx-4 mt-3 divide-y divide-brand-950/[0.07]">
            {unpaid.map((u) => (
              <li key={u.id}>
                <Link href={`/s/jobs/${u.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 active:bg-slate-50">
                  <span className="min-w-0 truncate font-semibold text-slate-900">{u.name}</span>
                  <span className="shrink-0 text-sm font-semibold text-danger-700">Mark payment</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <DayPhotosFlow
          mode="checkout"
          rosterId={r.id}
          rosterDate={r.roster_date}
          startKm={startKm}
          openJobs={openJobs}
          alreadyHave={[...new Set(day.checkinPhotos.map((p) => p.kind as PhotoKind))]}
          odometerPhotoId={day.checkinPhotos.filter((p) => p.kind === "CHECKOUT_ODOMETER").at(-1)?.id ?? null}
        />
      )}
    </AppShell>
  );
}

function Notice({ title, body, ok }: { title: string; body: string; ok?: boolean }) {
  return (
    <div className="-mx-4 -mt-4">
      <section className="sheet border-t-0 px-4 py-5">
        <p className="flex items-center gap-2.5 text-lg font-semibold text-slate-900">
          <span
            className={`size-2.5 shrink-0 rounded-full ${ok ? "bg-ok-600" : "bg-amber-500"}`}
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
