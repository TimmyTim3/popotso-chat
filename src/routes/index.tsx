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
  type MemberEmail,
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
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (dark: boolean) => {
      root.classList.toggle("dark", dark);
    };
    apply(media.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);
}

function Index() {
  useSystemTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground text-[15px]">
        Loading Popotso…
      </div>
    );
  }

  if (!session) return <AuthScreen />;
  return <ChatRoom session={session} />;
}

function ChatRoom({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lightboxItem, setLightboxItem] = useState<LightboxItem | null>(null);
  const [showAttribution, setShowAttribution] = useState(false);
  const [pushActive, setPushActive] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [inCall, setInCall] = useState(false);
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
  const partnerEmail: MemberEmail =
    email === "tim@popotso.app" ? "nicky@popotso.app" : "tim@popotso.app";

  const markAsRead = useCallback(async () => {
    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      .then(async ({ data, error }) => {
        if (!active || error || !data) return;
        const resolved = await Promise.all(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.map(async (row: any) => {
            const m = row as ChatMessage;
            if (m.attachment_path && !m.attachment_url) {
              try {
                m.attachment_url = await signedUrlFor(m.attachment_path);
              } catch (e) {
                console.error("Failed to sign URL", e);
              }
            }
            return m;
          }),
        );
        if (active) {
          setMessages(resolved);
          void markAsRead();
        }
      });

    const channel = supabase
      .channel("care-desk-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (payload: any) => {
          const row = payload.new as ChatMessage;
          if (row.attachment_path && !row.attachment_url) {
            try {
              row.attachment_url = await signedUrlFor(row.attachment_path);
            } catch (e) {
              console.error(e);
            }
          }
          setMessages((prev) => {
            const idx = row.client_id ? prev.findIndex((m) => m.client_id === row.client_id) : -1;
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
          if (row.sender_id !== userId) {
            haptic("tap");
            void markAsRead();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const updated = payload.new as ChatMessage;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id ? { ...m, reactions: updated.reactions, read_at: updated.read_at } : m,
            ),
          );
        },
      )
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload?.senderId !== userId) {
          setPartnerTyping(true);
          if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setPartnerTyping(false), 2500);
        }
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [markAsRead, userId]);

  useEffect(() => {
    const callChan = supabase.channel("care-desk-call-signaling", {
      config: { broadcast: { self: false } },
    });
    callChan
      .on("broadcast", { event: "offer" }, ({ payload }) => {
        if (payload?.targetEmail === email && payload?.sdp) {
          haptic("notification");
          setIncomingCall({
            callerId: payload.callerId,
            callerName: payload.callerName,
            sdp: payload.sdp,
          });
          setInCall(true);
        }
      })
      .subscribe();

    callChannelRef.current = callChan;
    return () => {
      void supabase.removeChannel(callChan);
    };
  }, [email]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, partnerTyping]);

  const patch = useCallback((clientId: string, delta: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.client_id === clientId ? { ...m, ...delta } : m)));
  }, []);

  const insert = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (row: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("messages")
        .insert({
          ...row,
          sender_id: userId,
          sender_email: email,
        })
        .select()
        .single();
      if (error) {
        console.error("Message send failed:", error);
        if (row.client_id) patch(row.client_id, { failed: true, pending: false });
        return;
      }
      if (row.client_id) patch(row.client_id, { id: data.id, pending: false });
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
            attachment_type: blob.type,
            attachment_size: blob.size,
            duration_ms: durationMs ?? null,
            progress: 0,
          },
          clientId,
        ),
      ]);

      try {
        await uploadRaw(path, blob, blob.type, (fraction) => {
          patch(clientId, { progress: fraction });
        });
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
      } catch (e) {
        console.error("Upload failed", e);
        patch(clientId, { failed: true, pending: false });
      }
    },
    [insert, optimistic, patch, userId],
  );

  const sendFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const kind = kindForFile(file, file.name);
      void sendBlob(file, file.name, kind);
    });
  };

  const sendVoice = (blob: Blob, durationMs: number) => {
    void sendBlob(blob, `voice-${Date.now()}.webm`, "audio", durationMs);
  };

  const react = async (messageId: string, emoji: string) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const current = { ...(target.reactions ?? {}) };
    if (current[userId] === emoji) delete current[userId];
    else current[userId] = emoji;

    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: current } : m)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("messages").update({ reactions: current }).eq("id", messageId);
  };

  const enableNotifications = async () => {
    const res = await enablePush();
    if (res.state === "subscribed") {
      setPushActive(true);
      haptic("success");
    } else {
      alert(`Notification status: ${res.state}`);
    }
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
      if (m && m.sender_id === userId && !m.pending && !m.failed) return i;
    }
    return -1;
  }, [messages, userId]);

  const lastOutgoingMessage = lastOutgoingIndex >= 0 ? messages[lastOutgoingIndex] : null;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* iOS 18 Header Bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAttribution(true)}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
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
          {/* Audio Call Button */}
          <button
            type="button"
            onClick={() => {
              haptic("tap");
              setIncomingCall(null);
              setInCall(true);
            }}
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary active:scale-95"
            aria-label="Call Nicky"
            title="Start low-data audio call"
          >
            <Phone className="size-4 text-primary" />
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

            <div className="flex flex-col gap-2">
              {group.items.map((msg) => {
                const isMine = msg.sender_id === userId;
                const isLatest = lastOutgoingMessage?.id === msg.id;
                let receipt: string | null = null;
                if (isMine && isLatest) {
                  receipt = msg.read_at ? `Read ${formatClock(msg.read_at)}` : "Delivered";
                }

                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isMine={isMine}
                    outgoing={isMine}
                    myId={userId}
                    receipt={receipt}
                    onOpenLightbox={(item) => setLightboxItem(item)}
                    onOpen={(item) => setLightboxItem(item)}
                    onReact={react}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {partnerTyping && (
          <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.2s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.4s]" />
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Message Composer */}
      <footer className="sticky bottom-0 border-t border-border/60 bg-background/80 p-2 backdrop-blur-md">
        <Composer
          onSendText={sendText}
          onSendFiles={sendFiles}
          onSendVoice={sendVoice}
          onTyping={() => {
            const chan = supabase.channel("care-desk-realtime");
            void chan.send({
              type: "broadcast",
              event: "typing",
              payload: { senderId: userId },
            });
          }}
        />
      </footer>

      {/* Lightbox */}
      {lightboxItem && (
        <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}

      {/* Low-Data Voice Call Modal */}
      {inCall && callChannelRef.current && (
        <VoiceCallModal
          myId={userId}
          myEmail={email}
          partnerEmail={partnerEmail}
          channel={callChannelRef.current}
          incomingCall={incomingCall}
          onClose={() => {
            setInCall(false);
            setIncomingCall(null);
          }}
        />
      )}

      {/* Attribution Drawer */}
      {showAttribution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="max-w-md rounded-3xl bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">About Popotso Care Desk</h2>
              <button
                type="button"
                onClick={() => setShowAttribution(false)}
                className="flex size-7 items-center justify-center rounded-full bg-secondary text-muted-foreground"
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
