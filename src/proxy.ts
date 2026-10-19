import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { UserRole } from "@/lib/domain/database";

/**
 * Proxy — what Next.js called Middleware before v16.
 *
 * Two jobs, and deliberately only two:
 *
 *  1. Refresh the Supabase session and write the rotated cookies onto the
 *     response. Server Components cannot set cookies, so if this stops
 *     happening sessions expire in ways that are extremely hard to debug.
 *
 *  2. OPTIMISTIC routing — send a signed-out visitor to /login and drop a
 *     signed-in one on their role's home screen.
 *
 * This is NOT the authorization mechanism. The role here comes from a JWT
 * claim the proxy has not independently verified against the database, and a
 * redirect is not a permission check. Row Level Security is what actually
 * stops a supervisor reading another supervisor's jobs.
 */

const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  sales_rep: "/sales",
  supervisor: "/s",
};

const ROLE_PREFIX: Record<UserRole, string[]> = {
  admin: ["/admin", "/sales", "/s"], // admin may look at every surface
  sales_rep: ["/sales"],
  supervisor: ["/s"],
};

const PUBLIC_PATHS = ["/login", "/auth", "/offline", "/api/time"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must happen before any response is generated, or a refresh that completes
  // late cannot be written back and the next request refreshes all over again.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as
    | { sub?: string; app_metadata?: { role?: UserRole; is_active?: boolean } }
    | undefined;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const role = claims?.app_metadata?.role;
  const signedIn = Boolean(claims?.sub);

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (signedIn && (path === "/" || path === "/login")) {
    const url = request.nextUrl.clone();
    url.pathname = role ? ROLE_HOME[role] : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Wrong surface for this role — bounce them home rather than 403, since this
  // is only ever a navigation accident. The real block is in the database.
  if (signedIn && role && !isPublic) {
    const allowed = ROLE_PREFIX[role] ?? [];
    const onOwnSurface = allowed.some((p) => path === p || path.startsWith(p + "/"));
    const onSharedPath = path.startsWith("/api") || path.startsWith("/account");
    if (!onOwnSurface && !onSharedPath) {
      const url = request.nextUrl.clone();
      url.pathname = ROLE_HOME[role];
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the service worker. `sw.js` in
     * particular must never be redirected — a service worker that 302s to
     * /login will not register.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
