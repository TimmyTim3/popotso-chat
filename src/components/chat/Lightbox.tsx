import { X } from "lucide-react";
import { useEffect } from "react";

export interface LightboxItem {
  url: string;
  kind: "image" | "video";
  name?: string | null;
}

interface LightboxProps {
  item: LightboxItem | null;
  onClose: () => void;
}

export function Lightbox({ item, onClose }: LightboxProps) {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [item, onClose]);

  if (!item) return null;

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
      <div className="max-h-full w-full max-w-4xl" onClick={(event) => event.stopPropagation()}>
        {item.kind === "image" ? (
          <img
            src={item.url}
            alt={item.name ?? "Shared photo at full resolution"}
            className="mx-auto max-h-[88vh] w-auto rounded-2xl object-contain"
          />
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            className="mx-auto max-h-[88vh] w-full rounded-2xl bg-black"
          />
        )}
      </div>
    </div>
  );
}
