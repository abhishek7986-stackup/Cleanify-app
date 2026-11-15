"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ApprovalStatus, JobStatus, ServiceField } from "@/lib/domain/database";
import { LiveCameraCapture } from "@/components/LiveCameraCapture";
import { AutoRefresh } from "@/components/AutoRefresh";
import {
  DynamicServiceForm,
  validateFields,
  visibleValues,
  type FieldValues,
} from "@/components/DynamicServiceForm";
import { getBestFix } from "@/lib/geolocation";
import { flushUploadQueue, listQueue } from "@/lib/upload-queue";
import { formatIstTime } from "@/lib/domain/checkin-policy";

/**
 * ============================================================================
 * Supervisor job steps
 * ============================================================================
 *
 *   depot check-in approved  ->  Start trip / I've reached
 *   before photos + tank details  ->  approval  ->  Start cleaning
 *   after photos (+ optional note)  ->  approval  ->  completed
 *
 * One big button for whatever is next. The rules themselves live in the
 * database (advance_job_status, submit_site_photos, review_site_photos);
 * this screen only offers the step that is legal now.
 *
 * "I've reached" is offered from every pre-arrival state and never checks
 * distance: the client's shared pin is often wrong and gets corrected over a
 * phone call. Where they actually were is recorded for the admin instead.
 */

type Shot = "none" | "saved" | "queued";

export type FlowUnit = {
  id: string;
  label: string;
  details: FieldValues;
  before: Shot;
  after: Shot;
};

type Review = { status: ApprovalStatus | null; reason: string | null };

export function JobFlow({
  jobId,
  initialStatus,
  depot,
  units: initialUnits,
  unitFields,
  unitNoun,
  before,
  after,
  completedAt,
  waitFor = null,
}: {
  jobId: string;
  initialStatus: JobStatus;
  /** The day's depot check-in: not sent, waiting, approved or rejected. */
  depot: "none" | ApprovalStatus;
  units: FlowUnit[];
  unitFields: ServiceField[];
  unitNoun: string;
  before: Review;
  after: Review;
  completedAt: string | null;
  /** An earlier job today that is still open; this one waits for it. */
  waitFor?: { jobNumber: string; client: string } | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [units, setUnits] = useState(initialUnits);
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [camera, setCamera] = useState<{ unit: FlowUnit; kind: "SITE_BEFORE" | "SITE_AFTER" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"before" | "after" | null>(null);

  const noun = unitNoun.toLowerCase();
  const supabase = createClient();

  /* -------------------------------------------------------------- actions */
  async function advance(path: JobStatus[], label: string, meta: Record<string, unknown> = {}) {
    setError(null);
    setBusy(label);
    for (const to of path) {
      const { error: err } = await supabase.rpc("advance_job_status", {
        p_job_id: jobId,
        p_to: to,
        p_meta: meta,
      });
      if (err) {
        setBusy(null);
        setError(err.message);
        router.refresh();
        return;
      }
      setStatus(to);
    }
    setBusy(null);
    router.refresh();
  }

  async function reached() {
    setError(null);
    setBusy("Getting your location…");
    // A few seconds at most: no fix is still a valid "reached".
    const fix = await getBestFix({ timeoutMs: 8000, samples: 2 });
    const meta = fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: Math.round(fix.accuracyM) } : {};
    const path: JobStatus[] =
      status === "ASSIGNED"
        ? ["CHECKED_IN", "EN_ROUTE", "ON_SITE"]
        : status === "CHECKED_IN"
          ? ["EN_ROUTE", "ON_SITE"]
          : ["ON_SITE"];
    // Only the final step carries the location.
    if (path.length > 1) {
      await advance(path.slice(0, -1), "Marking reached…");
    }
    await advance(["ON_SITE"], "Marking reached…", meta);
  }

  async function uploadQueued(): Promise<boolean> {
    const pending = units.some((u) => u.before === "queued" || u.after === "queued");
    if (!pending) return true;
    setBusy("Uploading photos…");
    await flushUploadQueue();
    const ids = new Set(units.map((u) => u.id));
    const left = (await listQueue()).filter((q) => q.lineItemId && ids.has(q.lineItemId));
    setBusy(null);
    if (left.length) {
      setError("Some photos are saved on this phone but not uploaded yet. Move to where there is signal and try again.");
      return false;
    }
    setUnits((us) =>
      us.map((u) => ({
        ...u,
        before: u.before === "queued" ? "saved" : u.before,
        after: u.after === "queued" ? "saved" : u.after,
      })),
    );
    return true;
  }

  async function sendBefore() {
    setError(null);
    const errs: Record<string, Record<string, string>> = {};
    for (const u of units) {
      const e = validateFields(unitFields, u.details);
      if (Object.keys(e).length) errs[u.id] = e;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setError(`Fill in the ${noun} details marked in red.`);
      return;
    }
    if (!(await uploadQueued())) return;

    setBusy("Saving details…");
    for (const u of units) {
      const changed = JSON.stringify(u.details) !== JSON.stringify(initialUnits.find((x) => x.id === u.id)?.details);
      if (!changed) continue;
      const { error: err } = await supabase.rpc("update_unit_details", {
        p_item_id: u.id,
        p_details: visibleValues(unitFields, u.details),
      });
      if (err) {
        setBusy(null);
        setError(`${u.label}: ${err.message}`);
        return;
      }
    }

    setBusy("Sending for approval…");
    const { error: err } = await supabase.rpc("submit_site_photos", { p_job_id: jobId, p_stage: "before" });
    setBusy(null);
    if (err) return setError(err.message);
    setSent("before");
    router.refresh();
  }

  async function sendAfter() {
    setError(null);
    if (!(await uploadQueued())) return;
    setBusy("Sending for approval…");
    const { error: err } = await supabase.rpc("submit_site_photos", {
      p_job_id: jobId,
      p_stage: "after",
      p_note: note.trim() || null,
    });
    setBusy(null);
    if (err) return setError(err.message);
    setSent("after");
    router.refresh();
  }

  /* ------------------------------------------------------- derived states */
  const beforeStatus = sent === "before" ? "PENDING" : before.status;
  const afterStatus = sent === "after" ? "PENDING" : after.status;
  const allBefore = units.every((u) => u.before !== "none");
  const allAfter = units.every((u) => u.after !== "none");
  const preArrival = status === "ASSIGNED" || status === "CHECKED_IN" || status === "EN_ROUTE";

  /* ---------------------------------------------------------------- views */
  if (status === "COMPLETED") {
    return (
      <Panel tone="ok" title="Job completed">
        {completedAt ? `Approved and closed at ${formatIstTime(completedAt)}.` : "Approved and closed."}
      </Panel>
    );
  }
  if (status === "CANCELLED" || status === "NO_SHOW") {
    return <Panel tone="plain" title="This job is cancelled">Nothing to do here.</Panel>;
  }
  if (status === "DRAFT") {
    return <Panel tone="plain" title="Not booked yet">The sales team has not confirmed this job.</Panel>;
  }

  return (
    <section className="space-y-4 card p-5">
      <Stepper status={status} before={beforeStatus} after={afterStatus} />

      {/* -------------------------------------------- before arriving */}
      {preArrival && depot !== "APPROVED" ? (
        depot === "PENDING" ? (
          <Waiting title="Waiting for your check-in to be approved">
            The job location and the Reached button unlock as soon as it is approved.
          </Waiting>
        ) : (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
              <Glyph d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" />
              {depot === "REJECTED"
                ? "Your depot photos were rejected. Retake them to unlock this job."
                : "Check in at the depot first. The job unlocks once your photos are approved."}
            </p>
            <a
              href="/s/checkin"
              className="tap-lg flex items-center justify-center rounded-2xl bg-brand-900 text-base font-bold text-white active:scale-[0.98]"
            >
              {depot === "REJECTED" ? "Retake depot photos" : "Go to depot check-in"}
            </a>
          </div>
        )
      ) : null}

      {preArrival && depot === "APPROVED" && waitFor ? (
        <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-900/10">
            <Glyph d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-slate-900">Finish {waitFor.client} first</p>
            <p className="mt-0.5 text-sm text-slate-600">
              This job opens once {waitFor.jobNumber} is done and its after photos are approved.
            </p>
          </div>
        </div>
      ) : null}

      {preArrival && depot === "APPROVED" && !waitFor ? (
        <div className="space-y-2">
          <BigButton busy={busy} onClick={() => void reached()} icon="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z">
            I&apos;ve reached the site
          </BigButton>
          {status !== "EN_ROUTE" ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void advance(status === "ASSIGNED" ? ["CHECKED_IN", "EN_ROUTE"] : ["EN_ROUTE"], "Starting trip…")
              }
              className="tap-lg w-full rounded-2xl bg-brand-50 text-base font-bold text-brand-800 active:scale-[0.98] disabled:opacity-40"
            >
              Start trip
            </button>
          ) : (
            <p className="text-center text-sm text-slate-500">On the way. Tap Reached when you get there.</p>
          )}
        </div>
      ) : null}

      {/* -------------------------------------- on site: before + details */}
      {status === "ON_SITE" && beforeStatus === "PENDING" ? (
        <Waiting title="Before photos sent">Waiting for approval to start cleaning.</Waiting>
      ) : null}

      {status === "ON_SITE" && beforeStatus === "APPROVED" ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 rounded-2xl bg-ok-50 p-3 text-sm font-semibold text-ok-700">
            <Glyph d="m5 12.5 4.5 4.5L19 7.5" />
            Before photos approved
          </p>
          <BigButton busy={busy} onClick={() => void advance(["IN_PROGRESS"], "Starting…")} icon="M8 5.5v13l10.5-6.5L8 5.5Z">
            Start cleaning
          </BigButton>
        </div>
      ) : null}

      {status === "ON_SITE" && (beforeStatus === null || beforeStatus === "REJECTED") ? (
        <div className="space-y-3">
          {beforeStatus === "REJECTED" ? (
            <Rejected reason={before.reason}>Fix this and send again.</Rejected>
          ) : (
            <p className="text-sm text-slate-600">
              For each {noun}: take a <b>before</b> photo and check the details. Then send for approval.
            </p>
          )}
          {units.map((u) => (
            <div key={u.id} className="space-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <UnitPhotoRow
                unit={u}
                which="before"
                onShoot={() => setCamera({ unit: u, kind: "SITE_BEFORE" })}
              />
              {unitFields.length ? (
                <DynamicServiceForm
                  idPrefix={`u-${u.id}`}
                  fields={unitFields}
                  values={u.details}
                  errors={errors[u.id]}
                  onChange={(v) => setUnits((us) => us.map((x) => (x.id === u.id ? { ...x, details: v } : x)))}
                />
              ) : null}
            </div>
          ))}
          <BigButton busy={busy} disabled={!allBefore} onClick={() => void sendBefore()}>
            Send for approval
          </BigButton>
          {!allBefore ? (
            <p className="text-center text-sm text-slate-500">Take a before photo of every {noun} first.</p>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------ cleaning: after photos */}
      {status === "IN_PROGRESS" && afterStatus === "PENDING" ? (
        <Waiting title="After photos sent for approval">The job closes as soon as it is approved.</Waiting>
      ) : null}

      {status === "IN_PROGRESS" && (afterStatus === null || afterStatus === "REJECTED") ? (
        <div className="space-y-3">
          {afterStatus === "REJECTED" ? (
            <Rejected reason={after.reason}>Retake what is needed and send again.</Rejected>
          ) : (
            <p className="text-sm text-slate-600">
              When each {noun} is clean, take its <b>after</b> photo.
            </p>
          )}
          {units.map((u) => (
            <div key={u.id}>
              <UnitPhotoRow unit={u} which="after" onShoot={() => setCamera({ unit: u, kind: "SITE_AFTER" })} />
            </div>
          ))}
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-800">
              Notes <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`e.g. ${units.length} ${units.length === 1 ? noun : `${noun}s`} cleaned and disinfected`}
              className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-base outline-none ring-2 ring-slate-200 focus:ring-brand-600"
            />
          </label>
          <BigButton busy={busy} disabled={!allAfter} onClick={() => void sendAfter()}>
            Send for approval
          </BigButton>
          {!allAfter ? (
            <p className="text-center text-sm text-slate-500">Take an after photo of every {noun} to send.</p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="rounded-2xl bg-danger-50 p-3 text-sm font-medium text-danger-700">{error}</p> : null}

      {camera ? (
        <LiveCameraCapture
          kind={camera.kind}
          jobId={jobId}
          lineItemId={camera.unit.id}
          facing="environment"
          title={`${camera.unit.label}: ${camera.kind === "SITE_BEFORE" ? "before" : "after"}`}
          hint={camera.kind === "SITE_BEFORE" ? "Show it before you start" : "Show it clean"}
          onCancel={() => setCamera(null)}
          onCaptured={({ queued }) => {
            const field = camera.kind === "SITE_BEFORE" ? "before" : "after";
            const unitId = camera.unit.id;
            setUnits((us) => us.map((u) => (u.id === unitId ? { ...u, [field]: queued ? "queued" : "saved" } : u)));
            setCamera(null);
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ parts */

function Stepper({
  status,
  before,
  after,
}: {
  status: JobStatus;
  before: ApprovalStatus | null;
  after: ApprovalStatus | null;
}) {
  const order: JobStatus[] = ["ASSIGNED", "CHECKED_IN", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "COMPLETED"];
  const at = order.indexOf(status);
  const steps = [
    { label: "Reached", on: at >= 3 },
    { label: "Before OK", on: before === "APPROVED" || at >= 4 },
    { label: "Cleaning", on: at >= 4 },
    { label: "After OK", on: after === "APPROVED" || at >= 5 },
  ];
  const current = steps.findIndex((s) => !s.on);
  return (
    <ol className="flex">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 ? (
            <span
              aria-hidden
              className={`absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 ${steps[i - 1].on ? "bg-brand-600" : "bg-slate-200"}`}
            />
          ) : null}
          <span
            className={`relative z-10 flex size-7 items-center justify-center rounded-full text-xs font-bold ${
              s.on
                ? "bg-brand-600 text-white"
                : i === current
                  ? "bg-white text-brand-700 ring-2 ring-brand-600"
                  : "bg-slate-100 text-slate-400"
            }`}
          >
            {s.on ? (
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <span
            className={`mt-1.5 text-[11px] leading-tight ${
              s.on ? "font-semibold text-brand-700" : i === current ? "font-bold text-slate-900" : "text-slate-400"
            }`}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function UnitPhotoRow({ unit, which, onShoot }: { unit: FlowUnit; which: "before" | "after"; onShoot: () => void }) {
  const state = unit[which];
  const taken = state !== "none";
  return (
    <button
      type="button"
      onClick={onShoot}
      className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left active:scale-[0.99] ${
        taken ? "bg-ok-50 ring-2 ring-ok-600" : "border-2 border-dashed border-brand-600/50 bg-white"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
          taken ? "bg-ok-600 text-white" : "bg-brand-50 text-brand-700"
        }`}
      >
        <Glyph
          big
          d={
            taken
              ? "m5 12.5 4.5 4.5L19 7.5"
              : "M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8ZM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
          }
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-slate-900">{unit.label}</span>
        <span className="block text-xs text-slate-500">
          {state === "saved"
            ? `${which === "before" ? "Before" : "After"} photo saved · tap to retake`
            : state === "queued"
              ? "Saved on this phone, uploads when there is signal"
              : `Take the ${which} photo`}
        </span>
      </span>
      {!taken ? (
        <span className="shrink-0 rounded-full bg-brand-900 px-3 py-1.5 text-xs font-bold text-white">Camera</span>
      ) : null}
    </button>
  );
}

function Waiting({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-4">
      <AutoRefresh seconds={8} />
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-brand-700">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand-200/60" aria-hidden />
        <Glyph d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      </span>
      <div className="min-w-0">
        <p className="font-bold text-brand-900">{title}</p>
        <p className="mt-0.5 text-sm text-brand-900">{children}</p>
        <p className="mt-1.5 text-xs text-brand-700">This updates by itself.</p>
      </div>
    </div>
  );
}

function Rejected({ reason, children }: { reason: string | null; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-danger-50 p-4 text-sm text-danger-700 ring-1 ring-danger-100">
      <Glyph d="M12 8v5M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <div>
        <p className="font-bold">Not approved{reason ? `: ${reason}` : ""}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </div>
  );
}

function BigButton({
  children,
  onClick,
  busy,
  disabled,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: string | null;
  disabled?: boolean;
  /** Optional SVG path drawn before the label. */
  icon?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy !== null}
      className="tap-lg flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-900 text-base font-bold text-white active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
    >
      {busy ? null : icon ? <Glyph d={icon} /> : null}
      {busy ?? children}
    </button>
  );
}

function Panel({ tone, title, children }: { tone: "ok" | "plain"; title: string; children: React.ReactNode }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-3xl p-5 ring-1 ${
        tone === "ok" ? "bg-ok-50 ring-ok-100" : "card"
      }`}
    >
      {tone === "ok" ? (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ok-600 text-white">
          <Glyph big d="m5 12.5 4.5 4.5L19 7.5" />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className={`text-lg font-bold ${tone === "ok" ? "text-ok-700" : "text-slate-900"}`}>{title}</p>
        <p className={`mt-0.5 text-sm ${tone === "ok" ? "text-ok-700" : "text-slate-600"}`}>{children}</p>
      </div>
    </div>
  );
}

/** A line icon; `d` is the SVG path. */
function Glyph({ d, big }: { d: string; big?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${big ? "size-6" : "size-5"} shrink-0`}
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
