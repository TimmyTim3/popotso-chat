import { supabase } from "@/integrations/supabase/client";

export const BUCKET = "chat-attachments";
export const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days in seconds

export type MessageKind = "text" | "image" | "video" | "audio" | "document";

export type MemberEmail = "tim@popotso.app" | "nicky@popotso.app" | "mother@popotso.app";

export const MEMBERS: Record<MemberEmail, string> = {
  "tim@popotso.app": "Father",
  "nicky@popotso.app": "Mother",
  "mother@popotso.app": "Mother",
};

export interface ChatMessage {
  id: string;
  client_id?: string;
  sender_id: string;
  sender_email: MemberEmail | string;
  body: string | null;
  kind: MessageKind;
  attachment_path?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  duration_ms?: number | null;
  reactions?: Record<string, any> | null;
  read_at?: string | null;
  created_at: string;
  edited_at?: string | null;
  pending?: boolean;
  failed?: boolean;
  progress?: number;
  localUrl?: string;
}

export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function previewFor(kind: MessageKind, body: string | null): string {
  if (kind === "image") return "📷 Photo";
  if (kind === "video") return "📹 Video";
  if (kind === "audio") return "🎤 Voice note";
  if (kind === "document") return "📄 Document";
  return body ? (body.length > 60 ? `${body.slice(0, 57)}...` : body) : "New message";
}

/**
 * Raw, uncompressed upload straight to storage via XHR with optional AbortSignal
 * so cancelling stops cellular data usage immediately.
 */
export async function uploadRaw(
  path: string,
  file: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }

  const url = `${import.meta.env["VITE_SUPABASE_URL"]}/storage/v1/object/${BUCKET}/${path}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string);
    xhr.setRequestHeader("cache-control", "3600");
    if (contentType) xhr.setRequestHeader("content-type", contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
    };

    xhr.onerror = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error("Network error during upload"));
    };

    xhr.onabort = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Upload aborted", "AbortError"));
    };

    xhr.send(file);
  });
}

export async function signedUrlFor(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) throw error;
  return data.signedUrl;
}

export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export function audioExtension(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}
