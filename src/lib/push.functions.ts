import { createServerFn } from "@tanstack/react-start";
import { buildPushHTTPRequest } from "@pushforge/builder";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MEMBERS = ["tim@popotso.app", "nicky@popotso.app", "mother@popotso.app"];

/** Sends a lock-screen alert to the other parent's registered devices. */
export const notifyPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { preview: string; title?: string; type?: string; challengeId?: string }) => ({
    preview: String(data?.preview ?? "").slice(0, 140),
    title: data.title ? String(data.title).slice(0, 50) : undefined,
    type: data.type ? String(data.type).slice(0, 20) : "message",
    challengeId: data.challengeId ? String(data.challengeId).slice(0, 80) : undefined,
  }))
  .handler(async ({ data, context }) => {
    const email = String((context.claims as { email?: string }).email ?? "").toLowerCase();
    if (!MEMBERS.includes(email)) {
      console.warn("Push delivery skipped: authenticated account is not on the notification allowlist.");
      return { sent: 0 };
    }

    const jwk = process.env["VAPID_PRIVATE_JWK"];
    if (!jwk) {
      console.error("Push delivery unavailable: VAPID_PRIVATE_JWK is not configured.");
      return { sent: 0 };
    }

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = admin as any;
    const { data: subs, error: readError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .neq("user_id", context.userId);

    if (readError) {
      console.error("Could not load recipient push subscriptions:", readError);
      return { sent: 0 };
    }

    const recipients = (subs ?? []) as {
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];

    if (recipients.length === 0) {
      console.info("Push delivery skipped: no other-user subscriptions are registered.");
      return { sent: 0 };
    }

    const defaultTitle = email === "tim@popotso.app" ? "Father" : "Mother";
    const notificationTitle = data.title || defaultTitle;
    let sent = 0;

    await Promise.all(
      recipients.map(async (sub) => {
        try {
          const req = await buildPushHTTPRequest({
            privateJWK: JSON.parse(jwk),
            subscription: {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            message: {
              payload: {
                title: notificationTitle,
                body: data.preview || "New message",
                type: data.type || "message",
                challengeId: data.challengeId,
              },
              adminContact: "mailto:tim@popotso.app",
            },
          });

          const res = await fetch(req.endpoint, {
            method: "POST",
            headers: req.headers,
            body: req.body,
          });

          if (res.status === 404 || res.status === 410) {
            // The browser has expired or removed this subscription.
            const { error } = await supabaseAdmin
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);
            if (error) console.error("Could not remove expired push subscription:", error);
          } else if (res.ok) {
            sent += 1;
          } else {
            console.error(
              `Push provider rejected notification [${res.status}]: ${(await res.text()).slice(0, 500)}`,
            );
          }
        } catch (error) {
          // Includes malformed private JWKs and public/private VAPID key mismatches.
          console.error("Push delivery failed for a registered endpoint:", error);
        }
      }),
    );

    return { sent };
  });
