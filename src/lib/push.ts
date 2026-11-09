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

function toUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return true; // Some browsers do not expose the existing applicationServerKey.
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((value, index) => value === b[index]);
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export async function currentPushEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return Boolean(reg?.active && (await reg.pushManager.getSubscription()));
  } catch (error) {
    console.warn("Could not read push subscription:", error);
    return false;
  }
}

/** Call directly from a user tap — browsers require a user gesture for permission prompts. */
export async function enablePush(userId: string): Promise<PushStatus> {
  if (window.top !== window.self) return "open-in-new-tab";
  if (!pushSupported()) {
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    return ios ? "install-first" : "unsupported";
  }

  if (Notification.permission === "denied") {
    alert(
      "Notifications are blocked in your browser settings. Allow Notifications for popotso.lovable.app in your browser's site settings, then try again.",
    );
    return "denied";
  }

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  let stage = "Service worker setup";

  try {
    const applicationServerKey = toUint8(VAPID_PUBLIC_KEY);
    // A valid uncompressed P-256 public key is 65 bytes and starts with 0x04.
    if (applicationServerKey.length !== 65 || applicationServerKey[0] !== 4) {
      throw new Error("The configured VAPID public key is not a valid P-256 public key.");
    }

    const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    // Use the registration for this app's root scope, not an unrelated registration.
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg || reg.scope !== registration.scope || !reg.active) {
      throw new Error("The Popotso push service worker did not become active for the app's root scope.");
    }

    stage = "Push subscription";
    let sub = await reg.pushManager.getSubscription();

    if (sub) {
      const json = sub.toJSON();
      const hasKeys = Boolean(json.keys?.p256dh && json.keys?.auth);
      const hasCurrentVapidKey = sameBytes(sub.options.applicationServerKey, applicationServerKey);
      if (!hasKeys || !hasCurrentVapidKey) {
        await sub.unsubscribe();
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      throw new Error("The browser returned an incomplete push subscription.");
    }

    stage = "Saving push subscription";
    const { error } = await (supabase as any).from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: "endpoint" },
    );

    if (error) throw new Error(error.message);
    return "enabled";
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Push ${stage.toLowerCase()} failed:`, err);
    alert(`${stage} failed:\n${detail}`);
    return "error";
  }
}
