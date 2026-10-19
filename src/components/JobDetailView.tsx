import type { JobDetail } from "@/lib/data/jobs";
import type { ServiceField } from "@/lib/domain/database";
import { formatIstDate, formatIstTime } from "@/lib/domain/checkin-policy";

/**
 * Renders the answers against the schema the job was PINNED to, so a job
 * booked before a service was edited still reads correctly. A field the admin
 * has since archived still shows here, because its schema version is the one
 * this job carries.
 */
export function renderValue(field: ServiceField, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (field.field_type === "boolean") return raw ? "Yes" : "No";
  if (field.field_type === "select") {
    const opt = (field.config?.options ?? []).find((o) => o.value === String(raw));
    return opt?.label ?? String(raw);
  }
  const unit = field.config?.unit ? ` ${field.config.unit}` : "";
  return `${String(raw)}${unit}`;
}

export function JobDetailView({
  detail,
  showAudit = false,
}: {
  detail: JobDetail;
  showAudit?: boolean;
}) {
  const { job, client, service, lineItems, jobFields, lineItemFields, events, photos, supervisorName, payment } = detail;

  const beforeAfter = (itemId: string) => ({
    before: photos.find((p) => p.job_line_item_id === itemId && p.kind === "SITE_BEFORE"),
    after: photos.find((p) => p.job_line_item_id === itemId && p.kind === "SITE_AFTER"),
  });

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- summary */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-slate-900">{client?.name ?? "Client"}</p>
            <p className="text-sm text-slate-600">{service?.name}</p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {job.status.replace("_", " ").toLowerCase()}
          </span>
        </div>

        <dl className="mt-3 space-y-1.5 text-sm">
          <Row k="When" v={`${formatIstDate(job.scheduled_start)} · ${formatIstTime(job.scheduled_start)}`} />
          <Row k="Supervisor" v={supervisorName ?? "Unassigned"} />
          <Row k="Where" v={job.site_address} />
          {job.site_landmark ? <Row k="Landmark" v={job.site_landmark} /> : null}
          {client?.phone ? (
            <div className="flex justify-between gap-4 py-0.5">
              <dt className="text-slate-500">Phone</dt>
              <dd>
                <a href={`tel:${client.phone}`} className="font-semibold text-brand-700">
                  {client.phone}
                </a>
              </dd>
            </div>
          ) : null}
          {job.quoted_amount ? <Row k="Quoted" v={`₹${job.quoted_amount}`} /> : null}
          {payment ? (
            <Row
              k="Payment"
              v={`₹${payment.amount} · ${payment.mode}${payment.collected_at ? "" : " (pending)"}`}
            />
          ) : null}
        </dl>

        {/* Travel and deadline, with an honest note when the ETA is a guess. */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {job.travel_minutes != null ? (
            <Chip tone="plain">~{job.travel_minutes} min travel</Chip>
          ) : null}
          {job.travel_source ? <Chip tone="plain">from {job.travel_source.replace("_", " ")}</Chip> : null}
          {job.deadline_state === "failed" ? (
            <Chip tone="warn">estimated travel — no maps provider</Chip>
          ) : null}
          {job.late_blameless ? (
            <Chip tone="warn">late, previous job overran</Chip>
          ) : job.is_late ? (
            <Chip tone="danger">late</Chip>
          ) : null}
          {job.itinerary_flags?.map((f) => (
            <Chip key={f} tone="warn">{f.replace(/_/g, " ")}</Chip>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- service details */}
      {jobFields.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Job details</h2>
          <dl className="space-y-1.5 text-sm">
            {jobFields.map((f) => (
              <Row key={f.id} k={f.label} v={renderValue(f, job.service_details?.[f.key])} />
            ))}
          </dl>
        </section>
      ) : null}

      {/* ------------------------------------------------------ line items */}
      {lineItems.length ? (
        <section className="space-y-2">
          <h2 className="px-1 font-semibold text-slate-900">
            {lineItems.length} {service?.has_line_items ? (lineItems.length === 1 ? service.line_item_singular : service.line_item_plural) : "items"}
          </h2>
          {lineItems.map((li) => {
            const ba = beforeAfter(li.id);
            return (
              <div key={li.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-800">{li.label}</p>
                  {li.is_done ? (
                    <span className="rounded-full bg-ok-100 px-2 py-0.5 text-xs font-semibold text-ok-700">
                      done
                    </span>
                  ) : null}
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  {lineItemFields.map((f) => (
                    <Row key={f.id} k={f.label} v={renderValue(f, li.details?.[f.key])} />
                  ))}
                </dl>
                {ba.before || ba.after ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {ba.before ? "before ✓" : "before —"} · {ba.after ? "after ✓" : "after —"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {/* ------------------------------------------------------ audit trail */}
      {showAudit && events.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-slate-900">History</h2>
          <ol className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 border-b border-slate-100 pb-2 last:border-0">
                <span className="w-24 shrink-0 tabular-nums text-slate-400">
                  {formatIstTime(e.occurred_at)}
                </span>
                <span className="text-slate-700">
                  <b>{e.event_type}</b>
                  {e.from_status && e.to_status ? ` · ${e.from_status} → ${e.to_status}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-900">{v}</dd>
    </div>
  );
}

function Chip({ tone, children }: { tone: "plain" | "warn" | "danger"; children: React.ReactNode }) {
  const tones = {
    plain: "bg-slate-100 text-slate-600",
    warn: "bg-warn-100 text-warn-700",
    danger: "bg-danger-100 text-danger-700",
  } as const;
  return <span className={`rounded-full px-2 py-1 font-medium ${tones[tone]}`}>{children}</span>;
}
