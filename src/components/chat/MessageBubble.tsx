import { FileText, Play } from "lucide-react";
import { useState } from "react";

import { ProgressRing } from "@/components/chat/ProgressRing";
import { VoiceNote } from "@/components/chat/VoiceNote";
import type { LightboxItem } from "@/components/chat/Lightbox";
import { formatBytes, formatClock, type ChatMessage } from "@/lib/care-desk";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  onOpen: (item: LightboxItem) => void;
}

export function MessageBubble({ message, outgoing, onOpen }: MessageBubbleProps) {
  const [showTime, setShowTime] = useState(false);
  const url = message.localUrl ?? message.attachment_url ?? "";
  const uploading = Boolean(message.pending && message.attachment_path);
  const mediaOnly = message.kind === "image" || message.kind === "video";

  return (
    <div className={cn("flex w-full flex-col", outgoing ? "items-end" : "items-start")}>
      <button
        type="button"
        onClick={() => setShowTime((value) => !value)}
        className={cn(
          "max-w-[80%] animate-bubble-in text-left transition-transform duration-200 active:scale-[0.985]",
          mediaOnly
            ? "relative overflow-hidden rounded-3xl"
            : cn(
                "rounded-3xl px-3.5 py-2",
                outgoing
                  ? "bg-bubble-out text-bubble-out-foreground"
                  : "bg-bubble-in text-bubble-in-foreground",
              ),
          message.failed && "opacity-60",
        )}
      >
        {message.kind === "image" && (
          <span className="relative block">
            <img
              src={url}
              alt={message.attachment_name ?? "Shared photo"}
              onClick={() => !uploading && onOpen({ url, kind: "image", name: message.attachment_name })}
              className="block max-h-80 w-full max-w-xs rounded-3xl object-cover"
            />
            {uploading && <ProgressRing progress={message.progress ?? 0} />}
          </span>
        )}

        {message.kind === "video" && (
          <span className="relative block">
            <video
              src={url}
              preload="metadata"
              playsInline
              muted
              onClick={() => !uploading && onOpen({ url, kind: "video", name: message.attachment_name })}
              className="block max-h-80 w-full max-w-xs rounded-3xl bg-foreground/10 object-cover"
            />
            {!uploading && (
              <span className="glass pointer-events-none absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full">
                <Play className="size-5 translate-x-px fill-current" />
              </span>
            )}
            {uploading && <ProgressRing progress={message.progress ?? 0} />}
          </span>
        )}

        {message.kind === "audio" && (
          <span className="relative block">
            <VoiceNote
              src={url}
              durationMs={message.duration_ms}
              outgoing={outgoing}
              seed={message.client_id ?? message.id}
            />
            {uploading && <ProgressRing progress={message.progress ?? 0} size={40} />}
          </span>
        )}

        {message.kind === "file" && (
          <a
            href={uploading ? undefined : url}
            target="_blank"
            rel="noreferrer"
            className="relative flex min-w-[190px] items-center gap-3 py-1"
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-2xl",
                outgoing ? "bg-bubble-out-foreground/20" : "bg-foreground/8",
              )}
            >
              <FileText className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] leading-tight font-medium">
                {message.attachment_name}
              </span>
              <span className="text-[11px] opacity-65">{formatBytes(message.attachment_size)}</span>
            </span>
            {uploading && <ProgressRing progress={message.progress ?? 0} size={40} />}
          </a>
        )}

        {message.body && (
          <span
            className={cn(
              "block text-[16.5px] leading-snug whitespace-pre-wrap",
              mediaOnly &&
                cn(
                  "px-3.5 py-2",
                  outgoing
                    ? "bg-bubble-out text-bubble-out-foreground"
                    : "bg-bubble-in text-bubble-in-foreground",
                ),
            )}
          >
            {message.body}
          </span>
        )}
      </button>

      <span
        className={cn(
          "overflow-hidden px-2 text-[11px] tabular-nums text-muted-foreground transition-all duration-300",
          showTime || message.failed ? "mt-1 max-h-6 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {message.failed
          ? "Not delivered"
          : message.pending
            ? "Sending…"
            : formatClock(message.created_at)}
      </span>
    </div>
  );
}
