/**
 * AI Provider 설정 — 서버 전용.
 * `server-only` 때문에 Client Component가 이 파일을 import하면 빌드가 실패한다 → 키가 브라우저 번들에 들어갈 수 없다.
 * 키는 NEXT_PUBLIC_ 이 아닌 서버 환경 변수(AI_PROVIDER · AI_API_KEY)에서만 읽는다.
 *
 * v0.5-1: 실제 LLM은 아직 호출하지 않는다. 설정 여부만 확인한다.
 */
import "server-only";

export type AiProviderName = "anthropic" | "openai";

export interface AiProviderConfig {
  provider: AiProviderName;
  /** 로그 · 응답 어디에도 내보내지 않는다 */
  apiKey: string;
  model: string | null;
}

/** 설정되어 있지 않으면 null (앱은 "AI 준비 중"으로 응답한다) */
export function getAiProviderConfig(): AiProviderConfig | null {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!provider || !apiKey) return null;
  if (provider !== "anthropic" && provider !== "openai") return null;
  return { provider, apiKey, model: process.env.AI_MODEL?.trim() || null };
}

/** 응답 · 감사 기록에 남겨도 되는 정보 (키 제외) */
export function describeAiProvider(): { provider: AiProviderName | null; model: string | null } {
  const c = getAiProviderConfig();
  return { provider: c?.provider ?? null, model: c?.model ?? null };
}

/**
 * DB의 AI 함수(Persona Context · 대화 저장 · rate limit)를 부를 때 쓰는 서버 키.
 * DB에는 SHA-256 해시만 있다 (private.server_keys). 없으면 AI Route는 동작하지 않는다.
 */
export function getAiServerKey(): string {
  const key = process.env.AI_SERVER_KEY?.trim();
  if (!key || key.length < 32) throw new AiConfigError("AI_SERVER_KEY");
  return key;
}

/** 서버 설정이 빠졌을 때 — 응답에는 어떤 값이 빠졌는지 내보내지 않는다 (로그에만) */
export class AiConfigError extends Error {
  constructor(readonly missing: string) {
    super(`AI server config missing: ${missing}`);
    this.name = "AiConfigError";
  }
}
