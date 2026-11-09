import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY =
  "BJFdJdHJbGHdUt0cGYiEt2amth68u8uxixZUc5hExhsNkPL9t3nCAozkaNMpd5Au1CJZt5vWHzINtOLoXKdZVLY";

export type PushStatus =
  | "enabled"
  | "unsupported"
  | "open-in-new-tab"
  | "install-first"
  | "denied"
  | "error";

function toUint8(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function currentPushEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
  return Boolean(await reg?.pushManager.getSubscription());
}

/** Call from a tap — browsers ignore permission prompts without a user gesture. */
export async function enablePush(userId: string): Promise<PushStatus> {
  if (window.top !== window.self) return "open-in-new-tab";
  if (!pushSupported()) {
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    return ios ? "install-first" : "unsupported";
  }

  // If already denied by Chrome/Safari, browser blocks prompt() — guide user to site settings
  if (Notification.permission === "denied") {
    alert(
      "Notifications are blocked in your browser settings.\n\nTo allow them:\n1. Tap the lock or sliders icon next to popotso.lovable.app in your address bar.\n2. Tap 'Permissions' (or 'Site settings').\n3. Set 'Notifications' to 'Allow'.\n4. Refresh the page and tap this bell icon again.",
    );
    return "denied";
  }

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    return "denied";
  }

  try {
    const reg = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    // Check for existing subscription first
    let sub = await reg.pushManager.getSubscription();

    // If an existing subscription is invalid or has wrong key, reset it
    if (sub) {
      try {
        const json = sub.toJSON();
        if (!json.keys?.["p256dh"] || !json.keys?.["auth"]) {
          await sub.unsubscribe();
          sub = null;
        }
      } catch {
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toUint8(VAPID_PUBLIC_KEY),
      });
    }

    const json = sub.toJSON();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: json.keys?.["p256dh"] ?? "",
        auth: json.keys?.["auth"] ?? "",
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      console.error("Database save failed:", error);
      alert(`Database notification error: ${error.message}`);
      return "error";
    }

    return "enabled";
  } catch (err: any) {
    console.error("Push enable failed:", err);
    alert(`Notification registration details:\n${err?.name || "Error"}: ${err?.message || err}`);
    return "error";
  }
}
  
