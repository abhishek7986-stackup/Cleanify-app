"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
// maplibre-gl ships ESM with no default export — named imports only.
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { setupMaplibreWorker } from "@/lib/maplibre";

/**
 * The day on one map: the depot, then each job as a numbered pin in the order
 * to visit, joined by a line. Tapping a pin opens that job.
 *
 * The line is straight from stop to stop: it shows the ORDER, not the roads.
 * Road directions come from Google Maps, opened with every stop by the
 * "Start route" button, which knows traffic and talks the supervisor through
 * each turn far better than anything drawn here.
 *
 * Tiles are OpenStreetMap, the same free map used to drop a pin when booking.
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

export type RouteStop = {
  id: string;
  n: number;
  lat: number;
  lng: number;
  done: boolean;
};

export function RouteMap({
  stops,
  depot,
  height = 300,
}: {
  stops: RouteStop[];
  depot: { lat: number; lng: number } | null;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!container.current) return;
    const points = [...(depot ? [depot] : []), ...stops];
    const first = points[0] ?? { lat: 17.4401, lng: 78.3489 };

    setupMaplibreWorker();
    const m = new MapLibreMap({
      container: container.current,
      style: OSM_STYLE,
      center: [first.lng, first.lat],
      zoom: 12,
      attributionControl: { compact: true },
      // One finger scrolls the page past the map; two fingers move the map.
      cooperativeGestures: true,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");

    m.on("load", () => {
      // The order of the day, depot first.
      m.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
        },
      });
      m.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7 },
      });
      m.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#0b3532", "line-width": 3.5, "line-dasharray": [1.5, 1.5] },
      });
    });

    const markers: Marker[] = [];
    if (depot) {
      const el = document.createElement("div");
      el.className = "flex size-8 items-center justify-center rounded-full bg-white text-brand-950 shadow-md ring-2 ring-brand-950";
      el.setAttribute("aria-label", "Depot");
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6"/></svg>';
      markers.push(new Marker({ element: el }).setLngLat([depot.lng, depot.lat]).addTo(m));
    }
    for (const s of stops) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `flex size-9 items-center justify-center rounded-full text-sm font-bold shadow-md ring-2 ring-white ${
        s.done ? "bg-ok-600 text-white" : "bg-brand-950 text-white"
      }`;
      el.textContent = s.done ? "✓" : String(s.n);
      el.setAttribute("aria-label", `Job ${s.n}${s.done ? ", done" : ""}`);
      el.addEventListener("click", () => router.push(`/s/jobs/${s.id}`));
      markers.push(new Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m));
    }

    if (points.length > 1) {
      const b = new LngLatBounds();
      for (const p of points) b.extend([p.lng, p.lat]);
      m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
    } else {
      m.setZoom(14);
    }

    return () => {
      for (const mk of markers) mk.remove();
      m.remove();
    };
  }, [stops, depot, router]);

  return <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-3xl" />;
}
