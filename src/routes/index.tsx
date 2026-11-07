import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellOff, Info, LogOut, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { AuthScreen } from "@/components/chat/AuthScreen";
import { Composer } from "@/components/chat/Composer";
import { Lightbox, type LightboxItem } from "@/components/chat/Lightbox";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { supabase } from "@/integrations/supabase/client";
import {
  ATTRIBUTION,
  formatDayLabel,
  kindForFile,
  previewFor,
  signedUrlFor,
  uploadRaw,
  type ChatMessage,
  type MessageKind,
} from "@/lib/care-desk";
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

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={() => void 0} />;
  }

  return <ChatRoom session={session} />;
}

function ChatRoom({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userId = session.user.id;
  const email = session.user.email ?? "";

  useEffect(() => {
    void currentPushEnabled().then(setPushOn);
  }, []);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(300);
      if (!active || !data) return;

      const hydrated = await Promise.all(
        data.map(async (row) => {
          if (row.attachment_path && !row.attachment_url) {
            const signed = await signedUrlFor(row.attachment_path);
            return { ...(row as ChatMessage), attachment_url: signed };
          }
          return row as ChatMessage;
        }),
      );
      if (active) {
        setMessages(hydrated);
        setTimeout(() => scrollToBottom(false), 80);

        const unread = hydrated.filter((m) => m.sender_id !== userId && !m.read_at);
        unread.forEach((m) => {
          void supabase
            .from("messages")
            .update({ read_at: new Date().toISOString() } as never)
            .eq("id", m.id);
        });
      }
    })();

    const channel = supabase
      .channel("public:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row = payload.new as ChatMessage;
          if (row.sender_id === userId) return;

          let full = row;
          if (row.attachment_path && !row.attachment_url) {
            const signed = await signedUrlFor(row.attachment_path);
            full = { ...row, attachment_url: signed };
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === full.id)) return prev;
            return [...prev, full];
          });
          scrollToBottom(true);

          void supabase
            .from("messages")
            .update({ read_at: new Date().toISOString() } as never)
            .eq("id", full.id);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const updated = payload.new as ChatMessage;
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);
      const insertMessage = useCallback(
    async (row: Partial<ChatMessage> & { client_id: string; kind: MessageKind }) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({ ...row, sender_id: userId, sender_email: email } as never)
        .select()
        .single();
      if (error) {
        setMessages((prev) =>
          prev.map((m) => (m.client_id === row.client_id ? { ...m, failed: true, pending: false } : m)),
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.client_id === row.client_id ? { ...(data as ChatMessage), pending: false } : m)),
      );
      void notifyPartner({ data: { preview: previewFor(row.kind, row.body) } });
    },
    [userId, email],
  );

  const optimistic = (base: Partial<ChatMessage> & { kind: MessageKind }): ChatMessage => {
    const client_id = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const msg: ChatMessage = {
      id: client_id,
      sender_id: userId,
      sender_email: email,
      body: base.body ?? null,
      kind: base.kind,
      attachment_path: base.attachment_path ?? null,
      attachment_url: base.attachment_url ?? null,
      attachment_name: base.attachment_name ?? null,
      attachment_type: base.attachment_type ?? null,
      attachment_size: base.attachment_size ?? null,
      duration_ms: base.duration_ms ?? null,
      client_id,
      created_at: new Date().toISOString(),
      pending: true,
      progress: base.progress ?? 0,
      localUrl: base.localUrl,
    };
    setMessages((prev) => [...prev, msg]);
    scrollToBottom(true);
    return msg;
  };

  const sendText = (body: string) => {
    const opt = optimistic({ kind: "text", body });
    void insertMessage({ client_id: opt.client_id!, kind: "text", body });
  };

  const sendBlob = async (
    blob: Blob | File,
    name: string,
    kind: MessageKind,
    durationMs?: number,
  ) => {
    const localUrl = URL.createObjectURL(blob);
    const opt = optimistic({
      kind,
      attachment_name: name,
      attachment_type: blob.type || "application/octet-stream",
      attachment_size: blob.size,
      duration_ms: durationMs ?? null,
      localUrl,
      progress: 5,
    });

    try {
      const ext = name.includes(".") ? name.split(".").pop() : "";
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;
      await uploadRaw(blob, path, (progress) => {
        setMessages((prev) =>
          prev.map((m) => (m.client_id === opt.client_id ? { ...m, progress } : m)),
        );
      });
      const signed = await signedUrlFor(path);
      await insertMessage({
        client_id: opt.client_id!,
        kind,
        attachment_path: path,
        attachment_url: signed,
        attachment_name: name,
        attachment_type: blob.type || "application/octet-stream",
        attachment_size: blob.size,
        duration_ms: durationMs ?? null,
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.client_id === opt.client_id ? { ...m, failed: true, pending: false } : m)),
      );
    }
  };

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
    void supabase.from("messages").update({ reactions: next } as never).eq("id", message.id);
  };

  const togglePush = async () => {
    const status = await enablePush(userId);
    setPushOn(status === "enabled");
  };

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

  const lastOutgoingIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.sender_id === userId) return i;
    }
    return -1;
  }, [messages, userId]);

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
        <button
          type="button"
          aria-label={pushOn ? "Notifications enabled" : "Enable notifications"}
          onClick={() => void togglePush()}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
        >
          {pushOn ? <Bell className="size-[18px] text-primary" /> : <BellOff className="size-[18px]" />}
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold tracking-tight">
          Popotso Care Desk
        </h1>
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
                const isLastOutgoing =
                  lastOutgoingIndex >= 0 && messages[lastOutgoingIndex]?.id === message.id;
                const outgoing = message.sender_id === userId;
                const receipt =
                  outgoing && isLastOutgoing
                    ? message.read_at
                      ? "Read"
                      : "Delivered"
                    : null;
                return (
                  <MessageBubble
                    key={message.client_id ?? message.id}
                    message={message}
                    outgoing={outgoing}
                    myId={userId}
                    receipt={receipt}
                    onOpen={setLightbox}
                    onReact={react}
                  />
                );
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      <Composer onSendText={sendText} onSendFiles={sendFiles} onSendVoice={sendVoice} />

      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />

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
