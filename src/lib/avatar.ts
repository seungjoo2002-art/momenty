/**
 * Creator AI Avatar — 값 · 라벨 · 말투 분석 (클라이언트 · 서버 공용, 비밀 없음).
 * DB 목록과 같다 — supabase/migrations/20261001000000_v085_creator_avatar_studio.sql
 *
 * Fact와 Style은 따로다.
 *   · 기본정보(BASIC_KEYS) → creator_facts = AI가 사실로 말할 수 있는 근거
 *   · 말투 학습 답변 → creator_style_samples = 말하는 방식의 근거일 뿐, 내용은 사실이 아니다
 */

/* ---------- 직업 / 활동 분야 (공개 프로필) ---------- */

export const JOB_PRESETS = ["방송인", "유튜버", "스트리머", "인플루언서", "배우", "가수/뮤지션", "모델", "스포츠", "작가", "프리랜서", "전문가"] as const;
export const JOB_MAX = 40;

/* ---------- STEP 1 기본정보 ---------- */

export type BasicKey = "favorite_food" | "disliked_food" | "hobby" | "interest" | "likes" | "dislikes";

export const BASIC_META: Record<BasicKey, { label: string; placeholder: string }> = {
  favorite_food: { label: "좋아하는 음식", placeholder: "예: 떡볶이, 초밥" },
  disliked_food: { label: "싫어하는 음식", placeholder: "예: 오이" },
  hobby: { label: "취미", placeholder: "예: 러닝, 필름 카메라" },
  interest: { label: "관심사", placeholder: "예: 여행, 인테리어" },
  likes: { label: "좋아하는 것", placeholder: "예: 새벽 공기, 고양이" },
  dislikes: { label: "싫어하는 것", placeholder: "예: 약속에 늦는 것" },
};
export const BASIC_KEYS = Object.keys(BASIC_META) as BasicKey[];
export const BASIC_VALUE_MAX = 200;

export interface BasicValue {
  value: string;
  /** "말하고 싶지 않아요" — AI는 이 주제를 공개하지 않는다고 답한다 */
  undisclosed: boolean;
}

/** DB 사실 내용("좋아하는 음식: 떡볶이") → 입력값 */
export function parseBasicContent(key: BasicKey, content: string, undisclosed: boolean): BasicValue {
  if (undisclosed) return { value: "", undisclosed: true };
  const prefix = `${BASIC_META[key].label}: `;
  return { value: content.startsWith(prefix) ? content.slice(prefix.length) : content, undisclosed: false };
}

/* ---------- STEP 2 말투 학습 ---------- */

export type PromptCategory =
  | "greeting" | "daily" | "today" | "praise" | "thanks" | "playful" | "fan_tease" | "comfort" | "fan_struggling" | "fan_good_news"
  | "affection" | "jealousy" | "fan_hurt" | "about_me" | "taste" | "past" | "unknown_fact" | "sensitive" | "location" | "romance"
  | "rude" | "decline" | "short" | "long" | "ask_back";

export const PROMPT_CATEGORY_LABEL: Record<PromptCategory, string> = {
  greeting: "인사",
  daily: "일상 대화",
  today: "오늘 뭐 했는지",
  praise: "칭찬받을 때",
  thanks: "감사 인사",
  playful: "장난",
  fan_tease: "팬의 장난",
  comfort: "위로가 필요할 때",
  fan_struggling: "팬이 힘들다고 할 때",
  fan_good_news: "팬의 기쁜 소식",
  affection: "애정 표현",
  jealousy: "질투 섞인 질문",
  fan_hurt: "팬이 서운할 때",
  about_me: "나에 대한 질문",
  taste: "취향 질문",
  past: "지난 경험",
  unknown_fact: "모르는 사실",
  sensitive: "민감한 질문",
  location: "위치 질문",
  romance: "연애 질문",
  rude: "무례한 말",
  decline: "대답하고 싶지 않은 요청",
  short: "짧게 답할 때",
  long: "길게 답할 때",
  ask_back: "되물어 볼 때",
};

/** 안전과 관련된 질문 — 답하는 방식(거절 · 회피)도 말투로 배운다. 이 답은 사실의 근거가 아니다 */
export const PROMPT_CATEGORY_HINT: Partial<Record<PromptCategory, string>> = {
  location: "실제 위치를 적지 마세요. 평소에 어떻게 넘기는지만 알려 주세요.",
  romance: "사실을 밝힐 필요는 없어요. 이런 질문을 받으면 어떻게 답하는지만요.",
  sensitive: "건강 · 정치 같은 질문을 어떻게 피하는지 알려 주세요.",
  decline: "정중하게 거절하는 나만의 방식이면 돼요.",
  unknown_fact: "기억나지 않거나 모르는 일에 어떻게 답하는지요. 답의 내용이 사실로 학습되지는 않고, 말하는 방식만 배워요.",
  rude: "무례한 말에 어떻게 반응하는지요.",
};

export interface TrainingPrompt {
  key: string;
  category: PromptCategory;
  fanMessage: string;
  sort: number;
  required: boolean;
}

export type SampleSource = "onboarding" | "avatar_training" | "creator_correction";

export const SAMPLE_SOURCE_LABEL: Record<SampleSource, string> = {
  onboarding: "처음 학습",
  avatar_training: "추가 학습",
  creator_correction: "AI 답 고침",
};

export interface StyleSample {
  id: string;
  source: SampleSource;
  promptKey: string | null;
  fanMessage: string;
  reply: string;
  aiDraft: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export const REPLY_MAX = 500;

/* ---------- 준비 상태 (DB avatar_readiness()) ---------- */

export interface AvatarReadiness {
  ready: boolean;
  basics: { done: boolean; job: boolean; missing: BasicKey[] };
  style: { done: boolean; answered: number; minimum: number; total: number; requiredMissing: string[] };
  persona: boolean;
  boundaries: boolean;
}

/** 진행률 (4단계: 기본정보 · 말투 · Avatar 확인(성향 · 경계) · 켜기) — 화면 표시용 */
export function avatarProgress(r: AvatarReadiness, enabled: boolean): number {
  const basics = ((r.basics.job ? 1 : 0) + (BASIC_KEYS.length - r.basics.missing.length)) / (BASIC_KEYS.length + 1);
  const style = Math.min(r.style.answered / r.style.minimum, 1) * (r.style.requiredMissing.length ? 0.95 : 1);
  const review = ((r.persona ? 1 : 0) + (r.boundaries ? 1 : 0)) / 2;
  return Math.round((basics * 0.2 + style * 0.55 + review * 0.2 + (enabled ? 0.05 : 0)) * 100);
}

/** 준비가 안 된 첫 단계 (AI 문답 ON을 누르면 여기로 안내한다) */
export function firstIncompleteStep(r: AvatarReadiness): string {
  if (!r.basics.done) return "/studio/settings/avatar/basics?notice=1";
  if (!r.style.done) return "/studio/settings/avatar/training?notice=1";
  return "/studio/settings/avatar/review?notice=1";
}

/* ---------- 말투 분석 (규칙 기반 · LLM 없음) ---------- */

export interface StyleProfile {
  sampleCount: number;
  formality: "polite" | "casual" | "mixed";
  /** 답 평균 글자 수 */
  avgLength: number;
  replyLength: "short" | "medium" | "long";
  /** 답 중 해당 표현이 들어간 비율 (0~1) */
  laughKk: number;
  laughHh: number;
  emoji: number;
  question: number;
  exclaim: number;
  tilde: number;
  /** 자주 쓰는 말끝 (최대 4) */
  endings: string[];
  /** 팬을 부르는 말 (답에 실제로 나온 것만) */
  fanTerms: string[];
}

const EMOJI = /\p{Extended_Pictographic}/u;
const FAN_TERMS = ["여러분", "우리 팬", "팬님", "너희", "너", "자기", "친구"];

function sentencesOf(text: string) {
  return text
    .split(/(?<=[.!?~…ㅋㅎ♡❤])\s+|\n+/)
    .map((s) => s.replace(/[\s.!?~…♡❤ㅋㅎㅠㅜ^;:)(]+$/u, "").replace(/\p{Extended_Pictographic}+$/u, "").trim())
    .filter((s) => s.length >= 2);
}

/** 존댓말 끝 · 반말 끝 (완벽하지 않다 — 비율로만 쓴다) */
const POLITE_END = /(요|니다|니까|세요|죠|습니다|에요|예요|해요|네요)$/;
const CASUAL_END = /(어|아|야|지|해|냐|니|래|게|자|다|네|걸|까|군|구나|거든|잖아|는데|던데|했어|했지)$/;

export function analyzeStyle(replies: string[]): StyleProfile {
  const list = replies.map((r) => r.trim()).filter(Boolean);
  const count = list.length || 1;
  const share = (re: RegExp) => list.filter((r) => re.test(r)).length / count;
  let polite = 0;
  let casual = 0;
  const endings = new Map<string, number>();
  for (const r of list) {
    for (const s of sentencesOf(r)) {
      if (POLITE_END.test(s)) polite++;
      else if (CASUAL_END.test(s)) casual++;
      const tail = s.slice(-2);
      if (/[가-힣]{2}/.test(tail)) endings.set(tail, (endings.get(tail) ?? 0) + 1);
    }
  }
  const total = polite + casual;
  const formality = !total ? "mixed" : polite / total >= 0.7 ? "polite" : casual / total >= 0.7 ? "casual" : "mixed";
  const avgLength = Math.round(list.reduce((n, r) => n + r.length, 0) / count);
  return {
    sampleCount: list.length,
    formality,
    avgLength,
    replyLength: avgLength <= 25 ? "short" : avgLength <= 70 ? "medium" : "long",
    laughKk: share(/ㅋㅋ/),
    laughHh: share(/ㅎㅎ/),
    emoji: share(EMOJI),
    question: share(/\?/),
    exclaim: share(/!/),
    tilde: share(/~/),
    endings: [...endings.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([e]) => e),
    // 조사가 붙어도("여러분은") 찾되, 다른 낱말의 일부("너무")는 세지 않는다
    fanTerms: FAN_TERMS.filter((t) => list.some((r) => new RegExp(`(^|[^가-힣])${t}(은|는|이|가|도|랑|한테|에게|의|들|아|야)?([^가-힣]|$)`).test(r))).slice(0, 3),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 화면용 말투 요약 문장 (추정이 아니라 답변에서 센 비율) */
export function describeStyle(p: StyleProfile): string[] {
  if (!p.sampleCount) return [];
  const lines = [
    p.formality === "polite" ? "주로 존댓말" : p.formality === "casual" ? "주로 반말" : "존댓말 · 반말을 섞어 씀",
    `답 길이 평균 ${p.avgLength}자 (${p.replyLength === "short" ? "짧게" : p.replyLength === "medium" ? "보통" : "길게"})`,
  ];
  const marks = [p.laughKk >= 0.15 && `ㅋㅋ ${pct(p.laughKk)}`, p.laughHh >= 0.15 && `ㅎㅎ ${pct(p.laughHh)}`, p.emoji >= 0.15 && `이모지 ${pct(p.emoji)}`].filter(Boolean);
  lines.push(marks.length ? `자주 쓰는 표현: ${marks.join(" · ")}` : "ㅋㅋ · ㅎㅎ · 이모지는 거의 쓰지 않음");
  if (p.question >= 0.25) lines.push(`답의 ${pct(p.question)}에서 팬에게 되물어 봄`);
  if (p.endings.length) lines.push(`자주 쓰는 말끝: ${p.endings.map((e) => `“~${e}”`).join(" ")}`);
  if (p.fanTerms.length) lines.push(`팬을 부르는 말: ${p.fanTerms.join(" · ")}`);
  return lines;
}
