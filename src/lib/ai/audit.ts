/**
 * AI 응답 메타데이터 · 감사 기록.
 *
 * 응답에는 "AI가 만든 것인지 · 어떤 크리에이터 Persona인지 · 어떤 종류의 Context를 썼는지"를 항상 붙인다
 * (화면이 AI 메시지와 크리에이터 본인 메시지를 구분해 보여주는 근거).
 *
 * 기록에는 메시지 본문 · 프롬프트 · Context 내용 · 이메일 같은 개인정보를 남기지 않는다.
 * 남기는 것: 요청 id, 크리에이터 id, 결과 코드, 메시지 길이, Context 종류와 개수.
 */
import "server-only";
/** DB(ai_messages.context_types)와 같은 목록 */
export type ContextType = "style" | "personality" | "facts" | "boundaries" | "today" | "focus" | "conversation" | "fan_memory";

export interface AiResponseMeta {
  /** 이 응답은 AI(Creator Persona)의 것 — 크리에이터 본인의 말이 아니다 */
  author: "ai";
  persona: { creatorId: string; name: string };
  /** 실제로 LLM이 답을 만들었는지 (v0.5-1: 항상 false) */
  generated: boolean;
  provider: string | null;
  model: string | null;
  context: {
    types: ContextType[];
    /** 근거가 된 Moment id (요청한 팬이 볼 수 있는 것만 — 내용은 담지 않는다) */
    momentIds: string[];
    focusMomentId: string | null;
  };
  /** 서버 가드가 개입했는지 — pre: 막힌 주제라 거절 모드로 불렀다 · post: 모델 답을 버리고 고정 문장으로 바꿨다 (내용은 담지 않는다) */
  guard: { stage: "pre" | "post"; topic: string } | null;
  /** Fan Memory — 켜져 있는지 · 이번 답에 쓴 개수 · 새로 기억한 개수 (내용은 담지 않는다) */
  memory: { enabled: boolean; used: number; saved: number };
}

export interface AiAuditEvent {
  event: "ai_chat";
  requestId: string;
  outcome: "ok" | "unauthenticated" | "invalid_input" | "forbidden" | "not_found" | "rate_limited" | "error";
  status: number;
  creatorId?: string;
  messageLength?: number;
  contextTypes?: ContextType[];
  contextCount?: number;
  guard?: string;
  memoryUsed?: number;
  memorySaved?: number;
}

export function auditAi(e: AiAuditEvent) {
  // 구조화된 한 줄 — 나중에 로그 수집기로 보낸다. 본문 · 개인정보 없음.
  console.info(JSON.stringify({ ...e, at: new Date().toISOString() }));
}
