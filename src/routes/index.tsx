import { createFileRoute } from "@tanstack/react-router";
import { Info, LogOut, X } from "lucide-react";
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
  signedUrlFor,
  uploadRaw,
  type ChatMessage,
  type MessageKind,
} from "@/lib/care-desk";

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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const userId = session.user.id;
  const email = session.user.email ?? "";

  useEffect(() => {
    let active = true;
    void supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (active && data) setMessages(data as ChatMessage[]);
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
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const patch = useCallback((clientId: string, changes: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.client_id === clientId ? { ...m, ...changes } : m)),
    );
  }, []);

  const insert = useCallback(
    async (row: Partial<ChatMessage> & { client_id: string; kind: MessageKind }) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({ ...row, sender_id: userId, sender_email: email })
        .select()
        .single();
      if (error) {
        patch(row.client_id, { pending: false, failed: true });
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.client_id === row.client_id
            ? { ...(data as ChatMessage), localUrl: m.localUrl, pending: false }
            : m,
        ),
      );
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
              {group.items.map((message) => (
                <MessageBubble
                  key={message.client_id ?? message.id}
                  message={message}
                  outgoing={message.sender_id === userId}
                  onOpen={setLightbox}
                />
              ))}
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
