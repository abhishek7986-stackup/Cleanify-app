"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Two sign-in modes.
 *
 * Password is the M0 default deliberately. Phone OTP is the intended end
 * state, but it depends on WhatsApp Business template approval, which takes
 * days — and putting that on the critical path would block the whole build.
 * Both modes write the same auth user, so switching later needs no migration:
 * flip NEXT_PUBLIC_AUTH_MODE to "otp" once the templates clear.
 *
 * OTP is routed over WhatsApp via Supabase's Send-SMS auth hook, which also
 * sidesteps India's DLT registration for SMS sender IDs (a 1-3 week wait).
 */
const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === "otp" ? "otp" : "password";
const EMAIL_DOMAIN = process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? "cleanify.internal";

/**
 * A full page load, not router.replace + router.refresh. Those two fire at
 * once, and on phones the second cancels the first mid-stream, so sign-in
 * succeeded but the next screen never loaded. A full load also drops any
 * screens cached for whoever was signed in before on this phone.
 *
 * Only same-site paths are followed, so ?next= cannot send someone off-site.
 */
function goHome(next: string | null) {
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  window.location.replace(safe);
}

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const email = username.includes("@")
      ? username.trim()
      : `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError("That username or password was not recognised.");
      return;
    }
    goHome(next);
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const e164 = phone.startsWith("+") ? phone.trim() : `+91${phone.replace(/\D/g, "")}`;
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (err) {
      setError("Could not send the code. Check the number and try again.");
      return;
    }
    setOtpSent(true);
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const e164 = phone.startsWith("+") ? phone.trim() : `+91${phone.replace(/\D/g, "")}`;
    const { error: err } = await supabase.auth.verifyOtp({
      phone: e164,
      token: code.trim(),
      type: "sms",
    });
    setBusy(false);
    if (err) {
      setError("That code was not correct or has expired.");
      return;
    }
    goHome(next);
  }

  const field =
    "w-full tap rounded-xl border-2 border-slate-200 bg-white px-4 text-base " +
    "outline-none focus:border-brand-600";
  const button =
    "w-full tap-lg rounded-xl bg-brand-700 text-base font-semibold text-white " +
    "disabled:opacity-50";

  if (AUTH_MODE === "otp") {
    return (
      <form onSubmit={otpSent ? verifyOtp : sendOtp} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Mobile number
          </span>
          <input
            className={field}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={otpSent}
            required
          />
        </label>

        {otpSent ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Code sent on WhatsApp
            </span>
            <input
              className={`${field} tracking-[0.4em]`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
        ) : null}

        {error ? <p className="text-sm text-danger-600">{error}</p> : null}

        <button type="submit" className={button} disabled={busy}>
          {busy ? "Please wait…" : otpSent ? "Sign in" : "Send code"}
        </button>

        {otpSent ? (
          <button
            type="button"
            className="w-full tap text-sm text-slate-500"
            onClick={() => {
              setOtpSent(false);
              setCode("");
            }}
          >
            Use a different number
          </button>
        ) : null}
      </form>
    );
  }

  return (
    <form onSubmit={signInWithPassword} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Username</span>
        <input
          className={field}
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          placeholder="ravi"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
        <div className="relative">
          <input
            className={`${field} pr-14`}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-14 items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword ? <path d="M3 3l18 18" /> : null}
            </svg>
          </button>
        </div>
      </label>

      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      <button type="submit" className={button} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <p className="pt-2 text-center text-sm text-slate-500">
        Forgotten your password? Ask an admin to reset it.
      </p>
    </form>
  );
}
