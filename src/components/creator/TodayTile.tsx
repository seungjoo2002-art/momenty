import { Lock, Mic } from "lucide-react";
import Link from "next/link";
import { MomentCount } from "@/components/moment/MomentDots";
import { Avatar } from "@/components/ui/Avatar";
import { Photo } from "@/components/ui/Photo";
import { RelativeTime } from "@/components/ui/RelativeTime";
import type { Creator, Moment, Tier } from "@/lib/types";
import { pickTodayPreview } from "./todayPreview";

/**
 * Today Home의 compact 타일 (2열 그리드).
 * - 볼 수 있는 사진이 있으면 사진 중심
 * - 글·음성만 있으면 작은 텍스트 타일
 * - 모두 구독자 전용이면 커버 위에 잠금 표시
 */
export function TodayTile({ creator, tier, moments }: { creator: Creator; tier: Tier; moments: Moment[] }) {
  const { latest, visual, visible } = pickTodayPreview(moments, tier);
  const href = `/creators/${creator.id}/today`;
  const name = `${creator.name.slice(1)}의 오늘`;

  const footer = (onImage: boolean) => (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Avatar src={creator.avatarUrl} name={creator.name} size="xs" className={onImage ? "ring-1 ring-white/70" : ""} />
        <span className={`truncate text-sub font-semibold ${onImage ? "text-white" : "text-ink"}`}>{name}</span>
      </div>
      <MomentCount count={moments.length} tone={onImage ? "onImage" : "default"} className="mt-1 whitespace-nowrap" />
    </div>
  );

  // 사진 중심
  if (visual || !visible) {
    return (
      <Link href={href} className="pressable block overflow-hidden rounded-card">
        <Photo
          src={visual?.mediaUrl ?? creator.coverUrl}
          alt={visual?.content ?? creator.name}
          className="aspect-[3/4]"
          imgClassName={visual ? undefined : "blur-md scale-110"}
        >
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />
          {visual && latest && (
            <span className="absolute top-2.5 left-2.5 rounded-full bg-black/30 px-2 py-0.5 text-micro font-medium text-white backdrop-blur-md">
              <RelativeTime iso={latest.createdAt} />
            </span>
          )}
          {!visual && (
            <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-micro font-semibold text-ink">
              <Lock className="size-3" />
              구독자 전용 순간
            </span>
          )}
          <div className="absolute inset-x-3 bottom-3">{footer(true)}</div>
        </Photo>
      </Link>
    );
  }

  // 글·음성 Moment만 볼 수 있을 때
  return (
    <Link href={href} className="pressable relative flex aspect-[3/4] flex-col justify-between rounded-card border border-line bg-surface p-3.5">
      {latest && (
        <span className="absolute top-3 right-3.5 text-micro text-faint">
          <RelativeTime iso={latest.createdAt} />
        </span>
      )}
      {visible.type === "voice" ? (
        <div>
          <span className="grid size-9 place-items-center rounded-full bg-brand-tint text-brand">
            <Mic className="size-4" />
          </span>
          <p className="mt-2.5 line-clamp-4 text-sub text-ink">{visible.content}</p>
        </div>
      ) : (
        <p className="line-clamp-6 pt-5 text-sub leading-relaxed text-ink">“{visible.content}”</p>
      )}
      {footer(false)}
    </Link>
  );
}
