import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { fillTravelForDay } from "@/lib/travel";

export const dynamic = "force-dynamic";

/**
 * Fills real travel times for one supervisor's day, then recomputes it.
 *
 * POST { supervisorId, date }  ->  { asked, filled, failed }
 *
 * Called in the background after a job is booked or moved, and when a day is
 * opened. Office staff may fill any supervisor's day; a supervisor only their
 * own. Cheap to call often: legs already answered are not asked again.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { supervisorId?: unknown; date?: unknown } | null;
  const supervisorId = typeof body?.supervisorId === "string" ? body.supervisorId : null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (!supervisorId || !date) {
    return NextResponse.json({ error: "supervisorId and date (YYYY-MM-DD) are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, is_active").eq("id", auth.user.id).maybeSingle();
  const office = me?.is_active && (me.role === "admin" || me.role === "sales_rep");
  if (!office && auth.user.id !== supervisorId) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  try {
    return NextResponse.json(await fillTravelForDay(admin, supervisorId, date));
  } catch (e) {
    console.error("travel fill failed", e);
    return NextResponse.json({ error: "Could not update travel times" }, { status: 500 });
  }
}
