interface ProgressRingProps {
  progress: number;
  size?: number;
}

export function ProgressRing({ progress, size = 52 }: ProgressRingProps) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-foreground/25 backdrop-blur-[2px]">
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
      <span className="absolute text-[11px] font-semibold tabular-nums text-background">
        {Math.round(clamped * 100)}%
      </span>
    </div>
  );
}
