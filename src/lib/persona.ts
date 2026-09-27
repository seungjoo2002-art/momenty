/**
 * Creator Persona 설정의 값 · 라벨 (DB 제약과 같은 목록 — supabase/migrations/20260928000000_v05_persona_chat.sql).
 * 클라이언트 · 서버 공용 (비밀 없음).
 */

export type Formality = "polite" | "casual";
export type ReplyLength = "short" | "medium" | "long";
export type Trait = "playful" | "warm" | "calm" | "direct" | "serious" | "curious" | "bright" | "shy";
export type FactCategory = "food" | "hobby" | "activity" | "profile" | "other";
export type BoundaryTopic =
  | "everyday"
  | "jokes"
  | "listening"
  | "hobbies"
  | "flirting"
  | "romance_roleplay"
  | "sexual"
  | "politics"
  | "meeting_requests"
  | "current_location";

export interface PersonaStyle {
  formality: Formality;
  replyLength: ReplyLength;
  laughKk: boolean;
  laughHh: boolean;
  /** 0 없음 · 1 조금 · 2 보통 · 3 많이 */
  emojiLevel: 0 | 1 | 2 | 3;
  phrases: string[];
  mood: string;
  examples: string[];
}

export interface PersonaPersonality {
  traits: Trait[];
}

export interface CreatorFact {
  id: string;
  category: FactCategory;
  content: string;
  active: boolean;
  lastVerifiedAt: string;
}

export type Boundaries = Record<BoundaryTopic, boolean>;

export const LIMITS = { phrases: 10, phraseLength: 40, examples: 10, exampleLength: 200, traits: 5, mood: 80, facts: 50, factLength: 300 } as const;

export const FORMALITY_LABEL: Record<Formality, string> = { polite: "존댓말", casual: "반말" };
export const LENGTH_LABEL: Record<ReplyLength, string> = { short: "짧게", medium: "보통", long: "길게" };
export const EMOJI_LABEL = ["없음", "조금", "보통", "많이"] as const;

export const TRAIT_LABEL: Record<Trait, string> = {
  playful: "장난스러운",
  warm: "따뜻한",
  calm: "차분한",
  direct: "직설적인",
  serious: "진지한",
  curious: "호기심 많은",
  bright: "밝은",
  shy: "수줍은",
};

export const FACT_CATEGORY_LABEL: Record<FactCategory, string> = {
  food: "음식",
  hobby: "취미",
  activity: "활동",
  profile: "프로필",
  other: "기타",
};

/** 기본값은 DB의 ai_persona_context와 같다 — 설정하지 않은 주제는 이 값 */
export const BOUNDARY_META: Record<BoundaryTopic, { label: string; description: string; defaultAllowed: boolean }> = {
  everyday: { label: "일상 대화", description: "오늘 하루, 날씨, 소소한 이야기", defaultAllowed: true },
  jokes: { label: "농담 · 장난", description: "가벼운 농담과 장난스러운 대화", defaultAllowed: true },
  listening: { label: "고민 들어주기", description: "팬의 이야기에 공감하며 들어주기", defaultAllowed: true },
  hobbies: { label: "취미 이야기", description: "확인한 사실에 있는 취미 · 관심사", defaultAllowed: true },
  flirting: { label: "플러팅", description: "설레는 말투의 대화", defaultAllowed: false },
  romance_roleplay: { label: "연애 역할극", description: "연인처럼 대하는 대화", defaultAllowed: false },
  sexual: { label: "성적인 대화", description: "켜더라도 노골적인 성적 내용은 플랫폼이 항상 막아요", defaultAllowed: false },
  politics: { label: "정치", description: "정당 · 선거 · 정치적 견해", defaultAllowed: false },
  meeting_requests: { label: "만남 요청", description: "실제로 만나자는 요청 · 연락처 교환", defaultAllowed: false },
  current_location: { label: "지금 위치", description: "지금 어디 있는지 · 이동 경로 · 사는 곳 (기록에 적은 장소는 그 기록 기준으로만)", defaultAllowed: false },
};

export const BOUNDARY_TOPICS = Object.keys(BOUNDARY_META) as BoundaryTopic[];

export function defaultBoundaries(): Boundaries {
  return Object.fromEntries(BOUNDARY_TOPICS.map((t) => [t, BOUNDARY_META[t].defaultAllowed])) as Boundaries;
}

export function defaultStyle(): PersonaStyle {
  return { formality: "polite", replyLength: "medium", laughKk: false, laughHh: false, emojiLevel: 1, phrases: [], mood: "", examples: [] };
}
