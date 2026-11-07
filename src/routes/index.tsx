import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellRing, Info, LogOut, Phone, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";

import { AuthScreen } from "@/components/chat/AuthScreen";
import { Composer } from "@/components/chat/Composer";
import { Lightbox, type LightboxItem } from "@/components/chat/Lightbox";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { VoiceCallModal } from "@/components/chat/VoiceCallModal";
import { supabase } from "@/integrations/supabase/client";
import {
  ATTRIBUTION,
  formatClock,
  formatDayLabel,
  kindForFile,
  previewFor,
  signedUrlFor,
  uploadRaw,
  type ChatMessage,
  type MessageKind,
} from "@/lib/care-desk";
import { haptic } from "@/lib/haptics";
import { currentPushEnabled, enablePush } from "@/lib/push";
import { notifyPartner } from "@/lib/push.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Popotso Care Desk — Private Family Messaging" },
      {
        name: "description",
        content:
          "A private, two-person message line for child care logistics: full-quality photos, video, documents and voice notes with no compression.",
      },
      { property: "og:title", content: "Popotso Care Desk — Private Family Messaging" },
      {
        property: "og:description",
        content:
          "Secure asynchronous messaging for two accounts, with uncompressed media and voice notes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function useSystemTheme() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
}

function Index() {
  useSystemTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="min-h-dvh bg-background" />;
  if (!session) return <AuthScreen />;
  return <ChatRoom session={session} />;
}

function ChatRoom({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [pushActive, setPushActive] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);

  // Call states
  const [calling, setCalling] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{
    callerId: string;
    callerName: string;
    sdp: RTCSessionDescriptionInit;
  } | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callChannelRef = useRef<RealtimeChannel | null>(null);

  const userId = session.user.id;
  const email = session.user.email ?? "";
  const partnerEmail = email === "tim@popotso.app" ? "mother@popotso.app" : "tim@popotso.app";

  const markAsRead = useCallback(async () => {
    const now = new Date().toISOString();
    await (supabase as any)
      .from("messages")
      .update({ read_at: now })
      .neq("sender_id", userId)
      .is("read_at", null);
  }, [userId]);

  useEffect(() => {
    void currentPushEnabled().then(setPushActive);
  }, []);

  useEffect(() => {
    let active = true;
    void supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (active && data) {
          setMessages(data as ChatMessage[]);
          void markAsRead();
        }
      });

    const channel = supabase
      .channel("care-desk-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            const withoutOptimistic = prev.filter(
              (m) => !(m.pending && m.client_id && m.client_id === incoming.client_id),
            );
            return [...withoutOptimistic, incoming];
          });
          if (incoming.sender_id !== userId) {
            haptic("light");
            void markAsRead();
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
      .subscribe();

    const presenceChannel = supabase
      .channel("care-desk-presence")
      .on("broadcast", { event: "typing" }, (event) => {
        const payload = (event as Record<string, unknown>)["payload"] as { sender_id?: string } | undefined;
        if (payload?.sender_id && payload.sender_id !== userId) {
          setPartnerTyping(true);
          if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => {
            setPartnerTyping(false);
          }, 3000);
        }
      })
      .subscribe();

    const callChannel = supabase
      .channel("care-desk-calls")
      .on("broadcast", { event: "call-offer" }, (event) => {
        const payload = (event as Record<string, unknown>)["payload"] as
          | { callerId: string; callerName: string; sdp: RTCSessionDescriptionInit }
          | undefined;
        if (payload && payload.callerId !== userId) {
          haptic("success");
          setIncomingCall(payload);
        }
      })
      .subscribe();

    callChannelRef.current = callChannel;

    return () => {
      active = false;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(callChannel);
    };
  }, [markAsRead, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, partnerTyping]);

  const broadcastTyping = useCallback(() => {
    void supabase.channel("care-desk-presence").send({
      type: "broadcast",
      event: "typing",
      payload: { sender_id: userId },
    });
  }, [userId]);

  const patch = useCallback((clientId: string, changes: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.client_id === clientId ? { ...m, ...changes } : m)),
    );
  }, []);

  const insert = useCallback(
    async (row: Partial<ChatMessage> & { client_id: string; kind: MessageKind }) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({ ...row, sender_id: userId, sender_email: email } as never)
        .select()
        .single();
      if (error) {
        patch(row.client_id, { pending: false, failed: true });
        return;
      }
      haptic("light");
      setMessages((prev) =>
        prev.map((m) =>
          m.client_id === row.client_id
            ? { ...(data as ChatMessage), localUrl: m.localUrl, pending: false }
            : m,
        ),
      );
      void notifyPartner({
        data: {
          preview: previewFor(row.kind, row.body),
        },
      }).catch(() => {});
    },
    [email, patch, userId],
  );

  const optimistic = (partial: Partial<ChatMessage>, clientId: string): ChatMessage => ({
    id: clientId,
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
    client_id: clientId,
    created_at: new Date().toISOString(),
    pending: true,
    progress: 0,
    ...partial,
  });
  const sendText = (body: string) => {
    const clientId = crypto.randomUUID();
    setMessages((prev) => [...prev, optimistic({ body, kind: "text" }, clientId)]);
    void insert({ client_id: clientId, kind: "text", body });
  };

  const sendBlob = useCallback(
    async (blob: Blob, name: string, kind: MessageKind, durationMs?: number) => {
      const clientId = crypto.randomUUID();
      const localUrl = URL.createObjectURL(blob);
      const safeName = name.replace(/[^\w.\-]+/g, "_");
      const path = `${userId}/${clientId}-${safeName}`;

      setMessages((prev) => [
        ...prev,
        optimistic(
          {
            kind,
            localUrl,
            attachment_path: path,
            attachment_name: name,
            attachment_type: blob.type || null,
            attachment_size: blob.size,
            duration_ms: durationMs ?? null,
          },
          clientId,
        ),
      ]);

      try {
        await uploadRaw(path, blob, blob.type, (fraction) =>
          patch(clientId, { progress: fraction }),
        );
        const url = await signedUrlFor(path);
        await insert({
          client_id: clientId,
          kind,
          attachment_path: path,
          attachment_url: url,
          attachment_name: name,
          attachment_type: blob.type || null,
          attachment_size: blob.size,
          duration_ms: durationMs ?? null,
        });
      } catch {
        patch(clientId, { pending: false, failed: true });
      }
    },
    [insert, patch, userId],
  );

  const sendFiles = (files: File[]) => {
    files.forEach((file) => {
      void sendBlob(file, file.name, kindForFile(file, file.name));
    });
  };

  const sendVoice = (blob: Blob, durationMs: number) => {
    void sendBlob(blob, `voice-note-${Date.now()}.webm`, "audio", durationMs);
  };

  const react = (message: ChatMessage, emoji: string | null) => {
    const next = { ...(message.reactions ?? {}) };
    if (emoji) next[userId] = emoji;
    else delete next[userId];
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, reactions: next } : m)));
    void (supabase as any).from("messages").update({ reactions: next }).eq("id", message.id);
  };

  const handleEnablePush = async () => {
    haptic("medium");
    const status = await enablePush(userId);
    if (status === "enabled") {
      setPushActive(true);
      haptic("success");
    } else if (status === "open-in-new-tab") {
      alert("Please open the app directly in Safari or Chrome to enable lock-screen notifications.");
    } else if (status === "install-first") {
      alert("On iPhone, tap Share then 'Add to Home Screen' first, then open the installed app to turn on notifications.");
    } else if (status === "denied") {
      alert("Notifications are disabled in browser settings. Please permit notifications for Popotso.");
    }
  };

  const startVoiceCall = () => {
    haptic("medium");
    setCalling(true);
  };

  const lastOutgoingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.sender_id === userId && !m.pending && !m.failed) {
        return m.id;
      }
    }
    return null;
  }, [messages, userId]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: ChatMessage[] }[] = [];
    messages.forEach((message) => {
      const label = formatDayLabel(message.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(message);
      else groups.push({ label, items: [message] });
    });
    return groups;
  }, [messages]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="glass hairline-b sticky top-0 z-20 flex items-center gap-2 px-4 pt-[max(0.7rem,env(safe-area-inset-top))] pb-2.5">
        <button
          type="button"
          aria-label="About this system"
          onClick={() => setShowInfo(true)}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
        >
          <Info className="size-5" />
        </button>

        <h1 className="flex-1 text-center text-[17px] font-semibold tracking-tight">
          Popotso Care Desk
        </h1>

        <button
          type="button"
          aria-label="Call (Ultra-Low Data)"
          onClick={startVoiceCall}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
        >
          <Phone className="size-[18px]" />
        </button>

        <button
          type="button"
          aria-label={pushActive ? "Notifications active" : "Enable notifications"}
          onClick={() => void handleEnablePush()}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
        >
          {pushActive ? (
            <BellRing className="size-[18px] text-primary" />
          ) : (
            <Bell className="size-[18px]" />
          )}
        </button>

        <button
          type="button"
          aria-label="Sign out"
          onClick={() => void signOut()}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
        >
          <LogOut className="size-[18px]" />
        </button>
      </header>

      <main className="flex-1 px-3 py-4">
        {grouped.length === 0 && (
          <p className="mt-24 text-center text-[14px] text-muted-foreground">
            This line is empty. Say something.
          </p>
        )}
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5">
          {grouped.map((group) => (
            <div key={group.label} className="flex flex-col gap-1.5">
              <p className="my-3 text-center text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.items.map((message) => {
                const isLast = message.id === lastOutgoingId;
                const receipt = isLast
                  ? message.read_at
                    ? `Read ${formatClock(message.read_at)}`
                    : "Delivered"
                  : null;

                return (
                  <MessageBubble
                    key={message.client_id ?? message.id}
                    message={message}
                    outgoing={message.sender_id === userId}
                    myId={userId}
                    receipt={receipt}
                    onOpen={setLightbox}
                    onReact={react}
                  />
                );
              })}
            </div>
          ))}

          {partnerTyping && (
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-secondary px-4 py-3 w-fit animate-fade-up">
              <span className="size-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.32s]" />
              <span className="size-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.16s]" />
              <span className="size-2 rounded-full bg-muted-foreground/60 animate-bounce" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      <Composer
        onSendText={sendText}
        onSendFiles={sendFiles}
        onSendVoice={sendVoice}
        onTyping={broadcastTyping}
      />

      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />

      {(calling || incomingCall) && callChannelRef.current && (
        <VoiceCallModal
          myId={userId}
          myEmail={email}
          partnerEmail={partnerEmail}
          channel={callChannelRef.current}
          incomingCall={incomingCall}
          onClose={() => {
            setCalling(false);
            setIncomingCall(null);
          }}
        />
      )}

      {showInfo && (
        <div
          className="fixed inset-0 z-40 flex animate-fade-up items-end justify-center bg-foreground/40 p-3 sm:items-center"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">Technical attribution</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowInfo(false)}
                className="flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">{ATTRIBUTION}</p>
          </div>
        </div>
      )}
    </div>
  );
          }
              
