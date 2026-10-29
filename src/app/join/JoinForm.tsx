"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressToJpeg } from "@/lib/image";

/**
 * New staff sign-up.
 *
 * The mobile number is the username, so there is nothing new to remember.
 * Documents: the Aadhaar card always, plus a driving licence, or the back of
 * the Aadhaar for someone without a licence. Photos are shrunk on the phone
 * before upload (a 9 MB camera photo becomes ~300 KB), which also turns an
 * iPhone HEIC into a JPEG the server accepts. PDFs go as they are.
 */

const EMAIL_DOMAIN = process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? "cleanify.internal";

type Doc = { file: File; preview: string | null } | null;

async function prepare(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    // Large enough that the Aadhaar text stays readable when zoomed.
    const { blob } = await compressToJpeg(canvas, { maxEdge: 1800, quality: 0.82 });
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // the server checks the format and says so if it is unusable
  }
}

const input =
  "w-full tap rounded-xl border-2 border-slate-200 bg-white px-3 text-base outline-none focus:border-brand-600";

export function JoinForm() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hasLicence, setHasLicence] = useState<boolean | null>(null);
  const [aadhaar, setAadhaar] = useState<Doc>(null);
  const [second, setSecond] = useState<Doc>(null);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const secondLabel = hasLicence ? "Driving licence" : "Back of the Aadhaar card";

  async function pick(file: File | undefined, set: (d: Doc) => void) {
    if (!file) return;
    setError(null);
    const ready = await prepare(file);
    set({ file: ready, preview: ready.type.startsWith("image/") ? URL.createObjectURL(ready) : null });
  }

  function problem(): string | null {
    if (fullName.trim().length < 2) return "Enter your full name.";
    if (!/^[6-9]\d{9}$/.test(digits)) return "Enter your 10-digit mobile number.";
    if (address.trim().length < 8) return "Enter your full address.";
    if (password.length < 8) return "Choose a password with at least 8 characters.";
    if (!aadhaar) return "Add a photo of your Aadhaar card.";
    if (hasLicence === null) return "Tell us if you have a driving licence.";
    if (!second) return `Add a photo of your ${secondLabel.toLowerCase()}.`;
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    setError(null);
    setBusy("Uploading your documents…");

    const body = new FormData();
    body.set("full_name", fullName);
    body.set("phone", digits);
    body.set("address", address);
    body.set("password", password);
    body.set("has_licence", hasLicence ? "yes" : "no");
    body.set("website", website);
    body.set("aadhaar_front", aadhaar!.file);
    body.set(hasLicence ? "licence" : "aadhaar_back", second!.file);

    let res: Response;
    try {
      res = await fetch("/api/join", { method: "POST", body });
    } catch {
      setBusy(null);
      return setError("No connection. Check your signal and try again.");
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setBusy(null);
      return setError(json.error ?? "Your account could not be created. Try again.");
    }

    setBusy("Signing you in…");
    await createClient().auth.signInWithPassword({ email: `${digits}@${EMAIL_DOMAIN}`, password });
    window.location.replace("/join/status");
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Full name" htmlFor="j-name">
        <input id="j-name" className={input} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>

      <Field label="Mobile number" htmlFor="j-phone" hint="You will sign in with this number.">
        <input
          id="j-phone"
          className={input}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>

      <Field label="Home address" htmlFor="j-address">
        <textarea
          id="j-address"
          rows={3}
          className={`${input} py-2`}
          autoComplete="street-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>

      <Field label="Choose a password" htmlFor="j-password" hint="At least 8 characters.">
        <div className="relative">
          <input
            id="j-password"
            className={`${input} pr-14`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-14 items-center justify-center text-slate-400"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword ? <path d="M3 3l18 18" /> : null}
            </svg>
          </button>
        </div>
      </Field>

      <section className="space-y-4 rounded-2xl border-2 border-slate-200 bg-white p-4">
        <div>
          <p className="font-semibold text-slate-900">ID documents</p>
          <p className="text-sm text-slate-500">Two are needed. The office checks them before your account is switched on.</p>
        </div>

        <DocPicker id="j-aadhaar" label="Aadhaar card" hint="Front side, all text readable" doc={aadhaar} onPick={(f) => pick(f, setAadhaar)} />

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Do you have a driving licence?</p>
          <div className="flex gap-2">
            {[
              [true, "Yes"],
              [false, "No"],
            ].map(([v, label]) => (
              <button
                key={label as string}
                type="button"
                aria-pressed={hasLicence === v}
                onClick={() => {
                  setHasLicence(v as boolean);
                  setSecond(null);
                }}
                className={`tap flex-1 rounded-xl border-2 font-semibold ${
                  hasLicence === v ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600"
                }`}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>

        {hasLicence !== null ? (
          <DocPicker
            id="j-second"
            label={secondLabel}
            hint={hasLicence ? "Front side, photo and number readable" : "The side with your address"}
            doc={second}
            onPick={(f) => pick(f, setSecond)}
          />
        ) : null}
      </section>

      {/* Hidden from people; bots fill it in. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />

      {error ? <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{error}</p> : null}

      <button
        type="submit"
        disabled={busy !== null}
        className="tap-lg w-full rounded-xl bg-brand-700 text-base font-semibold text-white disabled:opacity-50"
      >
        {busy ?? "Create my account"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <a href="/login" className="font-semibold text-brand-700">
          Sign in
        </a>
      </p>
    </form>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function DocPicker({
  id,
  label,
  hint,
  doc,
  onPick,
}: {
  id: string;
  label: string;
  hint: string;
  doc: Doc;
  onPick: (f: File | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xs font-semibold text-slate-500">
        {doc?.preview ? (
          // A local blob: preview of the file just picked.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.preview} alt="" className="size-full object-cover" />
        ) : doc ? (
          "PDF"
        ) : (
          "—"
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug text-slate-900">
          {label}
          <span className="text-danger-600">{"\u00a0*"}</span>
        </p>
        <p className="text-xs text-slate-500">{doc ? "Added. Tap Change to pick another." : hint}</p>
      </div>
      <label
        htmlFor={id}
        className={`tap flex shrink-0 cursor-pointer items-center rounded-xl px-3 text-sm font-semibold ${
          doc ? "border-2 border-slate-200 text-slate-600" : "bg-brand-700 text-white"
        }`}
      >
        {doc ? "Change" : "Add photo"}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}
