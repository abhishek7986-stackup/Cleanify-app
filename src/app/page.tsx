import { redirect } from "next/navigation";
import { getSessionProfile, roleHome } from "@/lib/data/session";

/**
 * The proxy normally redirects "/" before this renders. This is the fallback
 * for the case where it does not — a direct render, or a stale claim.
 */
export default async function Home() {
  const profile = await getSessionProfile();
  redirect(profile ? roleHome(profile.role) : "/login");
}
