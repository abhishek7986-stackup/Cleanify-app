/**
 * Picks the odometer reading out of whatever text a photo reader found.
 *
 * A scooter dashboard has more numbers than the odometer: the trip meter
 * ("TRIP A 34.5"), the speed, the clock, a fuel scale. So:
 *   - decimals are trip meters, never the odometer;
 *   - the odometer is 3 to 7 whole digits, often with leading zeros, and the
 *     reader may split it into separate digits ("0 1 2 5 4 8");
 *   - when the last known reading is given, the right number is the one at or
 *     just above it (a scooter does not do 1,000 km between check-ins).
 *
 * Returns null when nothing looks like an odometer. The supervisor always
 * confirms or corrects the number, so a wrong guess costs a tap, not the data.
 */
export function pickOdometerKm(text: string, lastKnownKm?: number | null): number | null {
  const cleaned = text
    // Common letter-for-digit misreads on segment and dot-matrix displays.
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, (m, i, s: string) => (/\d/.test(s[i - 1] ?? "") || /\d/.test(s[i + 1] ?? "") ? "5" : m))
    .replace(/[Bb](?=\d)|(?<=\d)[Bb]/g, "8");

  const candidates = new Set<string>();
  for (const line of cleaned.split(/\n+/)) {
    // Drop decimals first so "34.5" cannot contribute "34" or "5".
    const noDecimals = line.replace(/\d+[.,]\d+/g, " ");
    for (const m of noDecimals.matchAll(/\d+/g)) candidates.add(m[0]);
    // Digits the reader split apart: "0 1 2 5 4 8" -> "012548".
    for (const m of noDecimals.matchAll(/(?:\d\s){2,6}\d/g)) candidates.add(m[0].replace(/\s/g, ""));
  }

  const values = [...candidates]
    .filter((d) => d.length >= 3 && d.length <= 7)
    .map((d) => ({ digits: d.length, km: Number(d) }))
    .filter((c) => c.km > 0);
  if (!values.length) return null;

  if (lastKnownKm != null && Number.isFinite(lastKnownKm)) {
    const near = values
      .filter((c) => c.km >= lastKnownKm && c.km - lastKnownKm <= 1000)
      .sort((a, b) => a.km - lastKnownKm - (b.km - lastKnownKm));
    if (near.length) return near[0].km;
  }

  // Otherwise the longest run of digits, then the largest value.
  values.sort((a, b) => b.digits - a.digits || b.km - a.km);
  return values[0].km;
}
