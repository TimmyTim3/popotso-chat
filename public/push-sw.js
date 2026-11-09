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
  const isGame = data.type === "game";
  const challengeId = data.challengeId || "";
  const title = data.title || (isCall ? "📞 Popotso Incoming Call" : "Popotso Care Desk");

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (!isCall && !isGame && windows.some((c) => c.visibilityState === "visible")) {
        return; // Don't buzz lock screen if chat is currently open in front of the user
      }

      await self.registration.showNotification(title, {
        body: data.body || (isCall ? "Tap to answer call" : "New message"),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: isCall ? "popotso-call" : isGame ? `popotso-game-${challengeId}` : "care-desk",
        renotify: true,
        silent: false,
        requireInteraction: isCall,
        // Realistic ringing cadence vibration: buzz-buzz-buzz... buzz-buzz-buzz
        vibrate: isCall
          ? [500, 200, 500, 200, 500, 200, 800, 500, 200, 500]
          : [100, 50, 100],
        actions: isGame ? [{ action: "ready-to-join", title: "Ready to join" }] : [],
        data: { url: isGame && challengeId ? `/?gameChallenge=${encodeURIComponent(challengeId)}` : "/", isCall, isGame, challengeId },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const targetUrl = event.notification.data?.url || "/";
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
