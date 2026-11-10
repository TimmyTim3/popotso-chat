import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock, Copy, Edit2, FileText, Pin, RefreshCw, SmilePlus, Star, Phone, PhoneOff, Video, Trash2 } from "lucide-react";

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
  mediaGroup?: ChatMessage[];
  onSelectMediaGroup?: (items: ChatMessage[]) => void;
  onReact?: (emoji: string) => void;
  onRetry?: () => void;
  onDeleteFailed?: () => void;
  onEdit?: (message: ChatMessage) => void;
  onReply?: () => void;
  replyPreview?: { sender: string; text: string; messageId?: string } | null;
  isPinned?: boolean;
  isFavorite?: boolean;
  onPin?: () => void;
  onFavorite?: () => void;
  onCancelUpload?: (clientId: string) => void;
  partnerName?: string;
  isRead?: boolean;
}

export function MessageBubble({
  message,
  outgoing,
  onSelectMedia,
  mediaGroup,
  onSelectMediaGroup,
  onReact,
  onRetry,
  onDeleteFailed,
  onEdit,
  onReply,
  replyPreview,
  isPinned = false,
  isFavorite = false,
  onPin,
  onFavorite,
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
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const url = message.localUrl ?? message.attachment_url ?? "";
  const uploading = Boolean(message.pending && message.attachment_path);
  const callRecord = (() => { if (!message.body?.startsWith("[[POPOSO_CALL]]")) return null; try { return JSON.parse(message.body.slice(15)) as { outcome: string; video: boolean; durationSeconds: number; dataBytes: number }; } catch { return null; } })();
  const callDuration = callRecord ? `${Math.floor(callRecord.durationSeconds / 60)}:${String(callRecord.durationSeconds % 60).padStart(2, "0")}` : "";
  const mediaOnly = message.kind === "image" || message.kind === "video";
  const canReact = !message.pending && !message.failed;
  const canEdit = outgoing && message.kind === "text" && !message.pending && Boolean(onEdit);

  // Group reactions safely (handles both DB schema key=userId & key=emoji)
  const groupedReactions = useMemo(() => {
    const raw = (message.reactions ?? {}) as Record<string, unknown>;
    const map = new Map<string, number>();
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === "string") {
        const str = val.trim();
        if (str.length > 0 && str.length <= 8 && !str.startsWith("http")) {
          map.set(str, (map.get(str) ?? 0) + 1);
        }
      } else if (Array.isArray(val)) {
        const str = key.trim();
        if (str.length > 0 && str.length <= 8) {
          map.set(str, (map.get(str) ?? 0) + val.length);
        }
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

  // Double-tap sends a quick Heart reaction
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    longPressed.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      openMenu();
      longPressTimer.current = null;
    }, 2500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStart.current;
    const touch = e.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Moving means the user is scrolling, not requesting message actions.
    if (Math.hypot(dx, dy) > 10 && longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - (start?.x ?? 0);
    const dy = (e.changedTouches[0]?.clientY ?? 0) - (start?.y ?? 0);
    if (dx > 58 && Math.abs(dx) > Math.abs(dy) * 1.25 && onReply && !message.pending && !message.failed) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      longPressed.current = true;
      haptic("light");
      onReply();
      return;
    }
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleBubbleClick = (e: React.MouseEvent) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }

    lastTap.current = Date.now();
    setShowTime((prev) => !prev);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Do not bypass the deliberate 2.5-second press gesture with the browser menu.
    e.preventDefault();
  };

  const receipt = outgoing ? (
    isRead ? (
      <span className="flex items-center text-primary font-medium">
        <CheckCheck className="size-3 stroke-[2.4]" />
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
      id={`message-${message.id}`}
      className={`group relative mb-2 flex flex-col animate-[popotso-message-in_180ms_ease-out] motion-reduce:animate-none transition-all duration-200 ${
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
                  className="flex size-10 items-center justify-center rounded-full text-lg transition hover:scale-110 active:scale-95"
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
            {onReply && !message.pending && !message.failed && (
              <button
                type="button"
                onClick={() => { closeMenu(); onReply(); }}
                className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
              >
                <span>↩</span><span>Reply</span>
              </button>
            )}

            {onPin && !message.pending && !message.failed && (
              <button type="button" onClick={() => { closeMenu(); onPin(); }} className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary">
                <Pin className="size-3.5 text-muted-foreground" /><span>{isPinned ? "Unpin" : "Pin"}</span>
              </button>
            )}
            {onFavorite && !message.pending && !message.failed && (
              <button type="button" onClick={() => { closeMenu(); onFavorite(); }} className="flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary">
                <Star className="size-3.5 text-muted-foreground" /><span>{isFavorite ? "Unfavorite" : "Favorite"}</span>
              </button>
            )}

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
                {/* Bubble Container: overflow-visible ensures tapbacks are never clipped */}
      <div
        onClick={handleBubbleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onContextMenu={handleContextMenu}
        className={`relative max-w-[82%] select-none overflow-visible rounded-[20px] transition active:scale-[0.99] ${
          groupedReactions.length > 0 ? "mt-2.5" : ""
        } ${
          mediaOnly
            ? "p-0 bg-transparent"
            : outgoing
            ? "bg-bubble-out text-bubble-out-foreground px-3.5 py-2 shadow-sm"
            : "bg-bubble-in text-bubble-in-foreground px-3.5 py-2 shadow-sm"
        }`}
      >
        {/* Floating iOS 18 Tapback Badge on top shoulder of bubble */}
        {groupedReactions.length > 0 && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              openMenu();
            }}
            className={`absolute -top-2.5 z-20 flex cursor-pointer items-center gap-1 rounded-full border border-border/80 bg-secondary/95 px-2 py-0.5 text-xs shadow-md backdrop-blur-md transition-transform hover:scale-105 active:scale-95 ${
              outgoing ? "-left-1.5" : "-right-1.5"
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

        {replyPreview && (
          <button type="button" onClick={() => replyPreview.messageId && document.getElementById(`message-${replyPreview.messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="mb-2 block w-full rounded-xl border-l-[3px] border-primary bg-black/5 px-2.5 py-1.5 text-left text-xs dark:bg-white/10">
            <p className="font-semibold text-primary">{replyPreview.sender}</p>
            <p className="line-clamp-2 opacity-80">{replyPreview.text}</p>
          </button>
        )}

        {/* Text Message */}
        {message.kind === "text" && (
          <p className="whitespace-pre-wrap break-words text-[15.5px] leading-snug tracking-[-0.01em]">
            {callRecord ? (
              <div className="flex min-w-52 items-center gap-3 py-1">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${callRecord.outcome === "completed" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                  {callRecord.outcome === "completed" ? (callRecord.video ? <Video className="size-5" /> : <Phone className="size-5" />) : <PhoneOff className="size-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{callRecord.outcome === "completed" ? (callRecord.video ? "Video call" : "Voice call") : callRecord.outcome === "declined" ? "Call declined" : "No answer"}</div>
                  <div className="text-xs opacity-70">{callRecord.outcome === "completed" ? `Duration ${callDuration}` : "Call did not connect"}{callRecord.dataBytes > 0 ? ` · ${(callRecord.dataBytes / (1024 * 1024)).toFixed(2)} MB` : ""}</div>
                </div>
              </div>
            ) : message.body}
          </p>
        )}

        {/* Image Attachment */}
        {message.kind === "image" && (() => {
          const photos = mediaGroup?.length ? mediaGroup : [message];
          const visible = photos.slice(0, 4);
          const openPhotos = () => {
            if (onSelectMediaGroup) onSelectMediaGroup(photos);
            else if (url) onSelectMedia?.(url, "image");
          };
          return (
            <div className={`relative grid cursor-pointer overflow-hidden rounded-[18px] bg-secondary/50 ${visible.length === 1 ? "grid-cols-1" : "grid-cols-2"} ${visible.length === 3 ? "grid-rows-2" : ""}`} onClick={() => !uploading && openPhotos()} role="button" tabIndex={0} aria-label={`Open ${photos.length} shared photos`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPhotos(); } }}>
              {visible.map((photo, index) => {
                const photoUrl = photo.localUrl ?? photo.attachment_url ?? "";
                const featuredThree = visible.length === 3 && index === 0;
                const showMore = index === 3 && photos.length > 4;
                return (
                  <div key={photo.id} className={`relative min-w-0 overflow-hidden ${visible.length === 1 ? "max-h-[380px]" : "aspect-square"} ${featuredThree ? "row-span-2 aspect-auto" : ""}`}>
                    <img src={photoUrl} alt={photo.attachment_name ?? "Shared photo"} loading="lazy" className="h-full w-full object-cover" />
                    {showMore && <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white backdrop-blur-[2px]">+{photos.length - 4}</div>}
                  </div>
                );
              })}
              {uploading && <ProgressRing progress={message.progress ?? 0} onCancel={onCancelUpload ? () => onCancelUpload(message.client_id || message.id) : undefined} />}
            </div>
          );
        })()}

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
              <p className="text-[10px] text-muted-foreground">{formatBytes(message.attachment_size ?? null)}</p>
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-destructive">Not delivered</span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 font-semibold text-primary hover:bg-primary/15"
            >
              <RefreshCw className="size-3" />
              <span>Resend</span>
            </button>
            <button
              type="button"
              onClick={onDeleteFailed}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-destructive/10 px-2.5 font-semibold text-destructive hover:bg-destructive/15"
            >
              <Trash2 className="size-3" />
              <span>Delete</span>
            </button>
          </div>
        ) : message.pending ? (
          <span className="flex items-center gap-1">
            <Clock className="size-3 animate-spin" />
            <span>Sending...</span>
          </span>
        ) : (
          <>
            {isPinned && <Pin className="size-3 text-primary" aria-label="Pinned" />}
            {isFavorite && <Star className="size-3 fill-current text-primary" aria-label="Favorite" />}
            <span>{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="italic">• Edited</span>}
            {receipt}
          </>
        )}
      </div>
    </div>
  );
}
