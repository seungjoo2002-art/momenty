/**
 * Fan Memory 분류 — 서버(lib/ai/memory.ts) · 화면(My > AI Memory)이 같이 쓴다. DB check 제약과 같은 목록.
 * Fan Memory는 "팬에 관한" 정보다. 크리에이터에 관한 사실(Verified Facts)과 섞지 않는다.
 */
export const MEMORY_CATEGORIES = ["nickname", "interest", "favorite", "schedule", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  nickname: "호칭",
  interest: "관심사",
  favorite: "좋아하는 것",
  schedule: "일정",
  other: "기타",
};
