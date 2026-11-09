import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock, Copy, Edit2, FileText, RefreshCw, SmilePlus } from "lucide-react";

import { ProgressRing } from "@/components/chat/ProgressRing";
import { VoiceNote } from "@/components/chat/VoiceNote";
import {
  formatBytes,
  formatTime,
  type ChatMessage,
} from "@/lib/care-desk";
import { QUICK_EMOJIS, REACTION_CATEGORIES } from "@/lib/emoji";
import { haptic } from "@/lib/haptics";

interface MessageBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  onSelectMedia?: (url: string, kind: "image" | "video") => void;
  onReact?: (emoji: string) => void;
  onRetry?: () => void;
  onEdit?: (message: ChatMessage) => void;
  onCancelUpload?: (clientId: string) => void;
  partnerName?: string;
  isRead?: boolean;
}

export function MessageBubble({
  message,
  outgoing,
  onSelectMedia,
  onReact,
  onRetry,
  onEdit,
  onCancelUpload,
  partnerName = "Partner",
  isRead = false,
}: MessageBubbleProps) {
  const [showTime, setShowTime] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const lastTap = useRef(0);
  const url = message.localUrl ?? message.attachment_url ?? "";
  const uploading = Boolean(message.pending && message.attachment_path);
  const mediaOnly = message.kind === "image" || message.kind === "video";
  const canReact = !message.pending && !message.failed;
  const canEdit = outgoing && message.kind === "text" && !message.pending && Boolean(onEdit);

  // Group reactions and safely extract actual emojis (never UUIDs)
  const groupedReactions = useMemo(() => {
    const raw = message.reactions ?? {};
    const map = new Map<string, number>();
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === "string" && val.trim().length <= 8 && !val.startsWith("http")) {
        // Standard DB schema: key is userId UUID, val is emoji
        map.set(val, (map.get(val) ?? 0) + 1);
      } else if (Array.isArray(val) && key.trim().length <= 8) {
        // Fallback schema: key is emoji, val is array of userIds
        map.set(key, (map.get(key) ?? 0) + val.length);
      }
    }
    return Array.from(map.entries());
  }, [message.reactions]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setTrayOpen(false);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = () => closeMenu();
    window.addEventListener("click", handleOutside);
    return () => window.removeEventListener("click", handleOutside);
  }, [menuOpen, closeMenu]);

  const openMenu = () => {
    haptic("medium");
    setMenuOpen(true);
    setTrayOpen(false);
  };

  const handleCopy = async () => {
    haptic("light");
    try {
      if (message.body) {
        await navigator.clipboard.writeText(message.body);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // fallback
    }
    closeMenu();
  };

  const handleReaction = (emoji: string) => {
    haptic("light");
    onReact?.(emoji);
    closeMenu();
  };

  // Double tap to love (heart)
  const handleBubbleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;

    if (now - lastTap.current < DOUBLE_TAP_DELAY && canReact) {
      lastTap.current = 0;
      haptic("medium");
      onReact?.("❤️");
      return;
    }
    lastTap.current = now;

    if (!uploading && !longPressed.current) {
      setShowTime((prev) => !prev);
    }
    longPressed.current = false;
  };

  const handleTouchStart = () => {
    longPressed.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      openMenu();
    }, 450);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu();
  };

  const receipt = outgoing && !message.pending && !message.failed ? (
    isRead ? (
      <span className="flex items-center text-primary font-medium">
        <CheckCheck className="size-3 stroke-[2.5]" />
        <span className="ml-0.5">Read</span>
      </span>
    ) : (
      <span className="flex items-center text-muted-foreground font-normal">
        <Check className="size-3 stroke-[2.2]" />
        <span className="ml-0.5">Delivered</span>
      </span>
    )
  ) : null;

  return (
    <div
      className={`group relative mb-2 flex flex-col ${
        outgoing ? "items-end" : "items-start"
      }`}
    >
      {/* Context Action Menu */}
      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-30 mb-2 flex flex-col gap-1 rounded-2xl border border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md ${
            outgoing ? "right-0 bottom-full" : "left-0 bottom-full"
          }`}
        >
          {/* Quick Reaction Bar */}
          {canReact && !trayOpen && (
            <div className="flex items-center gap-1 border-b border-border/40 pb-1.5">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleReaction(emoji)}
                  className="flex size-8 items-center justify-center rounded-full text-lg transition hover:scale-125 active:scale-95"
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTrayOpen(true)}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary"
                aria-label="More emoji reactions"
              >
                <SmilePlus className="size-4" />
              </button>
            </div>
          )}

          {/* Full Emoji Tray */}
          {canReact && trayOpen && (
            <div className="max-h-56 w-64 overflow-y-auto border-b border-border/40 p-1">
              {REACTION_CATEGORIES.map((cat) => (
                <div key={cat.label} className="mb-2">
                  <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {cat.label}
                  </div>
                  <div className="grid grid-cols-6 gap-1">
                    {cat.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleReaction(emoji)}
                        className="flex size-7 items-center justify-center rounded text-lg transition hover:scale-125 active:scale-95"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
              {/* Action Row */}
          <div className="flex items-center gap-1 pt-0.5">
            {message.body && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
              >
                <Copy className="size-3.5 text-muted-foreground" />
                <span>Copy</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onEdit?.(message);
                }}
                className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
              >
                <Edit2 className="size-3.5 text-muted-foreground" />
                <span>Edit</span>
              </button>
            )}

            {message.failed && onRetry && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onRetry();
                }}
                className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/10"
              >
                <RefreshCw className="size-3.5" />
                <span>Retry</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bubble Container */}
      <div
        onClick={handleBubbleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenu}
        className={`relative max-w-[82%] select-text overflow-hidden rounded-[20px] transition active:scale-[0.99] ${
          mediaOnly
            ? "p-0 bg-transparent"
            : outgoing
            ? "bg-bubble-out text-bubble-out-foreground px-3.5 py-2 shadow-sm"
            : "bg-bubble-in text-bubble-in-foreground px-3.5 py-2 shadow-sm"
        }`}
      >
        {/* Floating iOS Tapback Badge on top corner of bubble */}
        {groupedReactions.length > 0 && (
          <div
            className={`absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border-2 border-background bg-secondary px-1.5 py-0.5 text-xs shadow-sm ${
              outgoing ? "-left-2" : "-right-2"
            }`}
          >
            {groupedReactions.map(([emoji, count]) => (
              <span key={emoji} className="flex items-center gap-0.5">
                <span>{emoji}</span>
                {count > 1 && (
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {count}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Text Message */}
        {message.kind === "text" && (
          <p className="whitespace-pre-wrap break-words text-[15.5px] leading-snug tracking-[-0.01em]">
            {message.body}
          </p>
        )}

        {/* Image Attachment */}
        {message.kind === "image" && (
          <div
            className="relative cursor-pointer overflow-hidden rounded-[18px] bg-secondary/50"
            onClick={() => url && !uploading && onSelectMedia?.(url, "image")}
          >
            <img
              src={url}
              alt={message.attachment_name ?? "Photo"}
              className="max-h-[380px] w-auto max-w-full object-cover"
              loading="lazy"
            />
            {uploading && (
              <ProgressRing
                progress={message.progress ?? 0}
                onCancel={
                  onCancelUpload
                    ? () => onCancelUpload(message.client_id || message.id)
                    : undefined
                }
              />
            )}
          </div>
        )}

        {/* Video Attachment */}
        {message.kind === "video" && (
          <div
            className="relative cursor-pointer overflow-hidden rounded-[18px] bg-secondary/50"
            onClick={() => url && !uploading && onSelectMedia?.(url, "video")}
          >
            <video
              src={url}
              className="max-h-[380px] w-auto max-w-full object-cover"
              playsInline
              preload="metadata"
            />
            {uploading && (
              <ProgressRing
                progress={message.progress ?? 0}
                onCancel={
                  onCancelUpload
                    ? () => onCancelUpload(message.client_id || message.id)
                    : undefined
                }
              />
            )}
          </div>
        )}

        {/* Audio / Voice Note */}
        {message.kind === "audio" && (
          <div className="relative">
            <VoiceNote
              src={url}
              durationMs={message.duration_ms}
              outgoing={outgoing}
              seed={message.id}
            />
            {uploading && (
              <ProgressRing
                progress={message.progress ?? 0}
                size={40}
                onCancel={
                  onCancelUpload
                    ? () => onCancelUpload(message.client_id || message.id)
                    : undefined
                }
              />
            )}
          </div>
        )}

        {/* Document Attachment */}
        {message.kind === "document" && (
          <a
            href={uploading ? undefined : url}
            download={message.attachment_name ?? "document"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 py-1 text-sm font-medium underline-offset-2 hover:underline"
            onClick={(e) => uploading && e.preventDefault()}
          >
            <FileText className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{message.attachment_name ?? "Document"}</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(message.attachment_size)}</p>
            </div>
            {uploading && (
              <ProgressRing
                progress={message.progress ?? 0}
                size={34}
                onCancel={
                  onCancelUpload
                    ? () => onCancelUpload(message.client_id || message.id)
                    : undefined
                }
              />
            )}
          </a>
        )}
      </div>

      {/* Timestamp & Status Metadata */}
      <div
        className={`mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground transition-opacity ${
          showTime || message.pending || receipt || copied || message.edited_at || message.failed
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {copied ? (
          <span className="font-medium text-primary">Copied</span>
        ) : message.failed ? (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 font-semibold text-destructive hover:underline"
          >
            <RefreshCw className="size-3" />
            <span>Not Delivered • Tap to Retry</span>
          </button>
        ) : message.pending ? (
          <span className="flex items-center gap-1">
            <Clock className="size-3 animate-spin" />
            <span>Sending...</span>
          </span>
        ) : (
          <>
            <span>{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="italic">• Edited</span>}
            {receipt}
          </>
        )}
      </div>
    </div>
  );
          }
            
