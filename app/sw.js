// Service worker: makes the app installable and, from phase 2, receives the daily push.
// No offline caching yet — plants live in localStorage and the weather always comes fresh.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Pages always revalidate with the server, so an installed copy never keeps an old index.html.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request, { cache: "no-cache" }).catch(() => fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Florvia", {
    body: data.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "garden-daily",
    renotify: true,
    data: { url: data.url || "./" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) { await open.navigate(url); return open.focus(); }
    return self.clients.openWindow(url);
  })());
});
