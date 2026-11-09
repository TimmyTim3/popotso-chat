// Push-only service worker for Popotso Care Desk. Never caches pages or files.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const isCall = data.type === "call";
  const title = data.title || (isCall ? "📞 Popotso Incoming Call" : "Popotso Care Desk");

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (!isCall && windows.some((c) => c.visibilityState === "visible")) {
        return; // Don't buzz lock screen if chat is currently open in front of the user
      }

      await self.registration.showNotification(title, {
        body: data.body || (isCall ? "Tap to answer call" : "New message"),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: isCall ? "popotso-call" : "care-desk",
        renotify: true,
        silent: false,
        requireInteraction: isCall,
        // Realistic ringing cadence vibration: buzz-buzz-buzz... buzz-buzz-buzz
        vibrate: isCall
          ? [500, 200, 500, 200, 500, 200, 800, 500, 200, 500]
          : [100, 50, 100],
        data: { url: "/", isCall },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});
