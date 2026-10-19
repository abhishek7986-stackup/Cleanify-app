import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The reference clock for every countdown in the supervisor app.
 *
 * Deliberately unauthenticated and trivially cheap: the check-in countdown has
 * to keep working even when push has silently died, and a device whose own
 * clock is wrong must still see the right deadline.
 */
export async function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
