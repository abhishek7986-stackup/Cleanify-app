import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/domain/database";

/**
 * Data Access Layer for identity.
 *
 * Auth is checked HERE, per page, and not in a layout: a layout does not
 * re-render when you navigate between its child routes, so a check placed
 * there can be stale. The proxy's redirect is a convenience for the user; RLS
 * in the database is the actual boundary. This sits in between so a page never
 * renders someone else's data even for a moment.
 */
/**
 * The signed-in user's id, from the JWT.
 *
 * getClaims() verifies the token locally against the project's cached public
 * key (this project signs with ES256), where getUser() is a network round trip
 * to Supabase Auth on every page. cache() makes it once per request however
 * many helpers ask.
 */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

export const getSessionProfile = cache(async (): Promise<Profile | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, is_active, locale, base_address")
    .eq("id", userId)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});

export async function requireProfile(): Promise<Profile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?reason=deactivated");
  return profile;
}

export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  // Admin can look at every surface; it is the role that fixes things.
  if (profile.role !== "admin" && !roles.includes(profile.role)) {
    redirect(roleHome(profile.role));
  }
  return profile;
}

export function roleHome(role: UserRole): string {
  return role === "admin" ? "/admin" : role === "sales_rep" ? "/sales" : "/s";
}
