"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { detectPlatform, isStandalone, pushDeliverable, subscribeToPush } from "@/lib/pwa";
import { useIsStandalone, usePlatform } from "@/lib/pwa-store";

/**
 * ============================================================================
 * Install and notification onboarding
 * ============================================================================
 *
 * On iPhone, Web Push is delivered ONLY when the PWA has been added to the
 * Home Screen (iOS 16.4+), and there is no `beforeinstallprompt` — install
 * cannot be triggered in code. A supervisor running this in a Safari tab
 * receives nothing at all, and the failure is invisible from the server.
 *
 * So this nags until the app is standalone, and records the resulting push
 * subscription (with platform and standalone state) so an admin can SEE which
 * devices are actually reachable rather than finding out at 07:05 when someone
 * is already late.
 *
 * Note what this banner is not: it is not what makes the check-in deadline
 * work. The countdown runs against a server-synced clock whether or not push
 * ever arrives. Push is a nudge.
 */
const COPY = {
  supervisor: {
    install: "On iPhone, reminders only work from the installed app.",
    deniedTitle: "Reminders are blocked",
    deniedBody: "You will not get the 15-minute check-in reminder.",
    onTitle: "Turn on check-in reminders",
    onBody: "You will get a nudge 15 minutes before each check-in is due, and when your photos are approved.",
  },
  approver: {
    install: "On iPhone, approval alerts only work from the installed app.",
    deniedTitle: "Approval alerts are blocked",
    deniedBody: "You will not hear when a supervisor is waiting for you.",
    onTitle: "Get an alert when someone needs approval",
    onBody: "Supervisors wait for you before they can start. You will get an alert straight away, and a reminder at 10 and 30 minutes.",
  },
} as const;

/** Links this device's alerts to whoever is signed in now. */
async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase.from("push_subscriptions").upsert(
    {
      user_id: auth.user.id,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent,
      platform: detectPlatform(),
      is_standalone: isStandalone(),
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
    },
    { onConflict: "endpoint" },
  );
}

export function InstallGate({ audience = "supervisor" }: { audience?: "supervisor" | "approver" }) {
  const copy = COPY[audience];
  const platform = usePlatform();
  const standalone = useIsStandalone();
  // Assume deliverable until proven otherwise, so nothing flashes before
  // hydration has had a chance to check.
  const [state, setState] = useState<{ ok: boolean; reason?: string }>({ ok: true });
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Deferred past the synchronous effect phase: a setState called straight
    // out of an effect body triggers a cascading render.
    const id = requestAnimationFrame(() => {
      const s = pushDeliverable();
      setState(s);
      // Alerts already on: make sure they go to the person signed in NOW
      // (a shared phone, or a sign-out and sign-in as someone else).
      if (s.ok) {
        void navigator.serviceWorker?.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then((sub) => (sub ? saveSubscription(sub) : undefined))
          .catch(() => {});
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  async function enableAlerts() {
    setBusy(true);
    try {
      // Must be inside a user gesture — iOS rejects a permission request that
      // is not.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(pushDeliverable());
        return;
      }

      const sub = await subscribeToPush();
      if (sub) await saveSubscription(sub);
      setState(pushDeliverable());
    } finally {
      setBusy(false);
    }
  }

  if (dismissed || state.ok) return null;

  // iOS, not installed: alerts are impossible until they add it to the Home
  // Screen. Show them how, and do not offer an "enable" button that cannot work.
  if (platform === "ios" && !standalone) {
    return (
      <Banner tone="warn">
        <p className="font-semibold">Add Cleanify to your Home Screen</p>
        <p className="mt-1 text-sm">
          {copy.install} Tap the Share
          button at the bottom of Safari, then choose{" "}
          <span className="font-medium">Add to Home Screen</span>. Open Cleanify
          from the new icon and sign in once more.
        </p>
      </Banner>
    );
  }

  if (state.reason === "denied") {
    return (
      <Banner tone="danger" onDismiss={() => setDismissed(true)}>
        <p className="font-semibold">{copy.deniedTitle}</p>
        <p className="mt-1 text-sm">
          {copy.deniedBody} Allow notifications for Cleanify in your phone&apos;s
          settings to turn them back on.
        </p>
      </Banner>
    );
  }

  return (
    <Banner tone="brand" onDismiss={() => setDismissed(true)}>
      <p className="font-semibold">{copy.onTitle}</p>
      <p className="mt-1 text-sm">{copy.onBody}</p>
      <button
        type="button"
        onClick={() => void enableAlerts()}
        disabled={busy}
        className="tap mt-3 rounded-xl bg-brand-700 px-5 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Enabling…" : "Enable alerts"}
      </button>
    </Banner>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "brand" | "warn" | "danger";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    brand: "bg-brand-50 border-brand-200 text-brand-900",
    warn: "bg-warn-50 border-warn-100 text-warn-700",
    danger: "bg-danger-50 border-danger-100 text-danger-700",
  } as const;

  return (
    <div className={`relative rounded-2xl border p-4 ${tones[tone]}`}>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 size-9 rounded-full text-lg leading-none opacity-60"
        >
          ×
        </button>
      ) : null}
      {children}
    </div>
  );
}
