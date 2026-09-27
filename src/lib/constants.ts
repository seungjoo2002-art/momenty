import type { CategoryKey } from "@/lib/types";

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
 * Creator AI(Persona 대화) · Fan Memory · AI Fan Manager · 결제
 */
export const FEATURES = {
  creatorAI: false,
  payments: false,
} as const;
