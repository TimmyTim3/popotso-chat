import { X } from "lucide-react";

interface ProgressRingProps {
  progress: number;
  size?: number;
  onCancel?: () => void;
}

export function ProgressRing({ progress, size = 52, onCancel }: ProgressRingProps) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[inherit] bg-foreground/35 backdrop-blur-[2px]">
      <div className="relative flex items-center justify-center">
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-background/40"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped)}
            className="text-background transition-[stroke-dashoffset] duration-200 ease-out"
          />
        </svg>

        {onCancel ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            aria-label="Cancel sending image"
            title="Cancel sending"
            className="group absolute flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition active:scale-90"
          >
            <X className="size-4 text-foreground transition-transform group-hover:scale-110" />
          </button>
        ) : (
          <span className="absolute text-[11px] font-semibold tabular-nums text-background">
            {Math.round(clamped * 100)}%
          </span>
        )}
      </div>

      {onCancel && (
        <span className="mt-1 text-[10px] font-semibold tracking-wide text-background drop-shadow-sm">
          {Math.round(clamped * 100)}% • Tap ✕ to cancel
        </span>
      )}
    </div>
  );
            }
