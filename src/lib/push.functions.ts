import { createServerFn } from "@tanstack/react-start";
import { buildPushHTTPRequest } from "@pushforge/builder";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MEMBERS = ["tim@popotso.app", "mother@popotso.app"];

/** Sends a lock-screen alert to the other parent's devices. */
export const notifyPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { preview: string }) => ({
    preview: String(data?.preview ?? "").slice(0, 140),
  }))
  .handler(async ({ data, context }) => {
    const email = String((context.claims as { email?: string }).email ?? "");
    if (!MEMBERS.includes(email)) return { sent: 0 };

    const jwk = process.env["VAPID_PRIVATE_JWK"];
    if (!jwk) return { sent: 0 };

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabaseAdmin = admin as any;
    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .neq("user_id", context.userId);

    const title = email === "tim@popotso.app" ? "Father" : "Mother";
    let sent = 0;
    await Promise.all(
      ((subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]).map(async (sub) => {
        try {
          const req = await buildPushHTTPRequest({
            privateJWK: JSON.parse(jwk),
            subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            message: {
              payload: { title, body: data.preview || "New message" },
              adminContact: "mailto:tim@popotso.app",
            },
          });
          const res = await fetch(req.endpoint, {
            method: "POST",
            headers: req.headers,
            body: req.body,
          });
          if (res.status === 404 || res.status === 410) {
            await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
          } else if (res.ok) {
            sent += 1;
          } else {
            console.error(`Push failed [${res.status}]: ${await res.text()}`);
          }
        } catch (error) {
          console.error("Push error", error);
        }
      }),
    );
    return { sent };
  });
