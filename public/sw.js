/**
 * Cleanify service worker.
 *
 * Hand-rolled rather than generated: the push handling below is the whole
 * point, and every generator would need it customised anyway.
 *
 * NOTE ON iOS: Web Push is delivered ONLY when the PWA has been installed to
 * the Home Screen (iOS 16.4+). A supervisor using the app in a Safari tab gets
 * nothing, silently. That is why the in-app countdown never depends on push,
 * and why the app nags until it is running standalone.
 */

const VERSION = "v1";
const SHELL_CACHE = `cleanify-shell-${VERSION}`;
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Network-first for navigations, falling back to the offline page.
 *
 * Deliberately NOT caching API responses: a supervisor acting on a stale job
 * list is worse than a supervisor who can see they are offline.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match("/offline");
      return cached ?? new Response("Offline", { status: 503 });
    }),
  );
});

/* -------------------------------------------------------------------------
 * Push
 * ---------------------------------------------------------------------- */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cleanify", body: event.data ? event.data.text() : "" };
  }

  const {
    title = "Cleanify",
    body = "",
    template_key = "",
    job_id = "",
    roster_id = "",
    url = "/",
    critical = false,
  } = data;

  // The 05:30 readiness heartbeat. Browsers enforce userVisibleOnly, so a
  // genuinely silent push risks the browser showing its own "site updated in
  // the background" notice instead. Showing a short, actually-useful message
  // avoids that entirely — and the ack tells admin this device is reachable
  // BEFORE the day starts, rather than at 07:05 when someone is already late.
  if (template_key === "system.heartbeat") {
    event.waitUntil(
      Promise.all([
        self.registration.showNotification("Cleanify is ready for today", {
          body: body || "Your schedule is up to date.",
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: "heartbeat",
          silent: true,
          data: { url: "/s" },
        }),
        fetch("/api/push/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ at: new Date().toISOString() }),
          credentials: "include",
        }).catch(() => {}),
      ]),
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // A re-send REPLACES rather than stacks. Three copies of "you are late"
      // is noise, not urgency.
      tag: `${job_id || roster_id || "cleanify"}:${template_key}`,
      renotify: true,
      requireInteraction: Boolean(critical),
      vibrate: critical ? [200, 100, 200] : undefined,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

/* -------------------------------------------------------------------------
 * Offline upload queue
 *
 * Background Sync DOES NOT EXIST on iOS. The queue therefore flushes when the
 * app is foregrounded, driven by the page, not by the browser. `sync` is
 * wired up too so Android gets the better behaviour where it is available.
 * ---------------------------------------------------------------------- */
function askPagesToFlush() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) client.postMessage({ type: "FLUSH_QUEUE" });
  });
}

self.addEventListener("sync", (event) => {
  if (event.tag === "cleanify-upload-queue") event.waitUntil(askPagesToFlush());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "FLUSH_REQUEST") event.waitUntil(askPagesToFlush());
});
