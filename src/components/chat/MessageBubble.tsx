import { FileText, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ProgressRing } from "@/components/chat/ProgressRing";
import { VoiceNote } from "@/components/chat/VoiceNote";
import type { LightboxItem } from "@/components/chat/Lightbox";
import { TAPBACKS, formatBytes, formatClock, type ChatMessage } from "@/lib/care-desk";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  myId: string;
  receipt?: string | null;
  onOpen: (item: LightboxItem) => void;
  onReact: (message: ChatMessage, emoji: string | null) => void;
}

export function MessageBubble({ message, outgoing, myId, receipt, onOpen, onReact }: MessageBubbleProps) {
  const [showTime, setShowTime] = useState(false);
  const [picker, setPicker] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const url = message.localUrl ?? message.attachment_url ?? "";
  const uploading = Boolean(message.pending && message.attachment_path);
  const mediaOnly = message.kind === "image" || message.kind === "video";
  const reactions = Object.entries(message.reactions ?? {});
  const mine = message.reactions?.[myId] ?? null;
  const canReact = !message.pending && !message.failed;

  useEffect(() => {
    if (!picker) return;
    const close = () => setPicker(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [picker]);

  const openPicker = () => {
    if (!canReact) return;
    haptic("medium");
    setPicker(true);
  };

  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      openPicker();
    }, 420);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const choose = (emoji: string) => {
    haptic("success");
    setPicker(false);
    onReact(message, mine === emoji ? null : emoji);
  };

  return (
    <div
      className={cn(
        "relative flex w-full flex-col",
        outgoing ? "items-end" : "items-start",
        reactions.length > 0 && "mt-3",
      )}
    >
      {picker && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "glass animate-tapback-in absolute -top-12 z-30 flex gap-1 rounded-full px-2 py-1.5 shadow-lg",
            outgoing ? "right-2 origin-bottom-right" : "left-2 origin-bottom-left",
          )}
        >
          {TAPBACKS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => choose(emoji)}
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-[20px] transition-transform active:scale-125",
                mine === emoji && "bg-primary/20",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => {
          e.preventDefault();
          openPicker();
        }}
        onDoubleClick={openPicker}
        onClick={() => {
          if (longPressed.current) return;
          setShowTime((value) => !value);
        }}
        className={cn(
          "relative max-w-[80%] animate-bubble-in cursor-pointer text-left select-none transition-transform duration-200 [-webkit-touch-callout:none] active:scale-[0.985]",
          picker && "scale-[1.03]",
          mediaOnly
            ? "rounded-3xl"
            : cn(
                "rounded-3xl px-3.5 py-2",
                outgoing
                  ? "bg-bubble-out text-bubble-out-foreground"
                  : "bg-bubble-in text-bubble-in-foreground",
              ),
          message.failed && "opacity-60",
        )}
      >
        {reactions.length > 0 && (
          <span
            className={cn(
              "absolute -top-3.5 z-10 flex items-center gap-0.5 rounded-full border-2 border-background bg-bubble-in px-1.5 py-0.5 text-[13px] leading-none shadow-sm",
              outgoing ? "-left-3" : "-right-3",
            )}
          >
            {reactions.map(([uid, emoji]) => (
              <span key={uid}>{emoji}</span>
            ))}
          </span>
        )}

        {message.kind === "image" && (
          <span className="relative block overflow-hidden rounded-3xl">
            <img
              src={url}
              alt={message.attachment_name ?? "Shared photo"}
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                if (!uploading && !longPressed.current)
                  onOpen({ url, kind: "image", name: message.attachment_name });
              }}
              className="block max-h-80 w-full max-w-xs object-cover"
            />
            {uploading && <ProgressRing progress={message.progress ?? 0} />}
          </span>
        )}

        {message.kind === "video" && (
          <span className="relative block overflow-hidden rounded-3xl">
            <video
              src={url}
              preload="metadata"
              playsInline
              muted
              onClick={(e) => {
                e.stopPropagation();
                if (!uploading && !longPressed.current)
                  onOpen({ url, kind: "video", name: message.attachment_name });
              }}
              className="block max-h-80 w-full max-w-xs bg-foreground/10 object-cover"
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
            onClick={(e) => e.stopPropagation()}
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
                  "mt-1 rounded-3xl px-3.5 py-2",
                  outgoing
                    ? "bg-bubble-out text-bubble-out-foreground"
                    : "bg-bubble-in text-bubble-in-foreground",
                ),
            )}
          >
            {message.body}
          </span>
        )}
      </div>

      <span
        className={cn(
          "overflow-hidden px-2 text-[11px] tabular-nums text-muted-foreground transition-all duration-300",
          showTime || message.failed || message.pending || receipt
            ? "mt-1 max-h-6 opacity-100"
            : "max-h-0 opacity-0",
        )}
      >
        {message.failed
          ? "Not delivered"
          : message.pending
            ? "Sending…"
            : showTime
              ? formatClock(message.created_at)
              : receipt}
      </span>
    </div>
  );
}
