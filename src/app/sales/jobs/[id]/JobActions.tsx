"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Job } from "@/lib/domain/database";
import { formatIstTime, istDate } from "@/lib/domain/checkin-policy";

type Reason = { id: string; code: string; label: string; requires_note: boolean };
type Supervisor = { id: string; full_name: string };

export function JobActions({
  job,
  supervisors,
  rescheduleReasons,
  cancelReasons,
}: {
  job: Job;
  supervisors: Supervisor[];
  rescheduleReasons: Reason[];
  cancelReasons: Reason[];
}) {
  const [open, setOpen] = useState<"none" | "reschedule" | "cancel">("none");
  const terminal = ["COMPLETED", "CANCELLED"].includes(job.status);

  if (terminal) {
    return (
      <p className="rounded-2xl bg-slate-100 p-3 text-center text-sm text-slate-600">
        This job is {job.status.toLowerCase()} and can no longer be changed here.
      </p>
    );
  }

  return (
    <>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setOpen("reschedule")}
          className="tap-lg flex-1 rounded-2xl bg-brand-700 font-semibold text-white"
        >
          Reschedule
        </button>
        <button
          type="button"
          onClick={() => setOpen("cancel")}
          className="tap-lg flex-1 rounded-2xl border-2 border-danger-500 font-semibold text-danger-600"
        >
          Cancel job
        </button>
      </div>

      {open === "reschedule" ? (
        <RescheduleModal job={job} supervisors={supervisors} reasons={rescheduleReasons} onClose={() => setOpen("none")} />
      ) : null}
      {open === "cancel" ? (
        <CancelModal job={job} reasons={cancelReasons} onClose={() => setOpen("none")} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------ */

function RescheduleModal({
  job, supervisors, reasons, onClose,
}: {
  job: Job; supervisors: Supervisor[]; reasons: Reason[]; onClose: () => void;
}) {
  const router = useRouter();
  const startIst = new Date(job.scheduled_start);
  const [date, setDate] = useState(istDate(startIst));
  const [time, setTime] = useState(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(startIst),
  );
  const [supervisorId, setSupervisorId] = useState(job.assigned_supervisor_id ?? "");
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [informed, setInformed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The cascade preview. Rescheduling re-chains the WHOLE day for that
  // supervisor, because removing or adding a job changes the travel origin of
  // every job after it. Reps who cannot see that blame the app when other
  // deadlines move.
  const [affected, setAffected] = useState<{ job_number: string; scheduled_start: string }[]>([]);
  useEffect(() => {
    if (!supervisorId || !date) return;
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("jobs")
        .select("job_number, scheduled_start")
        .eq("assigned_supervisor_id", supervisorId)
        .eq("service_date", date)
        .neq("id", job.id)
        .not("status", "in", "(CANCELLED,COMPLETED,NO_SHOW)")
        .order("scheduled_start");
      if (alive) setAffected(data ?? []);
    })();
    return () => { alive = false; };
  }, [supervisorId, date, job.id]);

  const reason = reasons.find((r) => r.id === reasonId);

  async function submit() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("reschedule_job", {
      p_job_id: job.id,
      p_new_start: new Date(`${date}T${time}:00+05:30`).toISOString(),
      p_reason_id: reasonId,
      p_reason_note: note || null,
      p_new_supervisor: supervisorId || null,
      p_client_informed: informed,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onClose();
    router.refresh();
  }

  return (
    <Modal title="Reschedule job" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="New date">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Labelled>
        <Labelled label="New time">
          <input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
        </Labelled>
      </div>

      <Labelled label="Supervisor">
        <select className={inputCls} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
          {supervisors.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </Labelled>

      <Labelled label="Reason">
        <select className={inputCls} value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">Choose…</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Labelled>

      {reason?.requires_note ? (
        <Labelled label="Note (required for this reason)">
          <textarea rows={2} className={`${inputCls} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Labelled>
      ) : null}

      {affected.length > 0 ? (
        <div className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
          <p className="font-semibold">
            {affected.length} other job{affected.length === 1 ? "" : "s"} that day will be re-chained
          </p>
          <ul className="mt-1 space-y-0.5">
            {affected.map((a) => (
              <li key={a.job_number}>
                {a.job_number} at {formatIstTime(a.scheduled_start)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Their travel times and the depot check-in deadline are recalculated
            from the new order.
          </p>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="size-5" checked={informed} onChange={(e) => setInformed(e.target.checked)} />
        Client has been told
      </label>

      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      <button
        type="button"
        disabled={busy || !reasonId}
        onClick={submit}
        className="tap-lg w-full rounded-2xl bg-brand-700 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Rescheduling…" : "Confirm reschedule"}
      </button>
    </Modal>
  );
}

function CancelModal({ job, reasons, onClose }: { job: Job; reasons: Reason[]; onClose: () => void }) {
  const router = useRouter();
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [informed, setInformed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = reasons.find((r) => r.id === reasonId);

  async function submit() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("cancel_job", {
      p_job_id: job.id,
      p_reason_id: reasonId,
      p_reason_note: note || null,
      p_client_informed: informed,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onClose();
    router.refresh();
  }

  return (
    <Modal title="Cancel job" onClose={onClose}>
      <p className="text-sm text-slate-600">
        The job stays on record with its reason. Any pending reminders for it are
        dropped immediately.
      </p>

      <Labelled label="Reason">
        <select className={inputCls} value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">Choose…</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Labelled>

      {reason?.requires_note ? (
        <Labelled label="Note (required for this reason)">
          <textarea rows={2} className={`${inputCls} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Labelled>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="size-5" checked={informed} onChange={(e) => setInformed(e.target.checked)} />
        Client has been told
      </label>

      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      <button
        type="button"
        disabled={busy || !reasonId}
        onClick={submit}
        className="tap-lg w-full rounded-2xl bg-danger-600 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Cancelling…" : "Cancel this job"}
      </button>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */

const inputCls =
  "w-full tap rounded-xl border-2 border-slate-200 bg-white px-3 text-base outline-none focus:border-brand-600";

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(var(--safe-bottom)+1.25rem)] sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="tap rounded-full px-3 text-2xl leading-none text-slate-400">
            ×
          </button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}
