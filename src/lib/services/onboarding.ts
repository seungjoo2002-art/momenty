/**
 * 온보딩 소개 화면(가입 전)의 그림 — 실제 사용자 데이터가 아닌 고정 예시.
 * 화면에도 "예시"로 표시한다. DB가 비어 있어도 소개 화면이 깨지지 않도록 DB를 읽지 않는다.
 */
import { creators } from "@/lib/mock/creators";
import { buildMockDay, buildPastMoments } from "@/lib/mock/moments";
import type { Creator, Moment } from "@/lib/types";
import { kstDate } from "@/lib/utils/format";

export async function getOnboardingSample(): Promise<{ creator: Omit<Creator, "profileId">; moments: Moment[] }> {
  const moments = [...buildPastMoments(), ...buildMockDay(kstDate(), "", Infinity)].filter((m) => m.creatorId === "c1").reverse();
  return { creator: creators[0], moments };
}
