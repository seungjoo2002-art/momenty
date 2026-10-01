import type { CategoryKey, Tier } from "@/lib/types";

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  photo: "사진",
  music: "음악",
  dance: "댄스",
  food: "요리",
  art: "아트",
  sports: "러닝",
  books: "책",
  coffee: "커피",
};

/**
 * 아직 열지 않은 기능 (v0.5 이후). false면 진입 링크를 숨기고, 주소로 들어오면 "준비 중" 화면을 보여준다.
 * Creator AI(Persona 대화)는 v0.5-2, Fan Memory(My > AI Memory)는 v0.6에서 열었다. AI Fan Manager · 결제는 아직
 */
export const FEATURES = {
  creatorAI: true,
  payments: false,
} as const;

/**
 * 구독 플랜 이름 (subscriptions.tier). DB enum과 같은 값 — 새 등급이 생기면 여기에 이름만 더한다.
 * 이름이 없는 등급은 값 그대로 보여준다 (planLabel).
 */
export const PLAN_LABEL: Record<Tier, string> = {
  follow: "무료",
  subscriber: "구독",
  premium: "Premium",
};

export function planLabel(tier: string): string {
  return (PLAN_LABEL as Record<string, string>)[tier] ?? tier;
}
