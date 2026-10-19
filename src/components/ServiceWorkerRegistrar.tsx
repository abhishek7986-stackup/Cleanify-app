"use client";

import { useEffect } from "react";
import { flushUploadQueue } from "@/lib/upload-queue";

/**
 * Registers the service worker and drives the offline upload queue.
 *
 * Background Sync does not exist on iOS at all, so the queue is flushed when
 * the app is foregrounded rather than by the browser. That is the difference
 * between photos that eventually arrive and photos that quietly never do.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Never run the service worker in development. It fights HMR, and its
    // offline fallback gets stuck serving the offline page for the rest of the
    // session the moment the dev server restarts. Actively tear down any
    // worker left over from a previous run, or developers stay stuck.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      void caches?.keys().then((keys) => {
        for (const key of keys) if (key.startsWith("cleanify-")) void caches.delete(key);
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration must not break the app — it only means no push.
    });

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "FLUSH_QUEUE") void flushUploadQueue();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    const onVisible = () => {
      if (document.visibilityState === "visible") void flushUploadQueue();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    void flushUploadQueue();

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  return null;
}
