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
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  try {
    const reg = await navigator.serviceWorker.register("/push-sw.js");
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toUint8(VAPID_PUBLIC_KEY),
      }));
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
    if (error) return "error";
    return "enabled";
  } catch {
    return "error";
  }
}
