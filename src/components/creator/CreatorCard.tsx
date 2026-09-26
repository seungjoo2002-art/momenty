import Link from "next/link";
import { VerifiedMark } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Photo } from "@/components/ui/Photo";
import type { Creator } from "@/lib/types";
import { formatCount } from "@/lib/utils/format";

/** Discover 타일 — 크리에이터의 사진이 먼저 보인다 */
export function CreatorCard({ creator, todayCount = 0 }: { creator: Creator; todayCount?: number }) {
  return (
    <Link href={`/creators/${creator.id}`} className="pressable block overflow-hidden rounded-card">
      <Photo src={creator.coverUrl} alt={creator.name} className="aspect-[3/4]">
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/70 to-transparent" />
        {todayCount > 0 && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-1 text-micro font-medium text-white backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-brand-2" />
            오늘 {todayCount}
          </span>
        )}
        <div className="absolute inset-x-3 bottom-3 text-white">
          <div className="flex items-center gap-1.5">
            <Avatar src={creator.avatarUrl} name={creator.name} size="xs" className="ring-1 ring-white/70" />
            <span className="truncate text-sub font-semibold">{creator.name}</span>
            {creator.verified && <VerifiedMark className="size-3.5 shrink-0" />}
          </div>
          <p className="mt-1 truncate text-meta text-white/80">{creator.job}</p>
          <p className="text-micro text-white/65">팔로워 {formatCount(creator.followers)}</p>
        </div>
      </Photo>
    </Link>
  );
}
