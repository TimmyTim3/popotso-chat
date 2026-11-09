import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellRing, Info, LogOut, Phone, Video, X } from "lucide-react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";

import { AuthScreen } from "@/components/chat/AuthScreen";
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
    return <AuthScreen onSignedIn={() => {}} />;
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
  const partnerName = isNicky ? "Father" : "Mother";

  const markPartnerAsRead = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("messages")
      .update({ is_read: true })
      .neq("sender_id", userId)
      .eq("is_read", false);
  }, [userId]);

  const refreshMessages = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return;

    const outboxItems = loadOutbox(userId);

    const dbItems: ChatMessage[] = (data ?? []).map((row: any) => ({
      id: row.id,
      client_id: row.client_id ?? undefined,
      sender_id: row.sender_id,
      sender_email: row.sender_email,
      body: row.body,
      kind: row.kind,
      attachment_path: row.attachment_path,
      attachment_url: row.attachment_url,
      attachment_name: row.attachment_name,
      attachment_type: row.attachment_type,
      attachment_size: row.attachment_size,
      duration_ms: row.duration_ms,
      reactions: row.reactions ?? {},
      created_at: row.created_at,
      edited_at: row.edited_at ?? null,
      pending: false,
      failed: false,
    }));

    const merged = [...dbItems];
    for (const out of outboxItems) {
      const matchIndex = merged.findIndex(
        (m) => m.client_id === out.client_id || m.id === out.id,
      );
      if (matchIndex >= 0) {
        const matchingMessage = merged[matchIndex];
        if (out.failed && matchingMessage) matchingMessage.failed = true;
      } else {
        merged.push(out);
      }
    }

    setMessages(merged);
    void markPartnerAsRead();
  }, [markPartnerAsRead, userId]);

  useEffect(() => {
    void refreshMessages();
    void currentPushEnabled().then(setPushActive);
  }, [refreshMessages]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  // Realtime subscription for messages, reads, and typing
  useEffect(() => {
    const channel = supabase
      .channel("care-desk-room", {
        config: { broadcast: { self: false } },
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row: any = payload.new;
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === row.id || (row.client_id && m.client_id === row.client_id));
              if (exists) {
                return prev.map((m) =>
                  m.id === row.id || (row.client_id && m.client_id === row.client_id)
                    ? { ...m, ...row, pending: false, failed: false }
                    : m,
                );
              }
              return [
                ...prev,
                {
                  id: row.id,
                  client_id: row.client_id ?? undefined,
                  sender_id: row.sender_id,
                  sender_email: row.sender_email,
                  body: row.body,
                  kind: row.kind,
                  attachment_path: row.attachment_path,
                  attachment_url: row.attachment_url,
                  attachment_name: row.attachment_name,
                  attachment_type: row.attachment_type,
                  attachment_size: row.attachment_size,
                  duration_ms: row.duration_ms,
                  reactions: row.reactions ?? {},
                  created_at: row.created_at,
                  edited_at: row.edited_at ?? null,
                  pending: false,
                  failed: false,
                },
              ];
            });
            if (row.sender_id !== userId) {
              haptic("light");
              void markPartnerAsRead();
            }
          } else if (payload.eventType === "UPDATE") {
            const row: any = payload.new;
            setMessages((prev) =>
              prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)),
            );
          }
        },
      )
      .on("broadcast", { event: "typing" }, (payload: any) => {
        if (payload.payload?.email !== email) {
          setTyping(payload.payload?.name || "Partner");
          if (typingTimeout.current) window.clearTimeout(typingTimeout.current);
          typingTimeout.current = window.setTimeout(() => setTyping(null), 2500);
        }
      })
      .on("broadcast", { event: "call-offer" }, (payload: any) => {
        const data = payload.payload;
        if (!data || data.callerId === userId || !data.sdp) return;
        {
          setIncomingCall({
            callerId: data.callerId,
            callerName: data.callerName || "Family",
            isVideo: Boolean(data.isVideo),
            sdp: data.sdp,
          });
          setCallWithVideo(Boolean(data.isVideo));
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

  const patch = (clientId: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.client_id === clientId || m.id === clientId ? { ...m, ...updates } : m)),
    );
  };

  const handleCancelUpload = useCallback((clientId: string) => {
    const controller = uploadControllers.current.get(clientId);
    if (controller) {
      controller.abort();
      uploadControllers.current.delete(clientId);
    }
    deleteOutbox(clientId);
    void deleteBlob(clientId);
    setMessages((prev) => prev.filter((m) => (m.client_id || m.id) !== clientId));
    haptic("light");
  }, []);

  const insert = async (row: Partial<ChatMessage> & { client_id: string }) => {
    const clientId = row.client_id;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("messages")
        .insert({
          client_id: clientId,
          sender_id: userId,
          sender_email: email,
          body: row.body ?? null,
          kind: row.kind,
          attachment_path: row.attachment_path ?? null,
          attachment_url: row.attachment_url ?? null,
          attachment_name: row.attachment_name ?? null,
          attachment_type: row.attachment_type ?? null,
          attachment_size: row.attachment_size ?? null,
          duration_ms: row.duration_ms ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      deleteOutbox(clientId);
      void deleteBlob(clientId);

      setMessages((prev) =>
        prev.map((m) => (m.client_id === clientId ? { ...m, ...data, pending: false, failed: false } : m)),
      );

      void notifyPartner({
        recipientEmail: partnerEmail,
        senderName: isNicky ? "Mother" : "Father",
        preview: previewFor(row.kind ?? "text", row.body ?? null),
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
        created_at: new Date().toISOString(),
        pending: false,
        failed: true,
      });
      haptic("error");
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

    setMessages((prev) => {
      const item: ChatMessage = Object.assign(
        {
          id: clientId,
          client_id: clientId,
          sender_id: userId,
          sender_email: email,
          localUrl,
          created_at: new Date().toISOString(),
          kind,
          body: null,
          attachment_path: path,
          attachment_name: name,
          attachment_type: blob.type,
          attachment_size: blob.size,
          duration_ms: durationMs ?? null,
          progress: 0,
          pending: true,
          failed: false,
        },
        clientId,
      );
      return [...prev, item];
    });

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
      await insert(
        {
          client_id: clientId,
          kind,
          attachment_path: path,
          attachment_url: url,
          attachment_name: name,
          attachment_type: blob.type,
          attachment_size: blob.size,
          duration_ms: durationMs ?? null,
        },
      );
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
      haptic("error");
    } finally {
      uploadControllers.current.delete(clientId);
    }
  };

  const handleSendText = async (text: string) => {
    const clientId = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id: clientId,
      client_id: clientId,
      sender_id: userId,
      sender_email: email,
      body: text,
      kind: "text",
      created_at: new Date().toISOString(),
      pending: true,
      failed: false,
    };

    putOutbox(optimistic);
    setMessages((prev) => [...prev, optimistic]);
    await insert({ client_id: clientId, kind: "text", body: text });
  };

  const handleRetry = async (msg: ChatMessage) => {
    const clientId = msg.client_id || msg.id;
    patch(clientId, { failed: false, pending: true });
    if (msg.kind === "text" && msg.body) {
      await insert({ client_id: clientId, kind: "text", body: msg.body });
    } else {
      const cached = await getBlob(clientId);
      if (cached) {
        await uploadAndSend(
          cached,
          msg.kind as any,
          msg.attachment_name ?? "file",
          msg.duration_ms ?? undefined,
        );
      } else {
        patch(clientId, { failed: true, pending: false });
      }
    }
  };

  const handleEdit = useCallback((msg: ChatMessage) => {
    setEditingMessage(msg);
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

    const current = { ...(msg.reactions ?? {}) };
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
    } else if (res !== "denied") {
      // Alert handled directly in push.ts with exact reason
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

  const lastOutgoingIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && (msg.sender_id === userId || msg.sender_email === email)) {
        return i;
      }
    }
    return -1;
  }, [messages, userId, email]);

  const partnerHasRead = useMemo(() => {
    const partnerMessages = messages.filter((m) => m.sender_id !== userId);
    if (!partnerMessages.length) return false;
    return true;
  }, [messages, userId]);

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

        <div className="flex items-center gap-1">
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
                  isRead={isLastOutgoing && partnerHasRead}
                  onSelectMedia={(url, kind) => setLightbox({ url, kind })}
                  onReact={(emoji) => handleReaction(msg.id, emoji)}
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
        onSendMedia={async (file, kind) => {
          await uploadAndSend(file, kind, file.name);
        }}
        onSendAudio={async (blob, durationMs) => {
          const mime = pickAudioMime();
          const ext = audioExtension(mime);
          await uploadAndSend(blob, "audio", `voice-note-${Date.now()}.${ext}`, durationMs);
        }}
        onTyping={handleBroadcastTyping}
        editing={editingMessage ? { id: editingMessage.id, text: editingMessage.body ?? "" } : null}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
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
          isOpen={inCall || Boolean(incomingCall)}
          onClose={() => {
            setInCall(false);
            setIncomingCall(null);
          }}
          partnerName={partnerName}
          isOutgoing={inCall && !incomingCall}
          channel={channelRef.current}
          userId={userId}
          enableVideo={callWithVideo}
          incomingOffer={incomingCall?.sdp}
        />
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
