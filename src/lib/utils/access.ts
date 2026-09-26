import type { FanUser, Moment, Reactions, Tier, Visibility } from "@/lib/types";

/**
 * 공개범위 판단은 전부 이 파일에서 한다. 컴포넌트에 조건문을 복사하지 않는다.
 * Supabase 연결 시 같은 규칙을 RLS 정책으로 옮긴다 (클라이언트 판단은 표시용).
 */

const RANK: Record<Tier | "none", number> = { none: 0, follow: 1, subscriber: 2, premium: 3 };
const REQUIRED: Record<Visibility, number> = { public: 0, subscribers: 2, premium: 3 };

/** 팬이 해당 크리에이터를 어떤 등급으로 구독 중인지 (없으면 undefined) */
export function tierFor(fan: FanUser | undefined, creatorId: string): Tier | undefined {
  return fan?.subscriptions.find((s) => s.creatorId === creatorId)?.tier;
}

/** 팬의 구독 등급으로 해당 공개범위의 Moment를 볼 수 있는지 */
export function canView(visibility: Visibility, tier: Tier | undefined): boolean {
  return RANK[tier ?? "none"] >= REQUIRED[visibility];
}

/**
 * 이 Moment를 잠긴 상태로 보여줘야 하는지.
 * DB가 판단한 값(moment.locked)이 있으면 그것이 기준이다 — 실제 콘텐츠도 DB에서 가려져 온다.
 */
export function isMomentLocked(moment: Moment, tier: Tier | undefined): boolean {
  return moment.locked ?? !canView(moment.visibility, tier);
}

/** 이 팬이 이 Moment의 콘텐츠를 볼 수 있는지. 볼 수 없으면 Locked State를 보여준다. */
export function canViewMoment(fan: FanUser | undefined, moment: Moment): boolean {
  return !isMomentLocked(moment, tierFor(fan, moment.creatorId));
}

/** Creator AI 대화는 구독자 이상 */
export function canChat(tier: Tier | undefined): boolean {
  return RANK[tier ?? "none"] >= RANK.subscriber;
}

export function totalReactions(r: Reactions): number {
  return r.love + r.cheer + r.touched + r.smile;
}
