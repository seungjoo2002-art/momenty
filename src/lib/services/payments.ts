/**
 * 결제 레이어 (Mock).
 * 실제 결제 연동 시 이 함수는 서버(Route Handler / Server Action)에서
 * PG사 결제창 세션을 만들고, 승인 웹훅에서 subscriptions 테이블을 갱신한다.
 */
import type { Tier } from "@/lib/types";

export interface CheckoutResult {
  ok: boolean;
  creatorId: string;
  tier: Tier;
}

export async function startSubscriptionCheckout(creatorId: string, tier: Tier): Promise<CheckoutResult> {
  await new Promise((r) => setTimeout(r, 900));
  return { ok: true, creatorId, tier };
}
