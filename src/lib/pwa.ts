/**
 * PWA capability detection.
 *
 * The iOS rules are the whole reason this file exists:
 *   - Web Push is delivered ONLY to a PWA installed to the Home Screen (16.4+).
 *   - There is no `beforeinstallprompt`, so install cannot be triggered in
 *     code — the user must be walked through Share -> Add to Home Screen.
 *   - The failure is invisible from the server: a supervisor in a Safari tab
 *     simply never receives anything.
 */

export type Platform = "ios" | "android" | "desktop" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop";
  return "other";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari's own non-standard flag
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Can this device receive a push RIGHT NOW, as configured?
 *
 * On iOS the answer is no until the app is installed, no matter what
 * `pushSupported()` says.
 */
export function pushDeliverable(): { ok: boolean; reason?: string } {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (detectPlatform() === "ios" && !isStandalone()) {
    return { ok: false, reason: "ios-not-installed" };
  }
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  if (Notification.permission === "default") return { ok: false, reason: "not-granted" };
  return { ok: true };
}

/** base64url VAPID key -> Uint8Array, as PushManager requires. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Allocate the backing ArrayBuffer explicitly: `new Uint8Array(length)` is
  // typed over ArrayBufferLike, which PushManager's BufferSource will not take.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return null;
  if (!pushSupported()) return null;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  return reg.pushManager.subscribe({
    // Browsers require this to be true; a genuinely silent push is not an
    // option, which is why the heartbeat shows a short useful message.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
}
