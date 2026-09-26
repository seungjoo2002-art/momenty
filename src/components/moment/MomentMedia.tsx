import { Lock, Mic, Play } from "lucide-react";
import { Photo } from "@/components/ui/Photo";
import type { Moment } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";
import { VoicePlayer } from "./VoicePlayer";

/**
 * thumb: 정사각 썸네일
 * card: Timeline 안 (4:3)
 * portrait: 세로 타일 (3:4)
 * full: 상세 — 화면을 가득 채우는 4:5
 */
type Variant = "thumb" | "card" | "portrait" | "full";

interface MomentMediaProps {
  moment: Moment;
  variant?: Variant;
  locked?: boolean;
  /** 검은 배경 위 (Moment 상세) */
  dark?: boolean;
  className?: string;
}

const ASPECT: Record<Variant, string> = {
  thumb: "aspect-square",
  card: "aspect-[4/3]",
  portrait: "aspect-[3/4]",
  full: "aspect-[4/5]",
};

const RADIUS: Record<Variant, string> = {
  thumb: "rounded-[12px]",
  card: "rounded-[18px]",
  portrait: "rounded-card",
  full: "",
};

/** Moment 유형(사진/영상/음성/텍스트)별 콘텐츠. 잠긴 Moment는 흐리게 가린다. */
export function MomentMedia({ moment, variant = "card", locked, dark, className }: MomentMediaProps) {
  if (locked) return <LockedMedia moment={moment} variant={variant} className={className} />;

  const small = variant === "thumb";

  switch (moment.type) {
    case "photo":
      return <Photo src={moment.mediaUrl} alt={moment.content} className={cn(ASPECT[variant], RADIUS[variant], className)} />;

    case "video":
      return (
        <Photo src={moment.mediaUrl} alt={moment.content} className={cn(ASPECT[variant], RADIUS[variant], className)}>
          <div
            className={cn(
              "absolute grid place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm",
              small ? "top-1.5 right-1.5 size-5" : "inset-0 m-auto size-12",
            )}
          >
            <Play className={cn("fill-white", small ? "ml-px size-2.5" : "ml-0.5 size-5")} />
          </div>
          {moment.durationSec && !small && (
            <span className="absolute right-2.5 bottom-2.5 rounded-full bg-black/45 px-1.5 py-0.5 text-micro font-medium text-white tabular-nums">
              {formatDuration(moment.durationSec)}
            </span>
          )}
        </Photo>
      );

    case "voice":
      if (small) {
        return (
          <div className={cn("grid place-items-center bg-brand-tint", ASPECT.thumb, RADIUS.thumb, className)}>
            <Mic className="size-4 text-brand" />
          </div>
        );
      }
      return (
        <div className={className}>
          <VoicePlayer seed={moment.id} durationSec={moment.durationSec} size={variant === "full" ? "lg" : "md"} tone={dark ? "dark" : "default"} />
        </div>
      );

    case "text":
      if (small) {
        return (
          <div
            title={moment.content}
            className={cn("grid place-items-center bg-surface ring-1 ring-line ring-inset", ASPECT.thumb, RADIUS.thumb, className)}
          >
            <span className="font-serif text-[26px] leading-none text-brand-2" aria-hidden>
              &ldquo;
            </span>
          </div>
        );
      }
      return null; // 텍스트 Moment는 본문이 곧 콘텐츠 (MomentCard에서 렌더링)
  }
}

function LockedMedia({ moment, variant, className }: { moment: Moment; variant: Variant; className?: string }) {
  const label = moment.visibility === "premium" ? "Premium" : "구독자";
  const isVisual = moment.type === "photo" || moment.type === "video";
  const aspect = isVisual || variant === "thumb" ? ASPECT[variant] : "aspect-[3/1]";

  return (
    <Photo
      src={isVisual ? moment.mediaUrl : undefined}
      alt=""
      className={cn(aspect, RADIUS[variant] || "rounded-none", className)}
      imgClassName="blur-2xl scale-125"
    >
      <div className="absolute inset-0 grid place-items-center">
        {variant === "thumb" ? (
          <span className="grid size-6 place-items-center rounded-full bg-white/90 text-ink">
            <Lock className="size-3" />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/92 px-3 py-1.5 text-meta font-semibold text-ink">
            <Lock className="size-3" />
            {label} 전용 Moment
          </span>
        )}
      </div>
    </Photo>
  );
}
