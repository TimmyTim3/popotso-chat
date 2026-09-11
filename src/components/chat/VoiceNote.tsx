import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatDuration } from "@/lib/care-desk";
import { cn } from "@/lib/utils";

interface VoiceNoteProps {
  src: string;
  durationMs?: number | null;
  outgoing: boolean;
  seed: string;
}

const BAR_COUNT = 34;

function bars(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    hash = (hash * 1103515245 + 12345) % 2147483648;
    const base = (hash / 2147483648) * 0.75 + 0.25;
    const envelope = Math.sin((i / BAR_COUNT) * Math.PI) * 0.5 + 0.5;
    return Math.max(0.18, base * envelope);
  });
}

export function VoiceNote({ src, durationMs, outgoing, seed }: VoiceNoteProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const heights = useMemo(() => bars(seed), [seed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setElapsed(audio.currentTime * 1000);
      if (audio.duration && Number.isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      setElapsed(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  };

  return (
    <div className="flex min-w-[210px] items-center gap-3">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90",
          outgoing ? "bg-bubble-out-foreground/22" : "bg-foreground/8",
        )}
      >
        {playing ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <div onClick={seek} className="flex h-8 cursor-pointer items-center gap-[3px]">
          {heights.map((height, index) => {
            const active = index / BAR_COUNT <= progress;
            return (
              <span
                key={index}
                style={{ height: `${height * 100}%` }}
                className={cn(
                  "w-[3px] flex-1 rounded-full transition-opacity duration-150",
                  outgoing ? "bg-bubble-out-foreground" : "bg-foreground",
                  active ? "opacity-100" : "opacity-35",
                )}
              />
            );
          })}
        </div>
        <span className="text-[11px] tabular-nums opacity-65">
          {formatDuration(playing || elapsed > 0 ? elapsed : durationMs)}
        </span>
      </div>
    </div>
  );
}
