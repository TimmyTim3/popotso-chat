import { ArrowUp, Mic, Plus, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatDuration, pickAudioMime } from "@/lib/care-desk";
import { cn } from "@/lib/utils";

interface ComposerProps {
  onSendText: (text: string) => void;
  onSendFiles: (files: File[]) => void;
  onSendVoice: (blob: Blob, durationMs: number) => void;
  onTyping?: () => void;
  /** When set, the box edits this message instead of sending a new one. */
  editing?: { id: string; text: string } | null;
  onSaveEdit?: (id: string, text: string) => void;
  onCancelEdit?: () => void;
  replying?: { sender: string; text: string } | null;
  onCancelReply?: () => void;
}

export function Composer({
  onSendText,
  onSendFiles,
  onSendVoice,
  onTyping,
  editing,
  onSaveEdit,
  onCancelEdit,
  replying,
  onCancelReply,
}: ComposerProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (editing) {
      setText(editing.text);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [editing]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const cleanupAudio = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        alert("Voice notes aren't supported in this browser. Please open the app in Chrome or Safari.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mime = pickAudioMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        cleanupAudio();
        setRecording(false);
        setLevels([]);
        setElapsed(0);
        if (!cancelledRef.current && blob.size > 0 && duration > 400) {
          onSendVoice(blob, duration);
        }
      };

      // Start recording first so the waveform can never block a voice note.
      recorder.start(250);
      setRecording(true);

      let analyser: AnalyserNode | null = null;
      let data: Uint8Array<ArrayBuffer> | null = null;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const context = new Ctx();
        void context.resume();
        audioCtxRef.current = context;
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        analyser = null;
      }

      const tick = () => {
        let level = 0.3 + Math.random() * 0.3;
        if (analyser && data) {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i]! * data[i]!;
          level = Math.min(1, Math.sqrt(sum / data.length) / 90);
        }
        setLevels((prev) => [...prev.slice(-45), Math.max(0.08, level)]);
        setElapsed(Date.now() - startedAtRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      setRecording(false);
      const name = (err as { name?: string })?.name;
      alert(
        name === "NotAllowedError"
          ? "Microphone is blocked. Tap the lock icon next to the web address → Permissions → Microphone → Allow, then try again."
          : "Couldn't start the microphone. Close other apps using it and try again.",
      );
    }
  };

  const stopRecording = (cancel: boolean) => {
    cancelledRef.current = cancel;
    recorderRef.current?.stop();
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    if (editing) {
      onSaveEdit?.(editing.id, value);
      return;
    }
    onSendText(value);
  };

  return (
    <div className="glass hairline-t sticky bottom-0 z-20 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
      {recording ? (
        <div className="flex items-center gap-3 rounded-full bg-secondary px-3 py-2">
          <button
            type="button"
            aria-label="Discard recording"
            onClick={() => stopRecording(true)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-destructive transition-transform active:scale-90"
          >
            <Trash2 className="size-5" />
          </button>
          <div className="flex h-8 flex-1 items-center justify-end gap-[2px] overflow-hidden">
            {levels.map((level, index) => (
              <span
                key={index}
                style={{ height: `${Math.round(level * 100)}%` }}
                className="w-[3px] shrink-0 rounded-full bg-primary"
              />
            ))}
          </div>
          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
            {formatDuration(elapsed)}
          </span>
          <button
            type="button"
            aria-label="Send voice note"
            onClick={() => stopRecording(false)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-90"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        </div>
      ) : (
        <>
        {replying && !editing && (
          <div className="mb-2 flex items-center justify-between rounded-2xl border-l-[3px] border-primary bg-secondary px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate text-muted-foreground"><span className="font-semibold text-primary">Replying to {replying.sender}</span> · {replying.text}</span>
            <button type="button" aria-label="Cancel reply" onClick={onCancelReply} className="ml-2 shrink-0 font-medium text-primary">Cancel</button>
          </div>
        )}
        {editing && (
          <div className="mb-2 flex items-center justify-between rounded-2xl bg-secondary px-3 py-1.5 text-[13px]">
            <span className="truncate text-muted-foreground">
              <span className="font-semibold text-primary">Editing message</span> · {editing.text}
            </span>
            <button
              type="button"
              aria-label="Cancel editing"
              onClick={() => {
                setText("");
                onCancelEdit?.();
              }}
              className="ml-2 shrink-0 font-medium text-primary"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) onSendFiles(files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach files"
            onClick={() => fileRef.current?.click()}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform active:scale-90"
          >
            <Plus className="size-5" />
          </button>

          <div className="flex flex-1 items-end rounded-[1.35rem] border border-border bg-card px-3.5 py-1.5">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              placeholder="Message"
              onChange={(event) => {
                setText(event.target.value);
                onTyping?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="no-scrollbar max-h-[132px] w-full resize-none bg-transparent py-1 text-[16.5px] leading-snug outline-none placeholder:text-muted-foreground"
            />
          </div>

          <button
            type="button"
            aria-label={text.trim() ? "Send message" : "Record voice note"}
            onClick={() => (text.trim() ? send() : void startRecording())}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:scale-90",
              text.trim()
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground",
            )}
          >
            {text.trim() ? <ArrowUp className="size-5" /> : <Mic className="size-5" />}
          </button>
        </div>
        </>
      )}
    </div>
  );
          }
