/**
 * ============================================================================
 * Reading a location someone pasted
 * ============================================================================
 *
 * Clients send their location on WhatsApp, so the rep pastes whatever they
 * got: a Google Maps link, a short maps.app.goo.gl link, or bare coordinates.
 * Short links carry no coordinates until they are followed, which has to
 * happen on the server (see /api/resolve-location).
 *
 * Shared by the browser and the server route, so no DOM or Node APIs here.
 */

export type LatLng = { lat: number; lng: number };

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
}

function decodeFully(text: string): string {
  let out = text;
  // Links arrive encoded once or twice (e.g. inside a consent ?continue=).
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, " "));
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

function dmsToDecimal(deg: string, min: string, sec: string, hemi: string): number {
  const v = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
  return /[SW]/i.test(hemi) ? -v : v;
}

/** Pulls coordinates out of a link or text. Null when there are none. */
export function parseCoordinates(input: string): LatLng | null {
  const text = decodeFully(input.trim());
  if (!text) return null;

  // Order matters. A place link holds both the place (!3d..!4d..) and the
  // map viewport (@..); the place is the building, the viewport is not.
  const patterns: RegExp[] = [
    new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
    new RegExp(String.raw`[?&](?:q|query|ll|sll|destination|daddr|center)=(?:loc:)?\s*${NUM}\s*,\s*${NUM}`, "i"),
    new RegExp(String.raw`@${NUM},${NUM}`),
    new RegExp(String.raw`geo:${NUM},${NUM}`, "i"),
    // Bare "17.4401, 78.3489". Needs decimals so a phone number or house
    // number pair is never mistaken for a location.
    new RegExp(String.raw`(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})`),
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const hit = valid(Number(m[1]), Number(m[2]));
      if (hit) return hit;
    }
  }

  // 17°26'24.4"N 78°20'56.0"E — what Google Maps shows on a dropped pin.
  const dms = text.match(
    /(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([EW])/i,
  );
  if (dms) {
    return valid(
      dmsToDecimal(dms[1], dms[2], dms[3], dms[4]),
      dmsToDecimal(dms[5], dms[6], dms[7], dms[8]),
    );
  }

  return null;
}

const SHORT_LINK_HOSTS = ["maps.app.goo.gl", "goo.gl"];

/** A short link that has to be followed before it reveals a location. */
export function extractShortMapLink(input: string): string | null {
  const m = input.match(/https?:\/\/[^\s]+/i);
  if (!m) return null;
  try {
    const url = new URL(m[0]);
    if (!SHORT_LINK_HOSTS.includes(url.hostname)) return null;
    if (url.hostname === "goo.gl" && !url.pathname.startsWith("/maps")) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Reads a PostGIS point as PostgREST returns it: hex EWKB, e.g.
 * 0101000020E6100000 + x (lng) + y (lat), little-endian doubles.
 */
export function parseEwkbPoint(hex: unknown): LatLng | null {
  if (typeof hex !== "string" || !/^[0-9a-f]+$/i.test(hex) || hex.length < 42) return null;
  const bytes = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  const view = new DataView(bytes.buffer);
  const le = bytes[0] === 1;
  const type = view.getUint32(1, le);
  if ((type & 0xff) !== 1) return null; // not a point
  const offset = type & 0x20000000 ? 9 : 5; // skip the SRID when present
  return valid(view.getFloat64(offset + 8, le), view.getFloat64(offset, le));
}
