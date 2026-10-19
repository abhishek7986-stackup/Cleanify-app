"use client";

export type Fix = {
  lat: number;
  lng: number;
  accuracyM: number;
  at: string;
};

/**
 * Take the BEST of several readings rather than the first one back.
 *
 * The first fix a phone returns is usually a coarse network estimate; the GPS
 * fix that follows a few seconds later can be an order of magnitude better.
 * Accepting the first reading is how you end up flagging honest supervisors
 * as "far from expected".
 */
export function getBestFix(opts: { timeoutMs?: number; samples?: number } = {}): Promise<Fix | null> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const wanted = opts.samples ?? 3;

  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }

    let best: Fix | null = null;
    let count = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      resolve(best);
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          at: new Date(pos.timestamp).toISOString(),
        };
        if (!best || fix.accuracyM < best.accuracyM) best = fix;
        count++;
        // Good enough, or we have sampled enough times.
        if ((best && best.accuracyM <= 20) || count >= wanted) finish();
      },
      () => finish(), // denied or unavailable: a missing fix is a flag, not a block
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );

    const timer = setTimeout(finish, timeoutMs);
  });
}
