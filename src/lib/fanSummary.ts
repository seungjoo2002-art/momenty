/**
 * Fan AI Summary — 크리에이터가 팬 메시지 화면에서 보는 요약. 허용된 데이터만 쓴다.
 *
 *   쓰는 것: 구독 플랜 · 구독 기간 · 팬이 크리에이터에게 직접 공유한 정보 · 직접 대화(Human Chat) ·
 *            팬이 열람 안내를 확인한 뒤의 AI Avatar 대화 · 이 채널 Moment 반응 "개수"
 *   쓰지 않는 것: Fan Memory 원문 · 안내 확인 전 AI 대화 · 크리에이터 메모
 *
 * 추론 금지: 건강 · 정신상태 · 정치 · 성적 정보 · 취약성 · 경제상태 · "충성 팬" · "이탈 위험" · "과금 가능성" · "외로운 팬" 등.
 * 기본 요약은 규칙으로 만든다 (사실 나열 — LLM 없음). LLM 요약(현재 대화 한 줄)은 서버 설정으로만 켜지고,
 * 결과는 sanitizeSummaryLine()을 통과해야 한다 — 하나라도 걸리면 그 문장은 버린다.
 */
import { planLabel } from "@/lib/constants";
import { MEMORY_CATEGORY_LABEL, type MemoryCategory } from "@/lib/fanMemory";

export interface SummaryMessage {
  source: "human" | "ai";
  sender: "fan" | "creator" | "ai";
  content: string;
  createdAt: string;
}

export interface SummaryInput {
  nickname: string;
  tier: string | null;
  subscribedAt: string | null;
  subscribedDays: number | null;
  reactions30d: number;
  lastReactionAt: string | null;
  shares: { category: string; content: string; eventDate: string | null }[];
  aiConsented: boolean;
  messages: SummaryMessage[];
}

export interface FanSummary {
  fan: string[];
  highlights: string[];
  remember: string[];
  current: string[];
  /** LLM이 만든 문장이 들어 있는지 (기본 false) */
  generated: boolean;
  sources: string[];
}

/** 크리에이터에게 보여 주면 안 되는 추론 · 민감 판단 (요약 문장 필터) */
const FORBIDDEN =
  /(건강|아프|병|질환|우울|불안|공황|정신|자해|자살|정치|지지\s*정당|보수|진보|성적|성생활|성\s*정체성|취약|외로|고독|돈이\s*없|가난|경제\s*(상황|상태|적)|빚|월급|연봉|충성|이탈|떠날|과금|결제\s*가능|구매\s*가능|VIP|고래|호구|집착|중독|의존|위험\s*(팬|신호)|점수|등급을\s*매)/i;

export function sanitizeSummaryLine(line: string): string | null {
  const t = line.replace(/\s+/g, " ").trim();
  if (!t || t.length > 200) return null;
  if (FORBIDDEN.test(t)) return null;
  return t;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/** 규칙 기반 요약 (LLM 없음) — 사실만 */
export function buildFanSummary(input: SummaryInput): FanSummary {
  const fan: string[] = [];
  fan.push(input.tier ? `구독 플랜: ${planLabel(input.tier)}` : "구독 플랜: 없음 (직접 대화 기록만 있음)");
  if (input.subscribedAt && input.subscribedDays != null) fan.push(`${day(input.subscribedAt)}부터 · ${input.subscribedDays}일째`);
  if (input.shares.length) fan.push(`직접 공유한 정보 ${input.shares.length}개`);

  const human = input.messages.filter((m) => m.source === "human");
  const ai = input.messages.filter((m) => m.source === "ai");
  const highlights: string[] = [];
  if (human.length) highlights.push(`직접 대화 ${human.length}개 · 마지막 ${day(human[human.length - 1].createdAt)}`);
  if (ai.length) highlights.push(`AI Avatar 대화 ${ai.filter((m) => m.sender === "fan").length}개 메시지 (안내 확인 이후)`);
  else if (!input.aiConsented) highlights.push("AI Avatar 대화는 팬이 열람 안내를 확인하지 않아 보이지 않아요");
  highlights.push(input.reactions30d ? `최근 30일 Moment 반응 ${input.reactions30d}번${input.lastReactionAt ? ` · 마지막 ${day(input.lastReactionAt)}` : ""}` : "최근 30일 Moment 반응 없음");

  const remember = input.shares.map((s) => {
    const label = (MEMORY_CATEGORY_LABEL as Record<string, string>)[s.category as MemoryCategory] ?? "기타";
    return `[${label}] ${s.content}${s.eventDate ? ` (${s.eventDate.slice(5).replace("-", "월 ")}일)` : ""}`;
  });

  const recent = [...input.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-3);
  const current = recent.map((m) => {
    const who = m.sender === "fan" ? "팬" : m.sender === "creator" ? "나" : "AI Avatar";
    const where = m.source === "human" ? "직접 대화" : "AI 대화";
    const text = m.content.replace(/\s+/g, " ").trim();
    return `${day(m.createdAt)} · ${where} · ${who}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
  });

  return {
    fan,
    highlights,
    remember,
    current,
    generated: false,
    sources: ["구독 정보", "팬이 직접 공유한 정보", "직접 대화", ...(input.aiConsented ? ["AI Avatar 대화(안내 확인 이후)"] : []), "Moment 반응 수"],
  };
}

/* ---------- LLM 요약 (선택 · 기본 꺼짐) ---------- */

/** LLM에게 줄 지시문 — 사실 요약만. 결과는 JSON {"topics": [..], "current": ".."} */
export function fanSummaryPrompt(input: SummaryInput): { system: string; user: string } {
  const system = [
    "너는 크리에이터가 팬과의 대화 흐름을 빠르게 파악하도록 돕는 요약 도우미다.",
    "아래 대화에서 '무슨 이야기를 나눴는지'만 사실대로 요약한다.",
    "절대 하지 않는 것: 팬의 건강 · 정신상태 · 감정 상태 · 정치 성향 · 성적 정보 · 취약성 · 경제 상태 추론, 팬 평가(충성도 · 이탈 위험 · 과금 가능성 · 외로움 등), 대화에 없는 내용.",
    "대화에 민감한 내용이 있으면 그 부분은 요약에서 빼고 '개인적인 이야기'라고만 쓴다.",
    '반드시 JSON 한 개로만 답한다: {"topics": ["짧은 주제 명사구", "..."], "current": "최근 대화 한 문장"} · topics는 최대 3개.',
  ].join("\n");
  const user = input.messages
    .slice(-30)
    .map((m) => `${m.source === "human" ? "[직접]" : "[AI]"} ${m.sender === "fan" ? "팬" : m.sender === "creator" ? "크리에이터" : "AI"}: ${m.content.replace(/[<>]/g, " ").slice(0, 300)}`)
    .join("\n");
  return { system, user: user || "(대화 없음)" };
}

/** LLM 출력 → 걸러진 문장들. 형식이 깨지거나 전부 걸리면 빈 결과 (기본 요약만 보여준다) */
export function parseFanSummaryOutput(raw: string): { topics: string[]; current: string | null } {
  try {
    const t = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const obj = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as { topics?: unknown; current?: unknown };
    const topics = (Array.isArray(obj.topics) ? obj.topics : []).flatMap((x) => (typeof x === "string" ? [sanitizeSummaryLine(x)].filter((y): y is string => !!y) : [])).slice(0, 3);
    const current = typeof obj.current === "string" ? sanitizeSummaryLine(obj.current) : null;
    return { topics, current };
  } catch {
    return { topics: [], current: null };
  }
}
