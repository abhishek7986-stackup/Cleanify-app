import { NextResponse, type NextRequest } from "next/server";
import { extractShortMapLink, parseCoordinates } from "@/lib/location-link";

export const dynamic = "force-dynamic";

/**
 * Follows a maps.app.goo.gl short link to the coordinates behind it.
 *
 * The browser cannot do this itself: the redirect is cross-origin, so the
 * final URL is hidden from it. Only Google hosts are ever fetched, so this
 * cannot be pointed at an arbitrary address. Signed-in staff only — the proxy
 * keeps every /api path except /api/time behind login.
 */

const ALLOWED_HOST = /(^|\.)(goo\.gl|google\.[a-z.]+|googleusercontent\.com)$/i;
const MAX_HOPS = 5;

export async function GET(request: NextRequest) {
  const start = extractShortMapLink(request.nextUrl.searchParams.get("url") ?? "");
  if (!start) {
    return NextResponse.json({ error: "Not a Google Maps short link" }, { status: 400 });
  }

  let current = start;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const found = parseCoordinates(current);
      if (found) return NextResponse.json(found);

      const res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) Cleanify" },
      });

      const location = res.headers.get("location");
      if (location) {
        const next = new URL(location, current);
        if (next.protocol !== "https:" || !ALLOWED_HOST.test(next.hostname)) break;
        current = next.toString();
        continue;
      }

      // Final page: the coordinates are sometimes only in the HTML.
      if (res.ok) {
        const html = (await res.text()).slice(0, 500_000);
        const inPage = parseCoordinates(html);
        if (inPage) return NextResponse.json(inPage);
      }
      break;
    }
  } catch {
    return NextResponse.json({ error: "Could not open the link" }, { status: 502 });
  }

  return NextResponse.json({ error: "No location found in that link" }, { status: 422 });
}
