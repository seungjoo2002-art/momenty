/**
 * AI Chat API 입력 스키마 (zod). 서버가 검증한다 — 클라이언트 검증은 편의일 뿐.
 * 정의되지 않은 필드가 오면 거부한다(strict) → 클라이언트가 권한 · 문맥을 "주입"할 통로가 없다.
 */
import { z } from "zod";

export const AI_MESSAGE_MAX = 1000;

const uuid = z.string().uuid();

export const aiChatRequestSchema = z
  .object({
    creatorId: z.string().regex(/^[a-z0-9_-]{1,40}$/, "creatorId 형식이 올바르지 않아요."),
    message: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "메시지를 입력해 주세요.").max(AI_MESSAGE_MAX, `메시지는 ${AI_MESSAGE_MAX}자까지 보낼 수 있어요.`)),
    conversationId: uuid.optional(),
    momentId: uuid.optional(),
  })
  .strict();

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
