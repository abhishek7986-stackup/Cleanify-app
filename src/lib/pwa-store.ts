"use client";

import { useSyncExternalStore } from "react";
import { detectPlatform, isStandalone, type Platform } from "./pwa";

/**
 * Browser-only environment facts, read through useSyncExternalStore.
 *
 * These cannot be computed during SSR and must not be set with a synchronous
 * setState in an effect (that causes a cascading re-render). useSyncExternalStore
 * is the tool designed for exactly this: a server snapshot for hydration, a
 * client snapshot afterwards.
 */

function subscribeDisplayMode(onChange: () => void): () => void {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const noopSubscribe = () => () => {};

export function useIsStandalone(): boolean {
  return useSyncExternalStore(
    subscribeDisplayMode,
    isStandalone,
    // Assume installed on the server so the "add to Home Screen" banner never
    // flashes before hydration decides it is not needed.
    () => true,
  );
}

export function usePlatform(): Platform {
  return useSyncExternalStore(
    noopSubscribe,
    detectPlatform,
    () => "other" as Platform,
  );
}
