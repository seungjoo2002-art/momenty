"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

/** id로부터 결정적인 파형 높이 생성 (SSR/CSR 동일) — 장식용 */
function bars(seed: string, count: number) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    h = (h * 1103515245 + 12345 + i) >>> 0;
    return 0.25 + ((h >>> 8) % 1000) / 1333;
  });
}

/**
 * 음성 Moment 재생. src(음성 파일)가 있으면 실제로 재생하고 진행 정도를 파형에 칠한다.
 * 파일이 없으면(예전 seed 데이터) 길이만 보여주고 재생 버튼은 비활성.
 */
export function VoicePlayer({
  seed,
  src,
  durationSec,
  size = "md",
  tone = "default",
}: {
  seed: string;
  src?: string;
  durationSec?: number;
  size?: "md" | "lg";
  /** dark: 검은 배경(Moment 상세 · 기록 화면) */
  tone?: "default" | "dark";
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [length, setLength] = useState(durationSec ?? 0);
  const heights = bars(seed, 36);
  const dark = tone === "dark";

  useEffect(() => {
    const el = audio.current;
    return () => el?.pause();
  }, []);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }

  const played = Math.round(progress * heights.length);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-full",
        size === "lg" ? "p-2.5 pr-5" : "p-1.5 pr-4",
        dark ? "bg-white/10" : "bg-brand-tint",
      )}
    >
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setLength(Math.round(d));
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : length;
            if (d) setProgress(Math.min(1, el.currentTime / d));
          }}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        className={cn(
          "pressable grid shrink-0 place-items-center rounded-full disabled:opacity-40",
          size === "lg" ? "size-12" : "size-9",
          dark ? "bg-white text-ink" : "bg-brand text-white",
        )}
        aria-label={src ? (playing ? "일시정지" : "재생") : "재생할 음성 파일이 없어요"}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <div className={cn("flex min-w-0 flex-1 items-center justify-between gap-[2px] overflow-hidden", size === "lg" ? "h-9" : "h-6")}>
        {heights.map((v, i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] shrink-0 rounded-full transition-colors",
              i < played ? (dark ? "bg-white" : "bg-brand") : dark ? "bg-white/45" : "bg-brand/40",
            )}
            style={{ height: `${v * 100}%` }}
          />
        ))}
      </div>
      <span className={cn("shrink-0 text-meta font-medium tabular-nums", dark ? "text-white/80" : "text-brand-deep")}>
        {formatDuration(length)}
      </span>
    </div>
  );
}
