import type { CheckinPolicy, CheckinPolicyParams } from "./database";

export const IST_TZ = "Asia/Kolkata";

/**
 * ============================================================================
 * The deadline, mirrored from SQL.
 * ============================================================================
 *
 * `public.compute_deadline()` in the database is AUTHORITATIVE. Every screen
 * that shows a real deadline reads the stored `day_rosters.required_checkin_at`
 * or `jobs.required_arrival_at` — never this function.
 *
 * This mirror exists for exactly one job: showing a human what a deadline
 * WOULD become before they commit. The new-job wizard and the reschedule modal
 * both need that preview, because without it nobody understands the cascade
 * and they blame the app when a deadline moves.
 *
 * Keeping the arithmetic in one place server-side is what makes swapping the
 * check-in policy a config change. If you find yourself reaching for this
 * function to drive real behaviour, that is the bug.
 */
export function previewDeadline(args: {
  policy: CheckinPolicy;
  scheduledStart: Date;
  travelMinutes: number;
  serviceDate: string; // YYYY-MM-DD in IST
}): Date {
  const p: CheckinPolicyParams = args.policy.params ?? {};
  const lead = p.lead_minutes ?? 30;

  // A fixed wall-clock policy ignores both travel and the scheduled start.
  if (p.clock_time) {
    return istWallClockToUtc(args.serviceDate, p.clock_time);
  }

  const travel = p.include_travel ? (args.travelMinutes ?? 0) : 0;
  return new Date(args.scheduledStart.getTime() - (travel + lead) * 60_000);
}

export function previewReminderAt(deadline: Date, policy: CheckinPolicy): Date {
  const lead = policy.params?.reminder_lead_minutes ?? 15;
  return new Date(deadline.getTime() - lead * 60_000);
}

/**
 * Convert an IST wall-clock date+time to a real instant.
 *
 * India is UTC+5:30 with no DST and no sub-zones, which removes an entire
 * class of bug. The offset is therefore a constant, not a lookup.
 */
export function istWallClockToUtc(dateISO: string, time: string): Date {
  const [h = "0", m = "0"] = time.split(":");
  return new Date(
    `${dateISO}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00+05:30`,
  );
}

/** The IST calendar date for an instant — matches the generated column in SQL. */
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * ============================================================================
 * Server-synced clock
 * ============================================================================
 *
 * The supervisor's countdown must never depend on the device clock (which can
 * be wrong, or deliberately changed) nor on a push arriving (which on iOS
 * silently does not, unless the PWA was installed to the Home Screen).
 *
 * So: measure the offset between this device and the server once, then run the
 * countdown locally against the corrected time. Push is a nudge; this is the
 * mechanism.
 */
let clockOffsetMs = 0;
let synced = false;

export async function syncServerClock(fetchImpl: typeof fetch = fetch): Promise<number> {
  const t0 = Date.now();
  try {
    const res = await fetchImpl("/api/time", { cache: "no-store" });
    const t1 = Date.now();
    const { now } = (await res.json()) as { now: string };
    const serverMs = new Date(now).getTime();
    // assume a symmetric round trip
    clockOffsetMs = serverMs - (t0 + (t1 - t0) / 2);
    synced = true;
  } catch {
    clockOffsetMs = 0; // fall back to the device clock rather than breaking
  }
  return clockOffsetMs;
}

export function serverNow(): Date {
  return new Date(Date.now() + clockOffsetMs);
}

export function isClockSynced(): boolean {
  return synced;
}

export function clockSkewMs(): number {
  return clockOffsetMs;
}

/**
 * ============================================================================
 * Countdown presentation
 * ============================================================================
 */
export type CountdownState = {
  msRemaining: number;
  late: boolean;
  /** Within the reminder window — the UI should start pressing. */
  urgent: boolean;
  label: string;
};

export function countdownTo(
  deadline: Date | string | null,
  opts: { urgentWithinMin?: number } = {},
): CountdownState | null {
  if (!deadline) return null;
  const target = typeof deadline === "string" ? new Date(deadline) : deadline;
  const ms = target.getTime() - serverNow().getTime();
  const urgentWithin = (opts.urgentWithinMin ?? 15) * 60_000;

  return {
    msRemaining: ms,
    late: ms < 0,
    urgent: ms >= 0 && ms <= urgentWithin,
    label: formatDuration(Math.abs(ms)),
  };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60_000) / 1000);
  if (totalMin === 0) return `${s}s`;
  return `${m}m`;
}

/** Times are always shown in IST, whatever the device thinks it is. */
export function formatIstTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function formatIstDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(typeof d === "string" ? new Date(d) : d);
}
