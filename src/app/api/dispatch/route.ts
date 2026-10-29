import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";
import { formatIstTime } from "@/lib/domain/checkin-policy";
import type { NotificationRow } from "@/lib/domain/database";

export const dynamic = "force-dynamic";

/**
 * Sends whatever notifications are due. Called every minute by pg_cron
 * (public.trigger_dispatch) with `Authorization: Bearer <DISPATCH_SECRET>`.
 *
 * The outbox does the hard parts: claim_notifications() locks rows with
 * SKIP LOCKED, so two overlapping calls can never double-send, and a crashed
 * send is retried after its lease runs out. This route only delivers:
 *
 *   web_push  to every device the person enabled alerts on
 *   in_app    nothing to send; marking it SENT puts it in their inbox
 *   whatsapp  not connected yet; marked failed so it is visible, not retried
 *
 * A device that has uninstalled the app answers 404/410 and is switched off.
 */

type Note = NotificationRow;

function authorised(request: NextRequest): boolean {
  const secret = process.env.DISPATCH_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 24 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** Text for the older templates whose payload carries data, not a message. */
function render(n: Note): { title: string; body: string; url: string } {
  const p = n.payload;
  if (typeof p.title === "string") {
    return { title: p.title, body: String(p.body ?? ""), url: String(p.url ?? "/") };
  }
  const who = String(p.supervisor ?? "A supervisor");
  const by = typeof p.deadline === "string" ? formatIstTime(p.deadline) : "";
  switch (n.template_key) {
    case "checkin.reminder":
      return { title: "Check in soon", body: `Depot check-in is due by ${by}.`, url: "/s/checkin" };
    case "checkin.late.supervisor":
      return { title: "You are late for check-in", body: "Check in now. It is still accepted, marked late.", url: "/s/checkin" };
    case "checkin.late.staff":
      return { title: `${who} has not checked in`, body: `The check-in was due at ${by}.`, url: "/sales/approvals" };
    case "checkin.approved":
      return { title: "Check-in approved", body: "Your jobs are unlocked.", url: "/s" };
    case "checkin.rejected":
      return {
        title: "Check-in photos not approved",
        body: String(p.reason ?? "Retake them and send again."),
        url: "/s/checkin",
      };
    default:
      return { title: "Cleanify", body: "You have an update.", url: "/" };
  }
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:ops@cleanify.example";
  const pushReady = Boolean(pub && priv);
  if (pushReady) webpush.setVapidDetails(subject, pub!, priv!);

  const db = createAdminClient();
  const worker = `app-${process.pid}-${Date.now()}`;
  const { data, error } = await db.rpc("claim_notifications", { p_worker: worker, p_limit: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const notes = (data ?? []) as Note[];

  const sent = (id: string, ref?: string) =>
    db.rpc("mark_notification_sent", { p_id: id, p_provider_msg_id: ref ?? null });
  const giveUp = (id: string, reason: string) =>
    db
      .from("notifications")
      .update({ state: "FAILED", failed_at: new Date().toISOString(), last_error: reason, lease_expires_at: null })
      .eq("id", id);
  const retry = (id: string, reason: string) =>
    db.rpc("mark_notification_failed", { p_id: id, p_error: reason });

  const counts = { push: 0, in_app: 0, stale: 0, failed: 0, no_device: 0 };
  const now = Date.now();

  for (const n of notes) {
    // An alert that arrives hours late is noise ("check in soon" at noon).
    if (now - new Date(n.due_at).getTime() > n.stale_after_min * 60_000) {
      await db
        .from("notifications")
        .update({ state: "CANCELLED", last_error: "stale", lease_expires_at: null })
        .eq("id", n.id);
      counts.stale++;
      continue;
    }

    if (n.channel === "in_app") {
      await sent(n.id);
      counts.in_app++;
      continue;
    }

    if (n.channel !== "web_push") {
      await giveUp(n.id, `${n.channel} is not connected yet`);
      counts.failed++;
      continue;
    }

    if (!pushReady) {
      await retry(n.id, "push keys are not configured");
      counts.failed++;
      continue;
    }

    const { data: subs } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", n.recipient_id)
      .is("disabled_at", null);
    const devices = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
    if (devices.length === 0) {
      await giveUp(n.id, "no device has alerts switched on");
      counts.no_device++;
      continue;
    }

    const msg = render(n);
    const body = JSON.stringify({
      ...msg,
      template_key: n.template_key,
      job_id: n.job_id ?? "",
      roster_id: n.roster_id ?? "",
      critical: n.payload.critical === true,
    });

    let delivered = 0;
    let lastError = "";
    for (const d of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          body,
          { TTL: 60 * 60, urgency: n.payload.critical === true ? "high" : "normal" },
        );
        delivered++;
        await db
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", d.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        lastError = `push ${status ?? "error"}`;
        // Gone for good: the app was uninstalled or alerts switched off.
        if (status === 404 || status === 410) {
          await db
            .from("push_subscriptions")
            .update({ disabled_at: new Date().toISOString() })
            .eq("id", d.id);
        }
      }
    }

    if (delivered > 0) {
      await sent(n.id, `${delivered}/${devices.length} devices`);
      counts.push++;
    } else {
      await retry(n.id, lastError || "no device accepted the push");
      counts.failed++;
    }
  }

  return NextResponse.json({ claimed: notes.length, ...counts });
}
