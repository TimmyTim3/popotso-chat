import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellRing, Gamepad2, Info, LogOut, Pin, Phone, Star, Video, X } from "lucide-react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";

import { AuthScreen } from "@/components/chat/AuthScreen";
import { GameHub } from "@/components/chat/GameHub";
import { Composer } from "@/components/chat/Composer";
import { Lightbox } from "@/components/chat/Lightbox";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { VoiceCallModal } from "@/components/chat/VoiceCallModal";
import { supabase } from "@/integrations/supabase/client";
import {
  audioExtension,
  formatDayLabel,
  pickAudioMime,
  previewFor,
  signedUrlFor,
  uploadRaw,
  type ChatMessage,
  type MemberEmail,
} from "@/lib/care-desk";
import { haptic } from "@/lib/haptics";
import { deleteBlob, deleteOutbox, getBlob, loadOutbox, putBlob, putOutbox } from "@/lib/outbox";
import { notifyPartner } from "@/lib/push.functions";
import { currentPushEnabled, enablePush } from "@/lib/push";

const ATTRIBUTION =
  "System Architecture & Platform Engineering by Tim Web Development and Automation Agency. Designed exclusively for secure, high-integrity asynchronous communication and child care logistics.";

export const Route = createFileRoute("/")({
  component: ChatIndex,
  head: () => ({
    title: "Popotso Care Desk",
    meta: [
      {
        name: "description",
        content:
          "Secure, high-integrity asynchronous communication and child care logistics for Popotso.",
      },
      { property: "og:title", content: "Popotso Care Desk" },
      {
        property: "og:description",
        content:
          "Secure, high-integrity asynchronous communication and child care logistics for Popotso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ChatIndex() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <span className="text-sm">Loading Popotso Care Desk...</span>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return <ChatRoom session={session} />;
}

function ChatRoom({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; kind: "image" | "video" } | null>(null);
  const [showAttribution, setShowAttribution] = useState(false);
  const [pushActive, setPushActive] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [showGames, setShowGames] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("gameChallenge")) setShowGames(true);
  }, []);
  const [inCall, setInCall] = useState(false);
  const [callWithVideo, setCallWithVideo] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{
    callerId: string;
    callerName: string;
    isVideo?: boolean;
    sdp: RTCSessionDescriptionInit;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const uploadControllers = useRef<Map<string, AbortController>>(new Map());

  const userId = session.user.id;
  const email = (session.user.email ?? "") as MemberEmail;
  const isNicky = email === "nicky@popotso.app" || email === "mother@popotso.app";
  const partnerEmail: MemberEmail = isNicky ? "tim@popotso.app" : "nicky@popotso.app";
  const partnerName = isNicky ? "Tim" : "Mother";

  const markPartnerAsRead = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .neq("sender_id", userId)
      .is("read_at", null);
  }, [userId]);

  const refreshMessages = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Fetch messages failed:", error);
      return;
    }

    const rows = (data ?? []) as ChatMessage[];

    // Rehydrate signed URLs for storage media
    const hydrated = await Promise.all(
      rows.map(async (row) => {
        if (row.attachment_path && !row.attachment_url) {
          try {
            const url = await signedUrlFor(row.attachment_path);
            return { ...row, attachment_url: url };
          } catch {
            return row;
          }
        }
        return row;
      }),
    );

    const outbox = loadOutbox(userId);
    const serverClientIds = new Set(hydrated.map((m) => m.client_id).filter(Boolean));
    const pendingOutbox = outbox.filter((m) => !serverClientIds.has(m.client_id));

    setMessages([...hydrated, ...pendingOutbox]);
    void markPartnerAsRead();
  }, [userId, markPartnerAsRead]);

  useEffect(() => {
    void refreshMessages();
    void currentPushEnabled().then(setPushActive);
  }, [refreshMessages]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  // Realtime channel subscription for chat updates, typing indicators, and WebRTC calls
  useEffect(() => {
    const channel = supabase
      .channel("care-desk-chat", { config: { broadcast: { self: false } } })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row = payload.new as ChatMessage;
          let finalUrl = row.attachment_url;
          if (row.attachment_path && !finalUrl) {
            try {
              finalUrl = await signedUrlFor(row.attachment_path);
            } catch {
              // fallback
            }
          }
          const incoming: ChatMessage = { ...row, attachment_url: finalUrl };

          setMessages((prev) => {
            const idx = prev.findIndex((m) => (m.client_id && m.client_id === row.client_id) || m.id === row.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = incoming;
              return copy;
            }
            return [...prev, incoming];
          });

          if (row.sender_id !== userId) {
            void markPartnerAsRead();
            haptic("light");
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const updated = payload.new as ChatMessage;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
        },
      )
      .on("broadcast", { event: "typing" }, (event) => {
        const payload = event.payload as { email: string; name: string } | undefined;
        if (payload?.email && payload.email !== email) {
          setTyping(payload.name);
          if (typingTimeout.current) window.clearTimeout(typingTimeout.current);
          typingTimeout.current = window.setTimeout(() => setTyping(null), 2500);
        }
      })
      .on("broadcast", { event: "call-offer" }, (event) => {
        const payload = event.payload as {
          callerId: string;
          callerName: string;
          sdp: RTCSessionDescriptionInit;
          isVideo?: boolean;
        };
        if (payload && payload.callerId !== userId) {
          setIncomingCall({
            callerId: payload.callerId,
            callerName: payload.callerName,
            sdp: payload.sdp,
            isVideo: payload.isVideo,
          });
          setCallWithVideo(Boolean(payload.isVideo));
          haptic("medium");
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (typingTimeout.current) window.clearTimeout(typingTimeout.current);
      channel.unsubscribe();
    };
  }, [email, markPartnerAsRead, userId]);

  const patch = (clientId: string, delta: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.client_id === clientId || m.id === clientId ? { ...m, ...delta } : m)),
    );
  };

  const insert = async (row: Partial<ChatMessage>) => {
    const clientId = row.client_id ?? crypto.randomUUID();
    const payload = {
      client_id: clientId,
      sender_id: userId,
      sender_email: email,
      kind: row.kind ?? "text",
      body: row.body ?? null,
      attachment_path: row.attachment_path ?? null,
      attachment_url: row.attachment_url ?? null,
      attachment_name: row.attachment_name ?? null,
      attachment_type: row.attachment_type ?? null,
      attachment_size: row.attachment_size ?? null,
      duration_ms: row.duration_ms ?? null,
      reply_to_id: row.reply_to_id ?? null,
      reactions: {},
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("messages")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      deleteOutbox(clientId);
      void deleteBlob(clientId);

      setMessages((prev) =>
        prev.map((m) => (m.client_id === clientId ? { ...m, ...data, pending: false, failed: false } : m)),
      );

      void notifyPartner({
        data: {
          preview: previewFor(row.kind ?? "text", row.body ?? null),
          title: isNicky ? "Mother" : "Father",
        },
      }).catch((error) => {
        // Push delivery must never turn a successfully-sent chat message into a failed message.
        console.error("Partner notification request failed:", error);
      });
    } catch {
      patch(clientId, { failed: true, pending: false });
      putOutbox({
        id: clientId,
        client_id: clientId,
        sender_id: userId,
        sender_email: email,
        body: row.body ?? null,
        kind: row.kind ?? "text",
        attachment_path: row.attachment_path ?? null,
        attachment_url: row.attachment_url ?? null,
        attachment_name: row.attachment_name ?? null,
        attachment_type: row.attachment_type ?? null,
        attachment_size: row.attachment_size ?? null,
        duration_ms: row.duration_ms ?? null,
        reply_to_id: row.reply_to_id ?? null,
        created_at: new Date().toISOString(),
        pending: false,
        failed: true,
      });
      haptic("warning");
    }
  };
          const uploadAndSend = async (
    blob: Blob,
    kind: "image" | "video" | "audio" | "document",
    name: string,
    durationMs?: number,
  ) => {
    const clientId = crypto.randomUUID();
    const ext = name.includes(".") ? name.split(".").pop() : "";
    const path = `${userId}/${Date.now()}-${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const localUrl = URL.createObjectURL(blob);

    void putBlob(clientId, blob);

    const optimistic: ChatMessage = {
      id: clientId,
      client_id: clientId,
      sender_id: userId,
      sender_email: email,
      body: null,
      kind,
      attachment_path: path,
      attachment_name: name,
      attachment_type: blob.type,
      attachment_size: blob.size,
      duration_ms: durationMs ?? null,
      localUrl,
      created_at: new Date().toISOString(),
      pending: true,
      failed: false,
      progress: 0,
    };

    putOutbox(optimistic);
    setMessages((prev) => [...prev, optimistic]);

    const controller = new AbortController();
    uploadControllers.current.set(clientId, controller);

    try {
      await uploadRaw(
        path,
        blob,
        blob.type,
        (fraction) => {
          patch(clientId, { progress: fraction });
        },
        controller.signal,
      );
      uploadControllers.current.delete(clientId);
      const url = await signedUrlFor(path);
      patch(clientId, { attachment_url: url, progress: 1 });
      await insert({
        client_id: clientId,
        kind,
        attachment_path: path,
        attachment_url: url,
        attachment_name: name,
        attachment_type: blob.type,
        attachment_size: blob.size,
        duration_ms: durationMs ?? null,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => (m.client_id || m.id) !== clientId));
        deleteOutbox(clientId);
        void deleteBlob(clientId);
        return;
      }
      patch(clientId, { failed: true, pending: false });
      putOutbox({
        id: clientId,
        client_id: clientId,
        sender_id: userId,
        sender_email: email,
        body: null,
        kind,
        attachment_path: path,
        attachment_name: name,
        attachment_type: blob.type,
        attachment_size: blob.size,
        duration_ms: durationMs ?? null,
        created_at: new Date().toISOString(),
        pending: false,
        failed: true,
      });
      haptic("warning");
    } finally {
      uploadControllers.current.delete(clientId);
    }
  };

  const handleSendText = async (text: string) => {
    const clientId = crypto.randomUUID();
    const replyToId = replyTarget?.id ?? null;
    setReplyTarget(null);
    const optimistic: ChatMessage = {
      id: clientId,
      client_id: clientId,
      sender_id: userId,
      sender_email: email,
      body: text,
      kind: "text",
      reply_to_id: replyToId,
      created_at: new Date().toISOString(),
      pending: true,
      failed: false,
    };

    putOutbox(optimistic);
    setMessages((prev) => [...prev, optimistic]);
    await insert({ client_id: clientId, body: text, kind: "text", reply_to_id: replyToId });
  };

  const handleCancelUpload = (clientId: string) => {
    const controller = uploadControllers.current.get(clientId);
    if (controller) {
      controller.abort();
      uploadControllers.current.delete(clientId);
    }
    setMessages((prev) => prev.filter((m) => (m.client_id || m.id) !== clientId));
    deleteOutbox(clientId);
    void deleteBlob(clientId);
    haptic("light");
  };

  const handleRetry = async (msg: ChatMessage) => {
    const cid = msg.client_id || msg.id;
    patch(cid, { failed: false, pending: true, progress: 0 });

    if (msg.kind === "text") {
      await insert({ client_id: cid, body: msg.body, kind: "text" });
      return;
    }

    const cachedBlob = await getBlob(cid);
    if (cachedBlob && msg.attachment_name) {
      await uploadAndSend(cachedBlob, msg.kind, msg.attachment_name, msg.duration_ms ?? undefined);
    } else {
      patch(cid, { failed: true, pending: false });
    }
  };

  const handleEdit = useCallback((message: ChatMessage) => {
    setEditingMessage(message);
  }, []);

  const handleSaveEdit = useCallback(
    async (id: string, newText: string) => {
      setEditingMessage(null);
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id || m.client_id === id
            ? { ...m, body: newText, edited_at: now }
            : m,
        ),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("messages")
        .update({ body: newText, edited_at: now })
        .eq("id", id);
      haptic("light");
    },
    [],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleReaction = async (messageId: string, emoji: string) => {
    const msg = messages.find((m) => m.id === messageId || m.client_id === messageId);
    if (!msg) return;

    const current: Record<string, string> = { ...((msg.reactions as Record<string, string>) ?? {}) };
    if (current[userId] === emoji) {
      delete current[userId];
    } else {
      current[userId] = emoji;
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId || m.client_id === messageId ? { ...m, reactions: current } : m)),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("messages").update({ reactions: current }).eq("id", messageId);
  };

  const enableNotifications = async () => {
    const res = await enablePush(userId);
    if (res === "enabled") {
      setPushActive(true);
      haptic("success");
    }
  };

  const startCall = (video: boolean) => {
    setCallWithVideo(video);
    setInCall(true);
    haptic("medium");
  };

  const handleBroadcastTyping = () => {
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { email, name: isNicky ? "Mother" : "Father" },
    });
  };

  // Group messages chronologically by day label
  const grouped = useMemo(() => {
    const groups: { label: string; items: ChatMessage[] }[] = [];
    let currentLabel = "";
    let currentGroup: ChatMessage[] = [];

    for (const msg of messages) {
      const label = formatDayLabel(msg.created_at);
      if (label !== currentLabel) {
        if (currentGroup.length) groups.push({ label: currentLabel, items: currentGroup });
        currentLabel = label;
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }
    }
    if (currentGroup.length) groups.push({ label: currentLabel, items: currentGroup });
    return groups;
  }, [messages]);

  const pinnedMessage = useMemo(
    () => messages.filter((message) => Boolean(message.pinned_at)).sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""))[0] ?? null,
    [messages],
  );
  const favoriteMessages = useMemo(
    () => messages.filter((message) => (message.favorited_by ?? []).includes(userId)),
    [messages, userId],
  );

  const handlePin = async (message: ChatMessage) => {
    const pinned_at = message.pinned_at ? null : new Date().toISOString();
    setMessages((prev) => prev.map((item) => item.id === message.id ? { ...item, pinned_at } : item));
    const { error } = await (supabase as any).from("messages").update({ pinned_at }).eq("id", message.id);
    if (error) {
      console.error("Could not update pinned message:", error);
      void refreshMessages();
    }
  };

  const handleFavorite = async (message: ChatMessage) => {
    const current = message.favorited_by ?? [];
    const favorited_by = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    setMessages((prev) => prev.map((item) => item.id === message.id ? { ...item, favorited_by } : item));
    const { error } = await (supabase as any).from("messages").update({ favorited_by }).eq("id", message.id);
    if (error) {
      console.error("Could not update favorite message:", error);
      void refreshMessages();
    }
  };



  return (
    <div className="flex h-dvh flex-col bg-background font-sans text-foreground">
      {/* Top Glass Header */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAttribution((prev) => !prev)}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="System info"
          >
            <Info className="size-4" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold tracking-tight">Popotso Care Desk</h1>
            <span className="text-[11px] text-muted-foreground">Private Line</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowFavorites(true)}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="View favorite messages"
          >
            <Star className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowGames(true)}
            className="flex size-9 items-center justify-center rounded-full text-primary transition-colors hover:bg-secondary active:scale-95"
            aria-label="Open Popotso games"
          >
            <Gamepad2 className="size-4" />
          </button>

          {/* Audio Call */}
          <button
            type="button"
            onClick={() => startCall(false)}
            className="flex size-9 items-center justify-center rounded-full text-primary transition-colors hover:bg-secondary active:scale-95"
            aria-label="Start low-data audio call"
          >
            <Phone className="size-4" />
          </button>

          {/* Video Call */}
          <button
            type="button"
            onClick={() => startCall(true)}
            className="flex size-9 items-center justify-center rounded-full text-primary transition-colors hover:bg-secondary active:scale-95"
            aria-label="Start balanced video call"
          >
            <Video className="size-4" />
          </button>

          {/* Web Push Notifications Toggle */}
          <button
            type="button"
            onClick={enableNotifications}
            className={`flex size-9 items-center justify-center rounded-full transition-colors active:scale-95 ${
              pushActive
                ? "text-primary hover:bg-secondary"
                : "text-muted-foreground hover:bg-secondary"
            }`}
            aria-label="Enable notifications"
          >
            {pushActive ? <BellRing className="size-4" /> : <Bell className="size-4" />}
          </button>

          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {pinnedMessage && (
          <button type="button" onClick={() => document.getElementById(`message-${pinnedMessage.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="mb-4 flex w-full items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-left text-xs">
            <Pin className="size-4 shrink-0 text-primary" /><span className="min-w-0 truncate"><strong>Pinned</strong> · {pinnedMessage.sender_id === userId ? "You" : partnerName}: {previewFor(pinnedMessage.kind, pinnedMessage.body)}</span>
          </button>
        )}
        {grouped.map((group) => (
          <div key={group.label} className="mb-6">
            <div className="my-3 text-center">
              <span className="rounded-full bg-secondary/80 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                {group.label}
              </span>
            </div>
            {group.items.map((msg) => {
              const globalIndex = messages.findIndex((m) => m.id === msg.id);
              const isLastOutgoing = globalIndex === lastOutgoingIndex;
              const outgoing = msg.sender_id === userId || msg.sender_email === email;

              return (
                <MessageBubble
                  key={msg.client_id || msg.id}
                  message={msg}
                  outgoing={outgoing}
                  partnerName={partnerName}
                  isRead={Boolean(msg.read_at)}
                  onSelectMedia={(url, kind) => setLightbox({ url, kind })}
                  onReact={(emoji) => handleReaction(msg.id, emoji)}
                  onReply={() => setReplyTarget(msg)}
                  isPinned={Boolean(msg.pinned_at)}
                  isFavorite={(msg.favorited_by ?? []).includes(userId)}
                  onPin={() => void handlePin(msg)}
                  onFavorite={() => void handleFavorite(msg)}
                  replyPreview={msg.reply_to_id ? (() => {
                    const original = messages.find((item) => item.id === msg.reply_to_id || item.client_id === msg.reply_to_id);
                    return original ? { sender: original.sender_id === userId ? "You" : partnerName, text: previewFor(original.kind, original.body), messageId: original.id } : { sender: "Original message", text: "Message unavailable" };
                  })() : null}
                  onRetry={() => handleRetry(msg)}
                  onEdit={handleEdit}
                  onCancelUpload={handleCancelUpload}
                />
              );
            })}
          </div>
        ))}

        {typing && (
          <div className="mb-2 text-xs italic text-muted-foreground">
            {typing} is typing...
          </div>
        )}

        <div ref={scrollRef} />
      </main>

      {/* Composer Input Area */}
      <Composer
        onSendText={handleSendText}
        onSendFiles={(files) => {
          files.forEach((file) => {
            const kind = file.type.startsWith("image/")
              ? "image"
              : file.type.startsWith("video/")
                ? "video"
                : "document";
            void uploadAndSend(file, kind, file.name);
          });
        }}
        onSendVoice={async (blob, durationMs) => {
          const mime = pickAudioMime();
          const ext = audioExtension(mime);
          await uploadAndSend(blob, "audio", `voice-note-${Date.now()}.${ext}`, durationMs);
        }}
        onTyping={handleBroadcastTyping}
        editing={editingMessage ? { id: editingMessage.id, text: editingMessage.body ?? "" } : null}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        replying={replyTarget ? { sender: replyTarget.sender_id === userId ? "yourself" : partnerName, text: previewFor(replyTarget.kind, replyTarget.body) } : null}
        onCancelReply={() => setReplyTarget(null)}
      />

      {/* Fullscreen Media Lightbox */}
      {lightbox && (
        <Lightbox
          item={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Low-Data Voice & Video Call Modal */}
      {(inCall || incomingCall) && channelRef.current && (
        <VoiceCallModal
          myId={userId}
          myEmail={email}
          partnerEmail={partnerEmail}
          channel={channelRef.current}
          initialVideo={callWithVideo}
          incomingCall={incomingCall}
          onClose={() => {
            setInCall(false);
            setIncomingCall(null);
          }}
        />
      )}

      {showGames && <GameHub userId={userId} partnerName={partnerName} onClose={() => setShowGames(false)} />}

      {showFavorites && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <header className="flex h-14 items-center justify-between border-b border-border px-4"><h2 className="font-semibold">Favorite messages</h2><button type="button" onClick={() => setShowFavorites(false)} className="rounded-full p-2 hover:bg-secondary" aria-label="Close favorites"><X className="size-5" /></button></header>
          <div className="flex-1 overflow-y-auto p-4">{favoriteMessages.length ? favoriteMessages.map((message) => <button key={message.id} type="button" onClick={() => { setShowFavorites(false); window.setTimeout(() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }} className="mb-2 block w-full rounded-xl border border-border p-3 text-left"><span className="mb-1 block text-xs font-semibold text-primary">{message.sender_id === userId ? "You" : partnerName}</span><span className="text-sm">{previewFor(message.kind, message.body)}</span></button>) : <p className="py-12 text-center text-sm text-muted-foreground">No favorites yet. Long-press a message and tap Favorite.</p>}</div>
        </div>
      )}

      {/* Technical Attribution Modal */}
      {showAttribution && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setShowAttribution(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                System Attribution
              </span>
              <button
                type="button"
                onClick={() => setShowAttribution(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-foreground/90">{ATTRIBUTION}</p>
          </div>
        </div>
      )}
    </div>
  );
}
