import { Copy, FileText, Pencil, Play, Plus, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ProgressRing } from "@/components/chat/ProgressRing";
import { VoiceNote } from "@/components/chat/VoiceNote";
import type { LightboxItem } from "@/components/chat/Lightbox";
import { TAPBACKS, formatBytes, formatClock, type ChatMessage } from "@/lib/care-desk";
import { EMOJI_LISTS } from "@/lib/emoji";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatMessage;
  isMine?: boolean;
  outgoing?: boolean;
  myId: string;
  receipt?: string | null;
  onOpenLightbox?: (item: LightboxItem) => void;
  onOpen?: (item: LightboxItem) => void;
  onReact: (message: ChatMessage, emoji: string | null) => void;
  onRetry?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
}

export function MessageBubble({
  message,
  isMine,
  outgoing: outgoingProp,
  myId,
  receipt,
  onOpenLightbox,
  onOpen,
  onReact,
  onRetry,
  onEdit,
}: MessageBubbleProps) {
  const outgoing = isMine ?? outgoingProp ?? false;
  const openLightbox = onOpenLightbox ?? onOpen ?? (() => {});

  const [showTime, setShowTime] = useState(false);
  const [picker, setPicker] = useState(false);
  const [tray, setTray] = useState(false);
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [heartBurst, setHeartBurst] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const lastTap = useRef(0);
  const url = message.localUrl ?? message.attachment_url ?? "";
  const uploading = Boolean(message.pending && message.attachment_path);
  const mediaOnly = message.kind === "image" || message.kind === "video";
  const reactions = Object.entries(message.reactions ?? {});
  const mine = message.reactions?.[myId] ?? null;
  const canReact = !message.pending && !message.failed;
  const canEdit = outgoing && message.kind === "text" && !message.pending && Boolean(onEdit);

  useEffect(() => {
    if (!picker) return;
    const close = () => {
      setPicker(false);
      setTray(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [picker]);

  const openPicker = () => {
    haptic("medium");
    setPicker(true);
  };

  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      openPicker();
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const choose = (emoji: string) => {
    haptic("success");
    setPicker(false);
    setTray(false);
    onReact(message, mine === emoji ? null : emoji);
  };

  const copy = async () => {
    const value = message.body ?? message.attachment_url ?? "";
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const t = document.createElement("textarea");
      t.value = value;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    haptic("light");
    setCopied(true);
    setPicker(false);
    setTimeout(() => setCopied(false), 1400);
  };

  /** Double-tap a photo/video to like it with a heart. */
  const mediaTap = (open: () => void) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (canReact) {
        setHeartBurst(true);
        setTimeout(() => setHeartBurst(false), 700);
        haptic("success");
        if (mine !== "❤️") onReact(message, "❤️");
      }
      return;
    }
    lastTap.current = now;
    window.setTimeout(() => {
      if (lastTap.current === now && !uploading && !longPressed.current) open();
    }, 300);
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
            "absolute bottom-full z-30 mb-2 flex w-[min(20rem,88vw)] flex-col gap-2",
            outgoing ? "right-0 items-end" : "left-0 items-start",
          )}
        >
          {canReact && !tray && (
            <div className="glass flex gap-0.5 rounded-full px-2 py-1.5 shadow-lg">
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
              <button
                type="button"
                aria-label="More emojis"
                onClick={() => setTray(true)}
                className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
              >
                <Plus className="size-5" />
              </button>
            </div>
          )}

          {canReact && tray && (
            <div className="glass w-full overflow-hidden rounded-3xl shadow-lg">
              <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
                {EMOJI_LISTS.map((g, i) => (
                  <button
                    key={g.label}
                    type="button"
                    aria-label={g.label}
                    onClick={() => setTab(i)}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-[18px]",
                      tab === i && "bg-primary/20",
                    )}
                  >
                    {g.icon}
                  </button>
                ))}
              </div>
              <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-2">
                {EMOJI_LISTS[tab]?.items.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => choose(emoji)}
                    className="flex aspect-square items-center justify-center rounded-lg text-[22px] active:scale-125"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="glass flex min-w-40 flex-col overflow-hidden rounded-2xl text-[15px] shadow-lg">
            {message.body && (
              <button type="button" onClick={copy} className="flex items-center justify-between gap-6 px-4 py-2.5 text-left active:bg-secondary">
                Copy <Copy className="size-4" />
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setPicker(false);
                  onEdit?.(message);
                }}
                className="flex items-center justify-between gap-6 border-t border-border px-4 py-2.5 text-left active:bg-secondary"
              >
                Edit <Pencil className="size-4" />
              </button>
            )}
            {message.failed && onRetry && (
              <button
                type="button"
                onClick={() => {
                  setPicker(false);
                  onRetry(message);
                }}
                className="flex items-center justify-between gap-6 border-t border-border px-4 py-2.5 text-left text-primary active:bg-secondary"
              >
                Resend <RotateCw className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onPointerMove={cancelPress}
        onContextMenu={(e) => {
          e.preventDefault();
          openPicker();
        }}
        onClick={() => {
          if (longPressed.current) return;
          setShowTime((value) => !value);
        }}
        className={cn(
          "relative max-w-[80%] animate-bubble-in cursor-pointer text-left transition-transform duration-200",
          picker && "scale-[1.03]",
          mediaOnly
            ? "rounded-3xl select-none [-webkit-touch-callout:none]"
            : cn(
                "rounded-3xl px-3.5 py-2",
                outgoing
                  ? "bg-bubble-out text-bubble-out-foreground"
                  : "bg-bubble-in text-bubble-in-foreground",
              ),
          message.failed && "opacity-70",
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

        {heartBurst && (
          <span className="pointer-events-none absolute inset-0 z-20 flex animate-ping items-center justify-center text-6xl">
            ❤️
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
                mediaTap(() => openLightbox({ url, kind: "image", name: message.attachment_name }));
              }}
              className="block max-h-80 w-full max-w-xs bg-secondary object-cover"
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
              className="block max-h-80 w-full max-w-xs bg-secondary object-cover"
              onClick={(e) => {
                e.stopPropagation();
                mediaTap(() => openLightbox({ url, kind: "video", name: message.attachment_name }));
              }}
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-foreground/45 text-background backdrop-blur-sm">
                <Play className="size-6 fill-current" />
              </span>
            </span>
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
            <span className="flex size-10 items-center justify-center rounded-2xl bg-background/25">
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
              "block text-[16.5px] leading-snug whitespace-pre-wrap select-text",
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

      {message.failed ? (
        <button
          type="button"
          onClick={() => onRetry?.(message)}
          className="mt-1 flex items-center gap-1 px-2 text-[11.5px] font-medium text-destructive"
        >
          <RotateCw className="size-3" /> Not delivered · Tap to resend
        </button>
      ) : (
        <span
          className={cn(
            "overflow-hidden px-2 text-[11px] tabular-nums text-muted-foreground transition-all duration-300",
            showTime || message.pending || receipt || copied || message.edited_at
              ? "mt-1 max-h-6 opacity-100"
              : "max-h-0 opacity-0",
          )}
        >
          {copied
            ? "Copied"
            : message.pending
              ? message.attachment_path
                ? `Sending… ${Math.round((message.progress ?? 0) * 100)}%`
                : "Sending…"
              : [
                  message.edited_at ? "Edited" : null,
                  showTime ? formatClock(message.created_at) : receipt,
                ]
                  .filter(Boolean)
                  .join(" · ")}
        </span>
      )}
    </div>
  );
}
