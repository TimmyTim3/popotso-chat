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

  if (!session) return <AuthScreen />;
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
    caller: string;
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

    const outboxItems = await loadOutbox();

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
        if (out.failed) merged[matchIndex].failed = true;
      } else {
        merged.push(out);
      }
    }

    setMessages(merged);
    void markPartnerAsRead();
  }, [markPartnerAsRead]);

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
      .on("broadcast", { event: "call-signal" }, (payload: any) => {
        const data = payload.payload;
        if (!data || data.to !== email) return;
        if (data.type === "offer") {
          setIncomingCall({
            caller: data.from === "tim@popotso.app" ? "Father" : "Mother",
            isVideo: Boolean(data.isVideo),
            sdp: data.sdp,
          });
          setCallWithVideo(Boolean(data.isVideo));
          haptic("heavy");
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (typingTimeout.current) window.clearTimeout(typingTimeout.current);
      channel.unsubscribe();
    };
  }, [email, markPartnerAsRead, userId]);

  const patch = useCallback((clientId: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.client_id === clientId || m.id === clientId ? { ...m, ...updates } : m)),
    );
  }, []);

  const handleCancelUpload = useCallback((clientId: string) => {
    haptic("light");
    const controller = uploadControllers.current.get(clientId);
    if (controller) {
      controller.abort();
      uploadControllers.current.delete(clientId);
    }
    setMessages((prev) => prev.filter((m) => (m.client_id || m.id) !== clientId));
    void deleteBlob(clientId);
    void deleteOutbox(clientId);
  }, []);

  const optimistic = useCallback(
    (partial: Partial<ChatMessage>, clientId: string): ChatMessage => ({
      id: clientId,
      client_id: clientId,
      sender_id: userId,
      sender_email: email,
      body: null,
      kind: "text",
      attachment_path: null,
      attachment_url: null,
      attachment_name: null,
      attachment_type: null,
      attachment_size: null,
      duration_ms: null,
      reactions: {},
      created_at: new Date().toISOString(),
      pending: true,
      progress: 0,
      failed: false,
      ...partial,
    }),
    [email, userId],
  );

  const insert = useCallback(
    async (row: any, blobToCache?: Blob) => {
      const clientId = row.client_id;
      if (blobToCache && clientId) {
        await putBlob(clientId, blobToCache);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("messages")
        .insert({
          sender_id: userId,
          sender_email: email,
          ...row,
        })
        .select()
        .single();

      if (error) {
        console.error("Database insert failed", error);
        patch(clientId, { failed: true, pending: false });
        await putOutbox({
          id: clientId,
          client_id: clientId,
          sender_id: userId,
          sender_email: email,
          ...row,
          created_at: new Date().toISOString(),
          failed: true,
          pending: false,
        });
        return;
      }

      patch(clientId, { ...data, pending: false, failed: false });
      await deleteOutbox(clientId);
      if (clientId) await deleteBlob(clientId);

      void notifyPartner({
        data: {
          preview: previewFor(row.kind, row.body),
          title: isNicky ? "Mother" : "Father",
          type: "message",
        },
      }).catch(() => {});
    },
    [email, isNicky, patch, userId],
  );
          const sendBlob = useCallback(
    async (
      blob: Blob,
      kind: "image" | "video" | "audio" | "document",
      name: string,
      durationMs?: number,
    ) => {
      const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const ext = name.split(".").pop() || "bin";
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const localUrl = URL.createObjectURL(blob);

      setMessages((prev) => {
        const item = optimistic(
          {
            kind,
            localUrl,
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
          blob,
        );
      } catch (e: any) {
        uploadControllers.current.delete(clientId);
        if (e?.name === "AbortError") {
          setMessages((prev) => prev.filter((m) => (m.client_id || m.id) !== clientId));
          void deleteBlob(clientId);
          void deleteOutbox(clientId);
          return;
        }
        console.error("Upload failed", e);
        patch(clientId, { failed: true, pending: false });
        putOutbox({
          id: clientId,
          client_id: clientId,
          sender_id: userId,
          sender_email: email,
          body: null,
          kind,
          attachment_path: path,
          attachment_url: null,
          attachment_name: name,
          attachment_type: blob.type,
          attachment_size: blob.size,
          duration_ms: durationMs ?? null,
          created_at: new Date().toISOString(),
          failed: true,
          pending: false,
        });
      }
    },
    [email, insert, optimistic, patch, userId],
  );

  const sendFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const type = file.type;
      let kind: "image" | "video" | "audio" | "document" = "document";
      if (type.startsWith("image/")) kind = "image";
      else if (type.startsWith("video/")) kind = "video";
      else if (type.startsWith("audio/")) kind = "audio";
      void sendBlob(file, kind, file.name);
    });
  };

  const handleSendText = async (text: string) => {
    const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((prev) => [...prev, optimistic({ body: text, kind: "text", pending: true }, clientId)]);
    await insert({ client_id: clientId, kind: "text", body: text });
  };

  const handleRetry = useCallback(
    async (msg: ChatMessage) => {
      const clientId = msg.client_id || msg.id;
      if (msg.kind === "text" && msg.body) {
        patch(clientId, { pending: true, failed: false });
        await insert({ client_id: clientId, kind: "text", body: msg.body });
      } else {
        patch(clientId, { pending: true, failed: false, progress: 0 });
        const blob = await getBlob(clientId);
        if (blob && msg.attachment_name) {
          await sendBlob(blob, msg.kind, msg.attachment_name, msg.duration_ms ?? undefined);
        } else {
          alert("Media file is no longer available in cache to retry. Please select and send it again.");
        }
      }
    },
    [insert, patch, sendBlob],
  );

  const handleEdit = useCallback((msg: ChatMessage) => {
    setEditingMessage(msg);
  }, []);

  const handleSaveEdit = useCallback(
    async (id: string, newText: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id || m.client_id === id
            ? { ...m, body: newText, edited_at: new Date().toISOString() }
            : m,
        ),
      );
      setEditingMessage(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("messages")
        .update({ body: newText, edited_at: new Date().toISOString() })
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
    const senders = new Set(current[emoji] ?? []);

    if (senders.has(userId)) senders.delete(userId);
    else senders.add(userId);

    if (senders.size === 0) delete current[emoji];
    else current[emoji] = Array.from(senders);

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions: current } : m)),
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

  const startCall = (withVideo: boolean) => {
    haptic("light");
    setIncomingCall(null);
    setCallWithVideo(withVideo);
    setInCall(true);
    void notifyPartner({
      data: {
        title: "Popotso Incoming Call",
        preview: `📞 ${withVideo ? "Video" : "Voice"} call from ${isNicky ? "Mother" : "Father"}`,
        type: "call",
      },
    }).catch(() => {});
  };

  const grouped = useMemo(() => {
    const groups: { label: string; items: ChatMessage[] }[] = [];
    messages.forEach((msg) => {
      const label = formatDayLabel(msg.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(msg);
      else groups.push({ label, items: [msg] });
    });
    return groups;
  }, [messages]);

  const lastOutgoingIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_id === userId || m.sender_email === email) return i;
    }
    return -1;
  }, [messages, userId, email]);

  const partnerHasRead = useMemo(() => {
    return messages.some(
      (m) =>
        m.sender_id !== userId &&
        (m.sender_email === "nicky@popotso.app" || m.sender_email === "mother@popotso.app"),
    );
  }, [messages, userId]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAttribution(true)}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
            aria-label="App info"
          >
            <Info className="size-4" />
          </button>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">Popotso Care Desk</h1>
            <p className="text-[11px] text-muted-foreground">Private Line</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Low-Data Audio Call */}
          <button
            type="button"
            onClick={() => startCall(false)}
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="Low-data audio call"
            title="Start low-data audio call (~9MB/hr)"
          >
            <Phone className="size-4 text-primary" />
          </button>

          {/* HD Balanced Video Call */}
          <button
            type="button"
            onClick={() => startCall(true)}
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="HD balanced video call"
            title="Start HD video call (~160MB/hr)"
          >
            <Video className="size-4 text-primary" />
          </button>

          {/* Notification Alert Bell */}
          <button
            type="button"
            onClick={enableNotifications}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="Enable notifications"
            title={pushActive ? "Push alerts enabled" : "Turn on push notifications"}
          >
            {pushActive ? <BellRing className="size-4 text-primary" /> : <Bell className="size-4" />}
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
        onSendFiles={sendFiles}
        onSendVoiceNote={(blob, duration) =>
          sendBlob(blob, "audio", `voicenote.${audioExtension(pickAudioMime())}`, duration)
        }
        onTyping={() => {
          void channelRef.current?.send({
            type: "broadcast",
            event: "typing",
            payload: { email, name: isNicky ? "Mother" : "Father" },
          });
        }}
        editingMessage={editingMessage}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
      />

      {/* Fullscreen Media Lightbox */}
      {lightbox && (
        <Lightbox
          url={lightbox.url}
          kind={lightbox.kind}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Low-Data Voice & Video Call Modal */}
      {(inCall || incomingCall) && (
        <VoiceCallModal
          session={session}
          partnerEmail={partnerEmail}
          partnerName={partnerName}
          incomingOffer={incomingCall?.sdp}
          incomingCaller={incomingCall?.caller}
          initialVideo={callWithVideo}
          onClose={() => {
            setInCall(false);
            setIncomingCall(null);
          }}
        />
      )}

      {/* System Attribution Modal */}
      {showAttribution && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowAttribution(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border/80 bg-popover p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                System Attribution
              </h2>
              <button
                type="button"
                onClick={() => setShowAttribution(false)}
                className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              {ATTRIBUTION}
            </p>
          </div>
        </div>
      )}
    </div>
  );
                   }
