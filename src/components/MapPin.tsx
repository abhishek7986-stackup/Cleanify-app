"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl ships ESM with no default export — named imports only.
import { Map as MapLibreMap, NavigationControl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * ============================================================================
 * Map pin
 * ============================================================================
 *
 * A pin is MANDATORY on every job. Free-text Indian addresses do not geocode
 * reliably, and the pin is what the supervisor actually navigates to and what
 * every travel-time calculation is measured from. A job with a good address
 * and no pin produces a confident, wrong deadline.
 *
 * The pin is FIXED at the centre of the viewport and the map moves underneath
 * it. Dragging a marker is fiddly one-handed; panning a map is not.
 *
 * Tiles come from OpenStreetMap, which needs no API key. For production
 * volumes switch to MapTiler or Google — OSM's tile policy is not intended for
 * commercial load.
 */

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function MapPin({
  value,
  onChange,
  target,
  height = 260,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (pos: { lat: number; lng: number }) => void;
  /** Set to move the map somewhere, e.g. a location pasted from WhatsApp. */
  target?: { lat: number; lng: number } | null;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // Kept in a ref so the map's moveend handler always calls the LATEST
  // callback without the map having to be torn down and rebuilt. Assigned in
  // an effect, not during render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [locating, setLocating] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    // Default view: Hyderabad. Overridden immediately if a pin already exists.
    const start = value ?? { lat: 17.4401, lng: 78.3489 };

    const m = new MapLibreMap({
      container: container.current,
      style: OSM_STYLE,
      center: [start.lng, start.lat],
      zoom: value ? 16 : 11,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // Report the centre after every pan, since the centre IS the pin.
    m.on("moveend", () => {
      const c = m.getCenter();
      onChangeRef.current({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) });
    });
    m.on("load", () => setReady(true));

    // Publish the starting centre straight away rather than waiting for
    // `load`. `moveend` only fires if the map is actually dragged, and `load`
    // never fires at all in a background tab (the browser suspends rendering),
    // so waiting for either would leave the rep unable to continue.
    const c0 = m.getCenter();
    onChangeRef.current({ lat: +c0.lat.toFixed(6), lng: +c0.lng.toFixed(6) });

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // Intentionally mount-only: later `value` changes come FROM this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!target) return;
    map.current?.jumpTo({ center: [target.lng, target.lat], zoom: 17 });
  }, [target]);

  // A dead map must never stop a job being booked: no WebGL, blocked tiles, a
  // throttled background tab. After a few seconds offer manual entry instead.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setManual(true), 6000);
    return () => clearTimeout(t);
  }, [ready]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        map.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 17,
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-2xl border-2 border-slate-200"
        style={{ height }}
      >
        <div ref={container} className="size-full" />

        {/* The pin: fixed dead centre, pointer-events off so it never eats a drag. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full"
        >
          <svg width="34" height="46" viewBox="0 0 34 46" fill="none">
            <path
              d="M17 1C8.7 1 2 7.7 2 16c0 10.5 13.3 27 14.4 28.3.3.4.9.4 1.2 0C18.7 43 32 26.5 32 16c0-8.3-6.7-15-15-15Z"
              fill="#0f766e"
              stroke="#fff"
              strokeWidth="2"
            />
            <circle cx="17" cy="16" r="5.5" fill="#fff" />
          </svg>
        </div>

        <button
          type="button"
          onClick={useMyLocation}
          className="absolute bottom-3 left-3 z-10 tap rounded-xl bg-white/95 px-4 text-sm font-semibold text-slate-700 shadow"
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>

      <p className="mt-2 text-center text-sm text-slate-500">
        {ready ? "Drag the map so the pin sits on the building" : "Loading map…"}
      </p>

      {value ? (
        <p className="mt-1 text-center text-xs tabular-nums text-slate-400">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </p>
      ) : null}

      {manual && !ready ? (
        <div className="mt-3 rounded-xl bg-warn-50 p-3">
          <p className="text-sm font-medium text-warn-700">
            The map is not loading. Enter the coordinates instead.
          </p>
          <p className="mt-1 text-xs text-warn-700">
            In Google Maps, long-press the spot and copy the numbers it shows.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              type="number" step="0.000001" placeholder="Latitude" inputMode="decimal"
              className="tap w-full rounded-lg border-2 border-warn-100 bg-white px-2 text-base"
              defaultValue={value?.lat}
              onChange={(e) =>
                onChange({ lat: Number(e.target.value), lng: value?.lng ?? 0 })
              }
            />
            <input
              type="number" step="0.000001" placeholder="Longitude" inputMode="decimal"
              className="tap w-full rounded-lg border-2 border-warn-100 bg-white px-2 text-base"
              defaultValue={value?.lng}
              onChange={(e) =>
                onChange({ lat: value?.lat ?? 0, lng: Number(e.target.value) })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
