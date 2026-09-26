import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { VerifiedMark } from "@/components/badges";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { Photo } from "@/components/ui/Photo";
import { RelativeTime } from "@/components/ui/RelativeTime";
import type { Creator, Moment, Tier } from "@/lib/types";
import { isMomentLocked } from "@/lib/utils/access";
import { pickTodayPreview } from "./todayPreview";

/** Today Home 맨 위: 가장 최근 크리에이터의 오늘을 사진 중심으로 크게 */
export function TodayHero({ creator, tier, moments }: { creator: Creator; tier: Tier; moments: Moment[] }) {
  const { latest, visual } = pickTodayPreview(moments, tier);
  const href = `/creators/${creator.id}/today`;
  const thumbs = [...moments].reverse().slice(0, 3);

  return (
    <Link href={href} className="pressable block overflow-hidden rounded-[24px]">
      <Photo src={visual?.mediaUrl ?? creator.coverUrl} alt={visual?.content ?? creator.name} className="aspect-[4/5]">
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent via-40% to-black/75" />

        {latest && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-meta font-medium text-white backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-brand-2" />
            <RelativeTime iso={latest.createdAt} />
          </span>
        )}

        <div className="absolute inset-x-4 bottom-4 text-white">
          <div className="flex items-center gap-2">
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" className="ring-2 ring-white/80" />
            <span className="text-section font-semibold">{creator.name.slice(1)}의 오늘</span>
            {creator.verified && <VerifiedMark className="size-4" />}
          </div>
          <p className="mt-1 text-caption text-white/80">{moments.length}개의 순간이 기록됐어요</p>

          <div className="mt-3 flex items-center gap-2">
            {thumbs.map((m) => (
              <MomentMedia
                key={m.id}
                moment={m}
                variant="thumb"
                locked={isMomentLocked(m, tier)}
                className="size-11 ring-1 ring-white/40"
              />
            ))}
            <span className="grid size-11 place-items-center rounded-[12px] bg-white/20 backdrop-blur-md">
              <ChevronRight className="size-5" />
            </span>
          </div>
        </div>
      </Photo>
    </Link>
  );
}
