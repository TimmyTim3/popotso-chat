import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface LightboxItem {
  url: string;
  kind: "image" | "video";
  name?: string | null;
}

interface LightboxProps {
  item: LightboxItem | null;
  onClose: () => void;
  items?: LightboxItem[];
  initialIndex?: number;
}

export function Lightbox({ item, onClose, items = [], initialIndex = 0 }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef<number | null>(null);
  const gallery = items.length ? items : item ? [item] : [];
  const activeItem = gallery[index] ?? item;
  useEffect(() => { setIndex(initialIndex); }, [initialIndex]);
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((current) => Math.min(gallery.length - 1, current + 1));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [item, onClose, gallery.length]);

  if (!activeItem) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-up items-center justify-center bg-foreground/92 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close viewer"
        className="glass absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 flex size-9 items-center justify-center rounded-full"
      >
        <X className="size-4" />
      </button>
      <div className="max-h-full w-full max-w-4xl" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => { touchStartX.current = event.changedTouches[0]?.clientX ?? null; }} onTouchEnd={(event) => { const start = touchStartX.current; touchStartX.current = null; const end = event.changedTouches[0]?.clientX ?? start ?? 0; if (start !== null && Math.abs(end - start) > 45) setIndex((current) => Math.max(0, Math.min(gallery.length - 1, current + (end < start ? 1 : -1)))); }}>
        {activeItem.kind === "image" ? (
          <img
            src={activeItem.url}
            alt={activeItem.name ?? "Shared photo at full resolution"}
            className="mx-auto max-h-[88vh] w-auto rounded-2xl object-contain"
          />
        ) : (
          <video
            src={activeItem.url}
            controls
            autoPlay
            playsInline
            className="mx-auto max-h-[88vh] w-full rounded-2xl bg-black"
          />
        )}
      </div>
      {gallery.length > 1 && <>
        <button type="button" aria-label="Previous photo" disabled={index === 0} onClick={(event) => { event.stopPropagation(); setIndex((current) => Math.max(0, current - 1)); }} className="absolute left-3 top-1/2 z-10 rounded-full bg-white/15 px-3 py-2 text-2xl text-white disabled:opacity-30">‹</button>
        <button type="button" aria-label="Next photo" disabled={index === gallery.length - 1} onClick={(event) => { event.stopPropagation(); setIndex((current) => Math.min(gallery.length - 1, current + 1)); }} className="absolute right-3 top-1/2 z-10 rounded-full bg-white/15 px-3 py-2 text-2xl text-white disabled:opacity-30">›</button>
        <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs text-white">{index + 1} / {gallery.length}</span>
      </>}
    </div>
  );
}
