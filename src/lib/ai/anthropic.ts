/**
 * Anthropic(Claude) Provider — 공식 @anthropic-ai/sdk. 서버 전용.
 *
 * · 모델은 AI_MODEL 환경 변수 그대로 (코드에 모델명을 두지 않는다).
 * · 답 형식은 structured outputs(zod 스키마)로 강제: { reply, moments, memories }.
 * · 안전 거절(stop_reason = "refusal")은 그대로 존중한다 — 다른 모델로 다시 부르지 않는다 (fallback 없음).
 * · 재시도는 기술적 오류만: SDK 기본 재시도(408 · 409 · 429 · 5xx · 연결 오류)를 2회로 제한, 요청당 timeout 30초.
 *   재시도는 저장 전에 일어나므로 메시지가 두 번 저장되지 않는다 (저장은 성공한 답 하나로 한 번).
 * · API 키 · 오류 원문은 로그 · 응답에 남기지 않는다 (상태 코드 · 요청 id만).
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AiProviderConfig } from "./config";
import type { PersonaProvider, PersonaReplyInput, PersonaReplyOutput } from "./provider";
import { ProviderError } from "./providerError";

const ReplySchema = z.object({
  reply: z.string(),
  moments: z.array(z.string()),
  // Fan Memory 후보 (팬에 관한 것) — 서버가 다시 거르고, DB가 Memory ON · 민감정보를 최종 판단한다
  memories: z.array(z.object({ category: z.enum(["nickname", "interest", "favorite", "schedule", "other"]), content: z.string() })),
});

/** 생각(thinking)과 답이 함께 쓰는 출력 상한 — 답 길이는 STYLE 층이 정한다 */
const OUTPUT_TOKENS = 2048;

export class ModelUnavailableError extends ProviderError {
  constructor(readonly model: string, detail: string) {
    super(`model unavailable: ${detail}`, false);
    this.name = "ModelUnavailableError";
  }
}

export function createAnthropicProvider(cfg: AiProviderConfig): PersonaProvider {
  if (!cfg.model) throw new ProviderError("AI_MODEL is not set", false);
  const model = cfg.model;
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2, timeout: 30_000 });

  return {
    name: "anthropic",
    model,
    async generatePersonaReply(input: PersonaReplyInput): Promise<PersonaReplyOutput> {
      try {
        const res = await client.messages.parse({
          model,
          max_tokens: Math.max(OUTPUT_TOKENS, input.maxTokens),
          system: input.system,
          messages: input.messages,
          output_config: { effort: "low", format: zodOutputFormat(ReplySchema) },
        });
        if (res.stop_reason === "refusal") {
          return { text: "", provider: "anthropic", model: res.model, refused: true };
        }
        const parsed = res.parsed_output;
        const text = parsed
          ? JSON.stringify(parsed)
          : res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        return { text, provider: "anthropic", model: res.model, refused: false };
      } catch (e) {
        if (e instanceof Anthropic.NotFoundError) {
          throw new ModelUnavailableError(model, `404 not_found (request ${e.requestID ?? "-"})`);
        }
        if (e instanceof Anthropic.BadRequestError && /model/i.test(e.message)) {
          throw new ModelUnavailableError(model, `400 invalid model (request ${e.requestID ?? "-"})`);
        }
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderError(`auth ${e.status} (request ${e.requestID ?? "-"})`, false);
        }
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError(`429 (request ${e.requestID ?? "-"})`, true);
        if (e instanceof Anthropic.APIError) throw new ProviderError(`api ${e.status ?? "?"} (request ${e.requestID ?? "-"})`, (e.status ?? 500) >= 500);
        if (e instanceof Anthropic.APIConnectionError) throw new ProviderError("connection error", true);
        throw e;
      }
    },
  };
}
