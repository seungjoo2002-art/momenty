import type { Moment, Tier } from "@/lib/types";
import { isMomentLocked } from "@/lib/utils/access";

export interface TodayPreview {
  /** 가장 최근 Moment (잠겨 있어도) — "n분 전" 기준 */
  latest?: Moment;
  /** 팬이 볼 수 있는 가장 최근 사진·영상 */
  visual?: Moment;
  /** 팬이 볼 수 있는 가장 최근 Moment */
  visible?: Moment;
}

/** Today Home에서 크리에이터 한 명을 무엇으로 보여줄지 고른다. 잠긴 상자만 가득한 홈이 되지 않도록. */
export function pickTodayPreview(moments: Moment[], tier: Tier | undefined): TodayPreview {
  const recentFirst = [...moments].reverse();
  const visibleList = recentFirst.filter((m) => !isMomentLocked(m, tier));
  return {
    latest: recentFirst[0],
    visual: visibleList.find((m) => m.type === "photo" || m.type === "video"),
    visible: visibleList[0],
  };
}
