"use client";

import { useMemo, useState } from "react";
import dynamicImport from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ServiceWithSchema } from "@/lib/data/services";
import type { Client } from "@/lib/domain/database";
import {
  DynamicServiceForm,
  initialValues,
  validateFields,
  visibleValues,
  type FieldValues,
} from "@/components/DynamicServiceForm";
import { formatIstTime, istDate } from "@/lib/domain/checkin-policy";
import { extractShortMapLink, parseCoordinates } from "@/lib/location-link";

// MapLibre touches `window` on import, so it must never run on the server.
const MapPin = dynamicImport(
  () => import("@/components/MapPin").then((m) => m.MapPin),
  { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-2xl bg-slate-200" /> },
);

type Supervisor = { id: string; full_name: string };
type Site = { lat: number; lng: number } | null;
type LineItem = { key: string; details: FieldValues };

const STEPS = ["Client", "Location", "Service", "Details", "Schedule", "Review"] as const;
const QUICK_COUNTS = [1, 2, 3, 4, 5];
const MAX_ITEMS = 20;

/** Jobs are almost always booked for the next day or later. */
function tomorrowIst(): string {
  const [y, m, d] = istDate().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function NewJobWizard({
  services,
  supervisors,
}: {
  services: ServiceWithSchema[];
  supervisors: Supervisor[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ jobNumber: string; checkinAt: string | null } | null>(null);

  // --- client -------------------------------------------------------------
  const [clientMode, setClientMode] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<Client | null>(null);
  const [draft, setDraft] = useState({
    name: "", phone: "", address_line: "", locality: "", city: "",
  });

  // --- site / service / details -------------------------------------------
  const [site, setSite] = useState<Site>(null);
  const [mapTarget, setMapTarget] = useState<Site>(null);
  const [pasted, setPasted] = useState("");
  const [pasteState, setPasteState] = useState<"idle" | "reading" | "ok" | "fail">("idle");
  const [siteAddress, setSiteAddress] = useState("");
  const [siteLandmark, setSiteLandmark] = useState("");
  const [serviceId, setServiceId] = useState<string>("");
  const [jobValues, setJobValues] = useState<FieldValues>({});
  const [items, setItems] = useState<LineItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, Record<string, string>>>({});

  // --- schedule -----------------------------------------------------------
  const [date, setDate] = useState(tomorrowIst);
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState<number | "">("");
  const [supervisorId, setSupervisorId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const service = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  async function searchClients() {
    if (query.trim().length < 2) return;
    setSearching(true);
    const supabase = createClient();
    const q = query.trim();
    const { data } = await supabase
      .from("clients")
      .select("*")
      .or(`phone.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(8);
    setResults((data as Client[]) ?? []);
    setSearching(false);
  }

  function pickService(s: ServiceWithSchema) {
    setServiceId(s.id);
    setJobValues(initialValues(s.jobFields));
    setDuration(s.default_duration_min);
    // Start with one unit — almost every job has at least one.
    setItems(s.has_line_items ? [{ key: crypto.randomUUID(), details: initialValues(s.lineItemFields) }] : []);
  }

  // Changing the count keeps what was already filled in for the first tanks.
  function setItemCount(n: number) {
    if (!service) return;
    const count = Math.min(Math.max(n, 1), MAX_ITEMS);
    setItems((prev) =>
      count <= prev.length
        ? prev.slice(0, count)
        : [
            ...prev,
            ...Array.from({ length: count - prev.length }, () => ({
              key: crypto.randomUUID(),
              details: initialValues(service.lineItemFields),
            })),
          ],
    );
  }

  async function applyPastedLocation(text: string) {
    setPasted(text);
    if (!text.trim()) {
      setPasteState("idle");
      return;
    }

    let found = parseCoordinates(text);
    const shortLink = found ? null : extractShortMapLink(text);
    if (shortLink) {
      setPasteState("reading");
      try {
        const res = await fetch(`/api/resolve-location?url=${encodeURIComponent(shortLink)}`);
        if (res.ok) found = await res.json();
      } catch {
        found = null;
      }
    }

    if (found) {
      setSite(found);
      setMapTarget(found);
      setPasteState("ok");
    } else {
      setPasteState("fail");
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      await applyPastedLocation(text);
    } catch {
      // Blocked or unsupported: the box is still there to long-press and paste.
      setPasteState("fail");
    }
  }

  function canAdvance(step: number): string | null {
    if (step === 0) {
      if (clientMode === "search" && !client) return "Pick a client, or add a new one.";
      if (clientMode === "new" && !draft.name.trim()) return "The client needs a name.";
      if (clientMode === "new" && !draft.address_line.trim()) return "The client needs an address.";
    }
    if (step === 1) {
      if (!site) return "Move the map so the pin is on the building.";
      if (!siteAddress.trim()) return "Add the site address.";
    }
    if (step === 2 && !service) return "Pick a service.";
    if (step === 3 && service) {
      const jobErrs = validateFields(service.jobFields, jobValues);
      if (Object.keys(jobErrs).length) {
        setErrors(jobErrs);
        return "Fix the highlighted fields.";
      }
      setErrors({});
      if (service.has_line_items) {
        if (items.length === 0) return `Choose how many ${service.line_item_plural?.toLowerCase()}.`;
        const all: Record<string, Record<string, string>> = {};
        let firstBad = -1;
        for (const [i, it] of items.entries()) {
          const e = validateFields(service.lineItemFields, it.details);
          if (Object.keys(e).length) {
            all[it.key] = e;
            if (firstBad < 0) firstBad = i;
          }
        }
        setItemErrors(all);
        if (firstBad >= 0) return `${service.line_item_singular} ${firstBad + 1} is incomplete.`;
      }
    }
    if (step === 4) {
      if (!supervisorId) return "Assign a supervisor.";
      if (!date || !time) return "Set a date and time.";
    }
    return null;
  }

  /**
   * Going back is always allowed. Going forward re-checks every step on the
   * way, so jumping from Client straight to Review after an edit cannot skip
   * a step that is now incomplete.
   */
  function goTo(target: number) {
    if (target <= step) {
      setFormError(null);
      setStep(target);
      return;
    }
    for (let s = step; s < target; s++) {
      const problem = canAdvance(s);
      if (problem) {
        setStep(s);
        setFormError(problem);
        return;
      }
    }
    setFormError(null);
    setStep(target);
    setMaxStep((m) => Math.max(m, target));
  }

  function next() {
    goTo(Math.min(step + 1, STEPS.length - 1));
  }

  async function submit() {
    if (!service || !site) return;
    setSubmitting(true);
    setFormError(null);

    const supabase = createClient();
    const scheduledStart = new Date(`${date}T${time}:00+05:30`).toISOString();

    const payload: Record<string, unknown> = {
      service_id: service.id,
      site: { lat: site.lat, lng: site.lng, address: siteAddress, landmark: siteLandmark || null },
      scheduled_start: scheduledStart,
      estimated_duration_min: duration === "" ? service.default_duration_min : duration,
      supervisor_id: supervisorId,
      service_details: visibleValues(service.jobFields, jobValues),
      quoted_amount: amount || null,
      internal_notes: notes || null,
      line_items: items.map((it, i) => ({
        label: `${service.line_item_singular ?? "Item"} ${i + 1}`,
        details: visibleValues(service.lineItemFields, it.details),
      })),
    };
    if (client) payload.client_id = client.id;
    // Landmark is only asked once, on the Location step, so the new client
    // record takes it from there.
    else payload.client = { ...draft, landmark: siteLandmark || null };

    const { data, error } = await supabase.rpc("create_job", { p_payload: payload });

    if (error) {
      setSubmitting(false);
      setFormError(error.message);
      return;
    }

    const job = data as { id: string; job_number: string; service_date: string };

    // The save path never waits on Maps — a provider timeout must not be able
    // to break job creation. But the background queue only drains on the next
    // cron tick, so ask for this one day to be recomputed now; otherwise the
    // rep stares at "calculating" for up to a minute on the very screen where
    // the answer matters.
    await supabase.rpc("recompute_for_job", { p_job_id: job.id });

    let checkinAt: string | null = null;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data: roster } = await supabase
        .from("day_rosters")
        .select("required_checkin_at")
        .eq("supervisor_id", supervisorId)
        .eq("roster_date", job.service_date)
        .maybeSingle();
      if (roster?.required_checkin_at) {
        checkinAt = roster.required_checkin_at;
        break;
      }
    }

    setSubmitting(false);
    setCreated({ jobNumber: job.job_number, checkinAt });
  }

  /* ---------------------------------------------------------------- done */
  if (created) {
    const supervisorName = supervisors.find((s) => s.id === supervisorId)?.full_name ?? "The supervisor";
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-ok-100 bg-ok-50 p-5">
          <p className="text-lg font-semibold text-ok-700">Job {created.jobNumber} created</p>
          <p className="mt-2 text-ok-700">
            {created.checkinAt ? (
              <>
                {supervisorName} must check in at the depot by{" "}
                <span className="font-bold">{formatIstTime(created.checkinAt)}</span>.
              </>
            ) : (
              <>The check-in time is still being calculated — it will appear on the job shortly.</>
            )}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/sales")}
            className="tap-lg flex-1 rounded-2xl border-2 border-slate-300 font-semibold"
          >
            Back to today
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="tap-lg flex-1 rounded-2xl bg-brand-700 font-semibold text-white"
          >
            Book another
          </button>
        </div>
      </div>
    );
  }

  const input =
    "w-full tap rounded-xl border-2 border-slate-200 bg-white px-3 text-base outline-none focus:border-brand-600";

  return (
    <div className="space-y-4 pb-4">
      {/* progress */}
      <ol className="flex gap-1">
        {STEPS.map((label, i) => {
          const reachable = i <= maxStep && i !== step;
          return (
            <li key={label} className="flex-1">
              {/* Tap any step already reached to jump straight back to it. */}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => goTo(i)}
                aria-current={i === step ? "step" : undefined}
                className="block w-full pb-1 text-left disabled:cursor-default"
              >
                <div className={`h-1.5 rounded-full ${i <= step ? "bg-brand-600" : i <= maxStep ? "bg-brand-200" : "bg-slate-200"}`} />
                <p
                  className={`mt-1 text-[11px] ${
                    i === step
                      ? "font-semibold text-brand-700"
                      : reachable
                        ? "font-medium text-brand-700 underline underline-offset-2"
                        : "text-slate-400"
                  }`}
                >
                  {label}
                </p>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ------------------------------------------------------ 0. client */}
      {step === 0 ? (
        <section className="space-y-3">
          <div className="flex gap-2">
            <TabButton active={clientMode === "search"} onClick={() => setClientMode("search")}>
              Existing client
            </TabButton>
            <TabButton active={clientMode === "new"} onClick={() => setClientMode("new")}>
              New client
            </TabButton>
          </div>

          {clientMode === "search" ? (
            <>
              <div className="flex gap-2">
                <input
                  className={input}
                  placeholder="Phone or name"
                  inputMode="tel"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchClients()}
                />
                <button
                  type="button"
                  onClick={searchClients}
                  className="tap shrink-0 rounded-xl bg-slate-800 px-5 font-semibold text-white"
                >
                  {searching ? "…" : "Search"}
                </button>
              </div>
              <ul className="space-y-2">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setClient(c);
                        setSiteAddress(c.address_line);
                        setSiteLandmark(c.landmark ?? "");
                      }}
                      className={`w-full rounded-xl border-2 p-3 text-left ${
                        client?.id === c.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <p className="font-semibold text-slate-900">{c.name}</p>
                      <p className="text-sm text-slate-500">
                        {c.phone} · {c.locality ?? c.address_line}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {!searching && query.length >= 2 && results.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No match. Use <b>New client</b> instead.
                </p>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <Field label="Client name" required>
                <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Phone" optional>
                <input className={input} inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </Field>
              <Field label="Address" required>
                <input className={input} value={draft.address_line} onChange={(e) => { setDraft({ ...draft, address_line: e.target.value }); setSiteAddress(e.target.value); }} />
              </Field>
              <Field label="Locality" optional>
                <input className={input} value={draft.locality} onChange={(e) => setDraft({ ...draft, locality: e.target.value })} />
              </Field>
            </div>
          )}
        </section>
      ) : null}

      {/* ---------------------------------------------------- 1. location */}
      {step === 1 ? (
        <section className="space-y-3">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-700">Location shared on WhatsApp?</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Paste the Google Maps link or the coordinates and the pin moves there.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                className={input}
                placeholder="maps.app.goo.gl/… or 17.4401, 78.3489"
                value={pasted}
                onChange={(e) => applyPastedLocation(e.target.value)}
              />
              {/* Clipboard reading only exists on https, so on a plain-http test
                  link this button hides and long-press paste still works. */}
              {typeof window !== "undefined" && window.isSecureContext && navigator.clipboard ? (
                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  className="tap shrink-0 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white"
                >
                  Paste
                </button>
              ) : null}
            </div>
            {pasteState === "reading" ? (
              <p className="mt-2 text-sm text-slate-500">Reading the link…</p>
            ) : pasteState === "ok" ? (
              <p className="mt-2 text-sm text-ok-700">Pin moved to the shared location. Check it is on the right building.</p>
            ) : pasteState === "fail" ? (
              <p className="mt-2 text-sm text-danger-600">
                No location found in that. Paste the Google Maps link, or move the map by hand.
              </p>
            ) : null}
          </div>
          <MapPin value={site} onChange={setSite} target={mapTarget} />
          <Field label="Site address" required>
            <input className={input} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
          </Field>
          <Field label="Landmark" optional>
            <input className={input} placeholder="Opposite the water tank" value={siteLandmark} onChange={(e) => setSiteLandmark(e.target.value)} />
          </Field>
        </section>
      ) : null}

      {/* ----------------------------------------------------- 2. service */}
      {step === 2 ? (
        <section className="space-y-2">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickService(s)}
              className={`w-full rounded-2xl border-2 p-4 text-left ${
                serviceId === s.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white"
              }`}
            >
              <p className="font-semibold text-slate-900">{s.name}</p>
              {s.description ? <p className="mt-1 text-sm text-slate-500">{s.description}</p> : null}
              <p className="mt-1 text-xs text-slate-400">
                about {s.default_duration_min} min
                {s.has_line_items ? ` · counted in ${s.line_item_plural?.toLowerCase()}` : ""}
              </p>
            </button>
          ))}
        </section>
      ) : null}

      {/* ----------------------------------------------------- 3. details */}
      {step === 3 && service ? (
        <section className="space-y-5">
          {service.jobFields.length ? (
            <DynamicServiceForm fields={service.jobFields} values={jobValues} errors={errors} onChange={setJobValues} />
          ) : null}

          {service.has_line_items ? (
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">
                  How many {service.line_item_plural?.toLowerCase()}?
                  <span className="text-danger-600"> *</span>
                </p>
                <div className="flex gap-2">
                  {QUICK_COUNTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setItemCount(n)}
                      aria-pressed={items.length === n}
                      className={`tap flex-1 rounded-xl border-2 text-base font-semibold ${
                        items.length === n
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setItemCount(Math.max(items.length, QUICK_COUNTS.length) + 1)}
                    aria-label={`One more ${service.line_item_singular?.toLowerCase()}`}
                    className={`tap flex-1 rounded-xl border-2 text-base font-semibold ${
                      items.length > QUICK_COUNTS.length
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {items.length > QUICK_COUNTS.length ? `${items.length}+` : "6+"}
                  </button>
                </div>
              </div>

              {items.map((it, i) => (
                <div key={it.key} className="rounded-2xl border-2 border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-semibold text-slate-800">
                      {service.line_item_singular} {i + 1}
                    </p>
                    {i === items.length - 1 && items.length > QUICK_COUNTS.length ? (
                      <button
                        type="button"
                        onClick={() => setItemCount(items.length - 1)}
                        className="text-sm font-medium text-danger-600"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <DynamicServiceForm
                    idPrefix={`li-${i}`}
                    fields={service.lineItemFields}
                    values={it.details}
                    errors={itemErrors[it.key]}
                    onChange={(v) => setItems((p) => p.map((x) => (x.key === it.key ? { ...x, details: v } : x)))}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------- 4. schedule */}
      {step === 4 ? (
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Start time" required>
              <input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Expected duration (minutes)">
            <input type="number" inputMode="numeric" className={input} value={duration} onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
          <Field label="Supervisor" required>
            <select className={input} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
              <option value="">Choose…</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Quoted amount (₹)">
            <input type="number" inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Internal notes">
            <textarea rows={2} className={`${input} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </section>
      ) : null}

      {/* ------------------------------------------------------ 5. review */}
      {step === 5 && service ? (
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <Row k="Client" v={client?.name ?? draft.name} />
          <Row k="Service" v={service.name} />
          <Row k="Where" v={siteAddress} />
          <Row k="When" v={`${date} at ${time}`} />
          <Row k="Supervisor" v={supervisors.find((s) => s.id === supervisorId)?.full_name ?? "—"} />
          {service.has_line_items ? (
            <Row k={service.line_item_plural ?? "Items"} v={String(items.length)} />
          ) : null}
          {amount ? <Row k="Amount" v={`₹${amount}`} /> : null}
          <p className="pt-2 text-xs text-slate-500">
            The depot check-in deadline is calculated from travel time once this is saved.
          </p>
        </section>
      ) : null}

      {formError ? (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{formError}</p>
      ) : null}

      <div className="flex gap-3">
        {step > 0 ? (
          <button type="button" onClick={() => { setFormError(null); setStep((s) => s - 1); }} className="tap-lg flex-1 rounded-2xl border-2 border-slate-300 font-semibold">
            Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next} className="tap-lg flex-[2] rounded-2xl bg-brand-700 font-semibold text-white">
            Continue
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={submitting} className="tap-lg flex-[2] rounded-2xl bg-brand-700 font-semibold text-white disabled:opacity-50">
            {submitting ? "Creating…" : "Create job"}
          </button>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap flex-1 rounded-xl border-2 text-sm font-semibold ${
        active ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-danger-600"> *</span> : null}
        {optional ? <span className="font-normal text-slate-400"> (optional)</span> : null}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className="text-right font-medium text-slate-900">{v}</span>
    </div>
  );
}
