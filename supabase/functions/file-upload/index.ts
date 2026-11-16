// Supabase Edge Function: file-upload
// Pairing is initiated by an authenticated parent; the Android companion is visible
// on-device and only scans media after the OS permission is granted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const randomToken = (n = 32) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=",""); };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);
  const authHeader = req.headers.get("Authorization") ?? "";
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "create-pairing") {
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || !["tim@popotso.app", "mother@popotso.app"].includes((user.email ?? "").toLowerCase())) return json({ error: "Parent access required" }, 403);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const { error } = await admin.from("file_upload_pairing_codes").insert({ code_hash: await hash(code), created_by: user.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    if (error) return json({ error: "Could not create pairing code" }, 500);
    return json({ code, expires_in_seconds: 600 });
  }

  if (action === "pair-device") {
    const code = String(body.code ?? "");
    const deviceName = String(body.device_name ?? "").slice(0, 80);
    if (!/^\d{6}$/.test(code) || !deviceName) return json({ error: "Valid six-digit code and device name required" }, 400);
    const { data: pairing } = await admin.from("file_upload_pairing_codes").select("*").eq("code_hash", await hash(code)).is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!pairing) return json({ error: "Pairing code is invalid or expired" }, 401);
    const token = randomToken();
    const { data: device, error } = await admin.from("file_upload_devices").insert({ device_name: deviceName, token_hash: await hash(token) }).select("id").single();
    if (error) return json({ error: "Device pairing failed" }, 500);
    await admin.from("file_upload_pairing_codes").update({ consumed_at: new Date().toISOString() }).eq("id", pairing.id);
    return json({ device_id: device.id, device_token: token });
  }

  const token = req.headers.get("x-device-token") ?? "";
  if (!token) return json({ error: "Device token required" }, 401);
  const { data: device } = await admin.from("file_upload_devices").select("id").eq("token_hash", await hash(token)).is("revoked_at", null).maybeSingle();
  if (!device) return json({ error: "Device is not paired or has been revoked" }, 401);
  await admin.from("file_upload_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  if (action === "create-upload") {
    const name = String(body.original_name ?? "media").replace(/[\\/]/g, "_").slice(0, 180);
    const contentType = String(body.content_type ?? "application/octet-stream").slice(0, 120);
    const size = Number(body.file_size ?? 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > 52428800) return json({ error: "File exceeds 50 MB limit" }, 413);
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return json({ error: "Only image and video files are accepted" }, 415);
    const objectPath = device.id + "/" + crypto.randomUUID() + "-" + name;
    const { data, error } = await admin.storage.from("file-upload").createSignedUploadUrl(objectPath);
    if (error || !data) return json({ error: "Could not create secure upload URL" }, 500);
    return json({ object_path: objectPath, signed_url: data.signedUrl, token: data.token, content_type: contentType, file_size: size });
  }

  if (action === "complete-upload") {
    const objectPath = String(body.object_path ?? "");
    if (!objectPath.startsWith(device.id + "/")) return json({ error: "Invalid object path" }, 403);
    const { error } = await admin.from("file_upload_items").insert({
      device_id: device.id, object_path: objectPath, original_name: String(body.original_name ?? "media").slice(0, 180),
      content_type: String(body.content_type ?? "application/octet-stream"), file_size: Number(body.file_size ?? 0),
      captured_at: body.captured_at ?? null, status: "synced"
    });
    if (error) return json({ error: "Could not register uploaded file" }, 500);
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
