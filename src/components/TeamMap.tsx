"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { setupMaplibreWorker } from "@/lib/maplibre";

/**
 * Where each supervisor was last seen today. A fresh position is a solid dot;
 * one older than 10 minutes is faded, because the app was probably closed.
 * Same free OpenStreetMap tiles as the Roadmap.
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

export type TeamPin = { id: string; name: string; initials: string; lat: number; lng: number; stale: boolean };

export function TeamMap({ pins, height = 340 }: { pins: TeamPin[]; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(pins);

  useEffect(() => {
    if (!container.current) return;
    const list = JSON.parse(key) as TeamPin[];
    const first = list[0] ?? { lat: 17.4401, lng: 78.3489 };

    setupMaplibreWorker();
    const m = new MapLibreMap({
      container: container.current,
      style: OSM_STYLE,
      center: [first.lng, first.lat],
      zoom: 12,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const markers = list.map((p) => {
      const el = document.createElement("div");
      el.className = `flex flex-col items-center ${p.stale ? "opacity-50" : ""}`;
      el.innerHTML = `
        <span class="flex size-10 items-center justify-center rounded-full bg-brand-950 text-sm font-bold text-white shadow-md ring-[3px] ring-white">${escapeHtml(p.initials)}</span>
        <span class="mt-1 max-w-28 truncate rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow">${escapeHtml(p.name)}</span>`;
      el.setAttribute("aria-label", p.name);
      return new Marker({ element: el, anchor: "top" }).setLngLat([p.lng, p.lat]).addTo(m);
    });

    if (list.length > 1) {
      const b = new LngLatBounds();
      for (const p of list) b.extend([p.lng, p.lat]);
      m.fitBounds(b, { padding: 70, maxZoom: 15, duration: 0 });
    } else {
      m.setZoom(14);
    }

    return () => {
      for (const mk of markers) mk.remove();
      m.remove();
    };
  }, [key]);

  return <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-3xl" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
