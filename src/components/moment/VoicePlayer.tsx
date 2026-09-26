"use client";

import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

/** id로부터 결정적인 파형 높이 생성 (SSR/CSR 동일) */
function bars(seed: string, count: number) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    h = (h * 1103515245 + 12345 + i) >>> 0;
    return 0.25 + ((h >>> 8) % 1000) / 1333;
  });
}

export function VoicePlayer({
  seed,
  durationSec = 30,
  size = "md",
  tone = "default",
}: {
  seed: string;
  durationSec?: number;
  size?: "md" | "lg";
  /** dark: 검은 배경(Moment 상세) */
  tone?: "default" | "dark";
}) {
  const [playing, setPlaying] = useState(false);
  const heights = bars(seed, 36);
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-full",
        size === "lg" ? "p-2.5 pr-5" : "p-1.5 pr-4",
        dark ? "bg-white/10" : "bg-brand-tint",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setPlaying(!playing);
        }}
        className={cn(
          "pressable grid shrink-0 place-items-center rounded-full",
          size === "lg" ? "size-12" : "size-9",
          dark ? "bg-white text-ink" : "bg-brand text-white",
        )}
        aria-label={playing ? "일시정지" : "재생"}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <div className={cn("flex min-w-0 flex-1 items-center justify-between gap-[2px] overflow-hidden", size === "lg" ? "h-9" : "h-6")}>
        {heights.map((v, i) => (
          <span
            key={i}
            className={cn("w-[2px] shrink-0 rounded-full", dark ? "bg-white/60" : "bg-brand/50", playing && "animate-wave")}
            style={{ height: `${v * 100}%`, animationDelay: `${(i % 7) * 0.09}s` }}
          />
        ))}
      </div>
      <span className={cn("shrink-0 text-meta font-medium tabular-nums", dark ? "text-white/80" : "text-brand-deep")}>
        {formatDuration(durationSec)}
      </span>
    </div>
  );
}
