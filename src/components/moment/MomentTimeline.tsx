import type { Moment, Tier } from "@/lib/types";
import { canChat, isMomentLocked } from "@/lib/utils/access";
import { cn } from "@/lib/utils/cn";
import { formatClock } from "@/lib/utils/format";
import { MomentCard } from "./MomentCard";
import { MOMENT_TYPE_META } from "./meta";

interface MomentTimelineProps {
  moments: Moment[];
  /** 팬의 구독 등급 */
  tier?: Tier;
  /** 크리에이터 본인 화면 */
  isOwner?: boolean;
  /** 오늘이면 마지막에 '하루는 아직 이어지는 중' 표시 */
  ongoing?: boolean;
  endNote?: string;
}

/**
 * MOMENTY의 핵심 UI: 실제로 기록된 Moment만 이어지는 세로 Timeline.
 * - 시간 슬롯이 없다. Moment가 1개면 1개, 10개면 10개.
 * - 간격은 실제 시간 차이와 무관하게 일정하다 → 비어 있는 시간이 드러나지 않는다.
 * - 선은 아주 얇은 라벤더, dot만 보라. 카드 없이 한 페이지처럼 이어진다.
 */
export function MomentTimeline({ moments, tier, isOwner, ongoing = true, endNote }: MomentTimelineProps) {
  const lastIndex = moments.length - 1;
  const chat = canChat(tier);

  return (
    <ol>
      {moments.map((m, i) => {
        const locked = !isOwner && isMomentLocked(m, tier);
        const isLatest = i === lastIndex;
        return (
          <li key={m.id} className="relative pb-7 pl-6">
            {(!isLatest || ongoing) && (
              <span aria-hidden className="absolute top-4 bottom-0 left-[4px] w-px bg-brand-2/35" />
            )}
            <span
              aria-hidden
              className={cn(
                "absolute top-[6px] left-0 size-[9px] rounded-full bg-brand",
                isLatest && ongoing && "ring-[3px] ring-brand/15",
              )}
            />
            <div className="flex items-baseline gap-2">
              <time dateTime={m.createdAt} className="text-caption font-semibold tabular-nums">
                {formatClock(m.createdAt)}
              </time>
              <span className="text-meta text-muted">{MOMENT_TYPE_META[m.type].label}</span>
            </div>
            <div className="mt-2">
              <MomentCard moment={m} locked={locked} mode={isOwner ? "owner" : "fan"} canChat={chat} />
            </div>
          </li>
        );
      })}

      {ongoing && (
        <li className="relative pl-6">
          <span aria-hidden className="absolute top-[5px] left-0 size-[9px] rounded-full border border-dashed border-brand-2" />
          <p className="text-meta text-muted">하루는 아직 이어지는 중이에요</p>
          {endNote && <p className="mt-0.5 text-meta text-faint">{endNote}</p>}
        </li>
      )}
    </ol>
  );
}
