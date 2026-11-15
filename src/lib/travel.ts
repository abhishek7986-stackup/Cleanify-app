import type { createAdminClient } from "@/lib/supabase/server";

/**
 * Real travel times for a supervisor's day, from Google Routes.
 *
 * The database already chains the day (depot -> job 1 -> job 2 ...) and reads
 * travel times from a cache; this fills that cache. Only legs with no fresh
 * answer are asked for, so a day costs a handful of calls once and nothing
 * after that. Any leg Google cannot answer keeps the straight-line guess, and
 * the job still shows "estimated travel" to the office.
 *
 * Supervisors ride scooters, so legs are routed as TWO_WHEELER (supported in
 * India), with live traffic for trips still in the future.
 */

type Admin = ReturnType<typeof createAdminClient>;

type Leg = {
  job_id: string;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  arrive_at: string;
  seed_minutes: number;
  cached: boolean;
};

export type FillResult = { asked: number; filled: number; failed: number; skipped?: string };

export async function fillTravelForDay(admin: Admin, supervisorId: string, date: string): Promise<FillResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { asked: 0, filled: 0, failed: 0, skipped: "GOOGLE_MAPS_SERVER_KEY is not set" };

  const { data, error } = await admin.rpc("travel_legs", { p_supervisor: supervisorId, p_date: date });
  if (error) throw new Error(`travel_legs: ${error.message}`);
  const legs = ((data ?? []) as Leg[]).filter((l) => !l.cached);

  let filled = 0;
  let failed = 0;
  for (const leg of legs) {
    const departAt = new Date(new Date(leg.arrive_at).getTime() - leg.seed_minutes * 60_000);
    const route = await askGoogle(key, leg, departAt).catch((e) => {
      console.error("Google Routes failed", e);
      return null;
    });
    if (!route) {
      failed++;
      continue;
    }
    const { error: storeErr } = await admin.rpc("store_travel_estimate", {
      p_origin_lat: leg.origin_lat,
      p_origin_lng: leg.origin_lng,
      p_dest_lat: leg.dest_lat,
      p_dest_lng: leg.dest_lng,
      p_arrive_at: leg.arrive_at,
      p_seed_minutes: leg.seed_minutes,
      p_seconds: route.seconds,
      p_meters: route.meters,
      p_raw: { mode: route.mode, traffic: route.traffic },
    });
    if (storeErr) {
      console.error("store_travel_estimate", storeErr.message);
      failed++;
    } else {
      filled++;
    }
  }

  // Re-run the day's deadlines with the real times.
  if (filled) {
    const { error: rErr } = await admin.rpc("recompute_day", { p_supervisor: supervisorId, p_date: date });
    if (rErr) console.error("recompute_day", rErr.message);
  }
  return { asked: legs.length, filled, failed };
}

async function askGoogle(
  key: string,
  leg: Leg,
  departAt: Date,
): Promise<{ seconds: number; meters: number; mode: string; traffic: boolean } | null> {
  // Live traffic only applies to a departure in the future.
  const traffic = departAt.getTime() > Date.now() + 60_000;
  for (const mode of ["TWO_WHEELER", "DRIVE"] as const) {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: leg.origin_lat, longitude: leg.origin_lng } } },
        destination: { location: { latLng: { latitude: leg.dest_lat, longitude: leg.dest_lng } } },
        travelMode: mode,
        routingPreference: traffic ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
        ...(traffic ? { departureTime: departAt.toISOString() } : {}),
      }),
    });
    if (!res.ok) {
      // Two-wheeler routing is not offered everywhere; try a car route once.
      if (mode === "TWO_WHEELER" && res.status === 400) continue;
      throw new Error(`Routes ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { routes?: { duration?: string; distanceMeters?: number }[] };
    const r = json.routes?.[0];
    const seconds = r?.duration ? parseInt(r.duration, 10) : NaN;
    if (!Number.isFinite(seconds)) {
      if (mode === "TWO_WHEELER") continue;
      return null;
    }
    return { seconds, meters: r?.distanceMeters ?? 0, mode, traffic };
  }
  return null;
}
