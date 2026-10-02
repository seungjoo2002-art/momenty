/**
 * LLM Provider 인터페이스 — Route는 이 인터페이스만 부른다 (모델 · 회사를 바꿔도 Route는 그대로).
 *
 *   Client → /api/ai/chat → Auth → Authorization(DB) → Rate limit(DB) → Context Builder → Prompt Builder → Provider
 *
 * 키 · 모델은 서버 환경 변수(AI_PROVIDER · AI_API_KEY · AI_MODEL)에서만 — config.ts(server-only).
 * 설정이 없으면 null → Route는 LLM 없이 "준비 중"으로 응답한다.
 */
import "server-only";
import { createAnthropicProvider } from "./anthropic";
import { getAiProviderConfig, type AiProviderName } from "./config";

export { ProviderError } from "./providerError";

export interface PersonaReplyInput {
  /** Prompt Builder가 만든 1~7층 */
  system: string;
  /** 8 CONVERSATION + 9 USER MESSAGE */
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  /** 로그 · 감사용 (내용 아님) */
  requestId: string;
}

export interface PersonaReplyOutput {
  /** 모델이 돌려준 원문 (JSON 형식 기대 — prompt.ts parseModelOutput) */
  text: string;
  provider: AiProviderName;
  model: string;
  /** 안전 정책 등으로 모델이 답을 거절함 */
  refused: boolean;
}

/** 크리에이터용 AI 팬 요약 (lib/fanSummary.ts aiFanSummaryPrompt) — 답 형식 {"sentences": string[]} */
export interface FanSummaryInput {
  system: string;
  user: string;
  requestId: string;
}

export interface FanSummaryOutput {
  /** 모델이 돌려준 원문 (JSON — fanSummary.ts parseAiFanSummaryOutput) */
  text: string;
  model: string;
  refused: boolean;
}

export interface PersonaProvider {
  readonly name: AiProviderName;
  readonly model: string;
  generatePersonaReply(input: PersonaReplyInput): Promise<PersonaReplyOutput>;
  generateFanSummary(input: FanSummaryInput): Promise<FanSummaryOutput>;
}

/** 설정된 Provider. 설정이 없거나 아직 구현하지 않은 Provider면 null */
export function getPersonaProvider(): PersonaProvider | null {
  const cfg = getAiProviderConfig();
  if (!cfg) return null;
  if (cfg.provider === "anthropic") return createAnthropicProvider(cfg);
  return null; // openai: 아직 구현하지 않음
}
