import { supabase } from "@/integrations/supabase/client";

export const MEMBERS = {
  "tim@popotso.app": "Father",
  "nicky@popotso.app": "Mother",
  "mother@popotso.app": "Mother",
} as const;

export type MemberEmail = keyof typeof MEMBERS;

export const ATTRIBUTION =
  "System Architecture & Platform Engineering by Tim Web Development and Automation Agency. Designed exclusively for secure, high-integrity asynchronous communication and child care logistics.";

export const TAPBACKS = ["❤️", "👍", "👎", "😂", "‼️", "❓"] as const;

export function previewFor(kind: MessageKind, body?: string | null) {
  if (body) return body;
  return { image: "📷 Photo", video: "🎥 Video", audio: "🎙️ Voice note", file: "📎 File", text: "" }[kind];
}

export const BUCKET = "chat-attachments";
export const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

export type MessageKind = "text" | "image" | "video" | "audio" | "file";

export interface ChatMessage {
  id: string;
  sender_id: string;
  sender_email: string;
  body: string | null;
  kind: MessageKind;
  attachment_path: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  duration_ms: number | null;
  client_id: string | null;
  created_at: string;
  reactions?: Record<string, string> | null;
  read_at?: string | null;
  edited_at?: string | null;
  /** client-side only */
  pending?: boolean | undefined;
  progress?: number | undefined;
  localUrl?: string | undefined;
  failed?: boolean | undefined;
}

/** Pick a voice-note format the current phone/browser can record (iPhone needs mp4). */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"];
  return options.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

export function audioExtension(mime: string) {
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function kindForFile(file: File | Blob, name?: string): MessageKind {
  const type = file.type || "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (!type && name && /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(name)) return "image";
  return "file";
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function formatDuration(ms: number | null | undefined) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Raw, uncompressed upload straight to storage via XHR so we get real
 * upload progress for large files. Nothing is resized or re-encoded.
 */
export async function uploadRaw(
  path: string,
  file: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const url = `${import.meta.env["VITE_SUPABASE_URL"]}/storage/v1/object/${BUCKET}/${path}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string);
    // No upsert: each file has a unique path, and upsert needs extra permissions that made uploads fail.
    xhr.setRequestHeader("cache-control", "3600");
    if (contentType) xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export async function signedUrlFor(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) throw error;
  return data.signedUrl;
    }
    
