import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import type { Creator } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

/** 상단 가로 스크롤: 팔로우·구독 중인 크리에이터. 오늘 새 Moment가 있으면 보라 링. */
export function CreatorStoryRow({ items }: { items: { creator: Creator; count: number }[] }) {
  return (
    <div className="no-scrollbar flex gap-3.5 overflow-x-auto px-5 py-1">
      {items.map(({ creator, count }) => (
        <Link
          key={creator.id}
          href={`/creators/${creator.id}/today`}
          className="pressable flex w-[60px] shrink-0 flex-col items-center"
          aria-label={`${creator.name}의 오늘${count ? ` · Moment ${count}개` : ""}`}
        >
          <Avatar src={creator.avatarUrl} name={creator.name} size="lg" ring={count ? "today" : "seen"} />
          <span className={cn("mt-1.5 w-full truncate text-center text-meta", count ? "text-ink" : "text-muted")}>
            {creator.name.slice(1)}
          </span>
        </Link>
      ))}
    </div>
  );
}
