"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { rupees, upiLink } from "@/lib/domain/payments";
import { compressImage } from "@/lib/compress-image";

type Method = "upi" | "cash" | "both";
type ProofKind = "camera" | "screenshot" | "call";

/**
 * After the work: show the customer the QR or take cash, then mark it. A plain
 * UPI QR cannot tell the app the money arrived, so the supervisor marks it here
 * and the office checks it against the bank.
 */
export function CollectPayment({
  jobId,
  jobNumber,
  quoted,
  upi,
  workers,
  office,
}: {
  jobId: string;
  jobNumber: string;
  quoted: number | null;
  upi: { id: string; name: string } | null;
  workers: { id: string; full_name: string }[];
  /** Who to ring when there is no photo of the payment. */
  office: { full_name: string; phone: string } | null;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("upi");
  const [total, setTotal] = useState(quoted != null ? String(quoted) : "");
  const [cashPart, setCashPart] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [alone, setAlone] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofKind, setProofKind] = useState<ProofKind | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function pickProof(kind: ProofKind, file: File | null) {
    setProofKind(kind);
    setProofFile(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  const totalNum = Number(total) || 0;
  const cash = method === "cash" ? totalNum : method === "both" ? Number(cashPart) || 0 : 0;
  const upiAmount = Math.max(0, totalNum - cash);
  const splitWrong = method === "both" && (cash <= 0 || cash >= totalNum);
  const differs = quoted != null && totalNum !== quoted;
  const teamChosen = alone || picked.length > 0;
  const needsProof = upiAmount > 0 && !splitWrong;
  const proofDone = !needsProof || proofKind === "call" || (proofKind !== null && proofFile !== null);
  const ready = totalNum > 0 && !splitWrong && teamChosen && proofDone && (!differs || note.trim().length > 0);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      let path: string | null = null;
      if (needsProof && proofKind !== "call" && proofFile) {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("Sign in again");
        const blob = await compressImage(proofFile);
        path = `${auth.user.id}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("payment-proofs").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw new Error(up.error.message);
      }
      const { error: err } = await supabase.rpc("record_job_payment_with_proof", {
        p_job_id: jobId,
        p_upi_amount: upiAmount,
        p_cash_amount: cash,
        p_worker_ids: alone ? [] : picked,
        p_note: note.trim() || null,
        p_proof_kind: needsProof ? proofKind : null,
        p_proof_path: path,
      });
      if (err) throw new Error(err.message);
      router.refresh();
      // No photo: straight into the dialler with the office's number.
      if (needsProof && proofKind === "call" && office) window.location.href = `tel:${office.phone.replace(/[^\d+]/g, "")}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet -mx-4 space-y-4 px-4 py-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Collect payment</h2>
        <p className="text-sm text-slate-600">
          {quoted != null ? `Quoted ${rupees(quoted)}. ` : ""}Ask the customer how they want to pay.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["upi", "UPI / QR"],
            ["cash", "Cash"],
            ["both", "Both"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={method === value}
            onClick={() => setMethod(value)}
            className={`tap rounded-xl border-2 text-sm font-semibold ${
              method === value ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Total received (₹)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className="tap w-full rounded-xl border border-slate-900/10 px-3 text-lg font-semibold outline-none focus:border-brand-600"
        />
      </label>

      {method === "both" ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Of this, cash (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={cashPart}
            onChange={(e) => setCashPart(e.target.value)}
            className="tap w-full rounded-xl border border-slate-900/10 px-3 text-lg font-semibold outline-none focus:border-brand-600"
          />
          {totalNum > 0 && !splitWrong ? (
            <span className="mt-1 block text-sm text-slate-600">
              UPI {rupees(upiAmount)} + cash {rupees(cash)}
            </span>
          ) : null}
        </label>
      ) : null}

      {method !== "cash" && upiAmount > 0 && !splitWrong ? (
        upi ? (
          <UpiQr upi={upi} amount={upiAmount} jobNumber={jobNumber} />
        ) : (
          <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
            The company UPI ID is not set up yet, so there is no QR to show. Ask an admin to add it.
          </p>
        )
      ) : null}

      {needsProof ? (
        <UpiProof kind={proofKind} preview={preview} amount={upiAmount} office={office} onPick={pickProof} />
      ) : null}

      {method !== "upi" && cash > 0 ? (
        <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
          You are holding {rupees(cash)} cash. It comes off your Monday payout.
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Who worked with you on this job?</legend>
        {workers.map((w) => (
          <label key={w.id} className="tap flex items-center gap-3 rounded-xl border border-slate-900/10 px-3">
            <input
              type="checkbox"
              className="size-5"
              checked={picked.includes(w.id)}
              onChange={(e) => {
                setAlone(false);
                setPicked((p) => (e.target.checked ? [...p, w.id] : p.filter((x) => x !== w.id)));
              }}
            />
            <span className="font-medium text-slate-800">{w.full_name}</span>
          </label>
        ))}
        <label className="tap flex items-center gap-3 rounded-xl border border-slate-900/10 px-3">
          <input
            type="checkbox"
            className="size-5"
            checked={alone}
            onChange={(e) => {
              setAlone(e.target.checked);
              if (e.target.checked) setPicked([]);
            }}
          />
          <span className="font-medium text-slate-800">I worked alone</span>
        </label>
        {workers.length === 0 ? (
          <p className="text-sm text-slate-500">No workers are on your team yet. Calling staff add them under Payments, Team %.</p>
        ) : null}
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Note{" "}
          <span className="font-normal text-slate-500">
            {differs ? "(needed: the amount is different from the quote)" : "(optional)"}
          </span>
        </span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-xl border border-slate-900/10 px-3 py-2 text-base outline-none focus:border-brand-600"
        />
      </label>

      {error ? <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}

      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void submit()}
        className="tap-lg w-full rounded-lg bg-brand-950 active:bg-brand-900 text-base font-semibold text-white active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
      >
        {busy
          ? "Saving…"
          : needsProof && proofKind === "call" && office
            ? `Mark ${rupees(totalNum)} received and call`
            : `Mark ${rupees(totalNum)} received`}
      </button>
      {!proofDone ? (
        <p className="text-center text-sm text-slate-500">Add proof of the UPI payment first.</p>
      ) : !teamChosen ? (
        <p className="text-center text-sm text-slate-500">Choose who worked with you, or &ldquo;I worked alone&rdquo;.</p>
      ) : null}
    </section>
  );
}

const PROOF_ICON: Record<ProofKind, string> = {
  camera: "M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.3-2h6l1.3 2h1.2A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8ZM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  screenshot: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM11 18h2M9 9l2 2 4-4",
  call: "M5 4h3.5l1.5 4-2.2 1.4a11 11 0 0 0 4.8 4.8L14 12l4 1.5V17a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2Z",
};

/**
 * After the customer pays by UPI: proof the office can check. A live photo of
 * the customer's success screen, a screenshot they sent, or (when neither is
 * possible) a call to the office, who confirm it with the customer.
 */
function UpiProof({
  kind,
  preview,
  amount,
  office,
  onPick,
}: {
  kind: ProofKind | null;
  preview: string | null;
  amount: number;
  office: { full_name: string; phone: string } | null;
  onPick: (kind: ProofKind, file: File | null) => void;
}) {
  const options: { value: ProofKind; title: string; hint: string }[] = [
    { value: "camera", title: "Take a photo", hint: "Of the customer's \u201cpayment successful\u201d screen" },
    { value: "screenshot", title: "Upload a screenshot", hint: "One the customer sent you, e.g. on WhatsApp" },
    { value: "call", title: "No photo? Call the office", hint: "They confirm the payment with the customer" },
  ];
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">Proof of the {rupees(amount)} UPI payment</legend>
      <div className="divide-y divide-brand-950/[0.07] overflow-hidden rounded-xl border border-slate-900/10">
        {options.map((o) => {
          const on = kind === o.value;
          const row = `flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left ${on ? "bg-brand-50" : "active:bg-slate-50"}`;
          const body = (
            <>
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${on ? "bg-brand-950 text-white" : "bg-slate-100 text-slate-700"}`}>
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={PROOF_ICON[o.value]} />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{o.title}</span>
                <span className="block text-sm text-slate-600">{o.hint}</span>
              </span>
              {on ? (
                <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-brand-700" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              ) : null}
            </>
          );
          if (o.value === "call") {
            return (
              <button key={o.value} type="button" aria-pressed={on} onClick={() => onPick("call", null)} className={row}>
                {body}
              </button>
            );
          }
          return (
            <label key={o.value} className={`${row} cursor-pointer`}>
              <input
                type="file"
                accept="image/*"
                capture={o.value === "camera" ? "environment" : undefined}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPick(o.value, f);
                  e.target.value = "";
                }}
              />
              {body}
            </label>
          );
        })}
      </div>
      {preview && kind !== "call" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo just taken
        <img src={preview} alt="Payment proof you added" className="mt-2 max-h-56 w-full rounded-xl border border-slate-900/10 bg-slate-50 object-contain" />
      ) : null}
      {kind === "call" ? (
        <p className="mt-2 rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
          {office
            ? `After you mark it, your phone opens the dialler to call ${office.full_name} (${office.phone}). Tell them the amount; the payment stays open until they confirm it with the customer.`
            : "Call the office now and tell them the amount. The payment stays open until they confirm it with the customer."}
        </p>
      ) : null}
    </fieldset>
  );
}

function UpiQr({
  upi,
  amount,
  jobNumber,
}: {
  upi: { id: string; name: string };
  amount: number;
  jobNumber: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const link = upiLink({ id: upi.id, name: upi.name, amount, jobNumber });

  useEffect(() => {
    let live = true;
    void QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => {
      if (live) setSvg(s);
    });
    return () => {
      live = false;
    };
  }, [link]);

  return (
    <div className="rounded-xl border border-slate-900/10 p-4 text-center">
      <p className="text-sm text-slate-600">Show this to the customer</p>
      {/* Our own generated SVG, not outside content. */}
      <div
        aria-label={`UPI QR code for ${rupees(amount)}`}
        role="img"
        className="mx-auto my-2 w-full max-w-64"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <p className="text-2xl font-semibold tabular-nums text-slate-900">{rupees(amount)}</p>
      <p className="text-sm text-slate-600">
        to {upi.name} ({upi.id})
      </p>
      <p className="mt-2 text-xs text-slate-500">Check the customer&apos;s phone shows the payment as successful.</p>
    </div>
  );
}
