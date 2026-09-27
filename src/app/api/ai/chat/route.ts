/**
 * POST /api/ai/chat — Persona AI의 서버 입구 (v0.5-1: 실제 LLM은 아직 부르지 않는다).
 *
 *   1. 인증      쿠키 세션 → Auth 서버 검증(getUser)          없으면 401
 *   2. 입력 검증  zod strict 스키마 (정의 밖 필드 거부)          잘못되면 400
 *   3. 권한      크리에이터 존재 404 · 구독 등급 · Persona 사용 여부 403  (LLM 호출 전, 서버에서)
 *   4. 횟수 제한  user × creator × 시간 창                     넘으면 429
 *   5. Context   사용자 세션 + RLS로 볼 수 있고 AI 참고 허용된 Moment만
 *   6. 응답      구조화된 결과 + AI 메타데이터 (Context 내용 · 프롬프트는 돌려주지 않는다)
 *
 * 메시지 내용은 1~5단계 어디에도 쓰이지 않는다 → "이전 지시 무시해" 같은 메시지로 권한 · 데이터 범위가 바뀌지 않는다.
 * service role은 쓰지 않는다.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auditAi, type AiAuditEvent, type AiResponseMeta } from "@/lib/ai/audit";
import { describeAiProvider, getAiProviderConfig } from "@/lib/ai/config";
import { contextTypesOf, createContextBuilder } from "@/lib/ai/context";
import { authorizePersonaChat } from "@/lib/ai/policy";
import { aiRateLimiter } from "@/lib/ai/rateLimit";
import { aiChatRequestSchema } from "@/lib/ai/schema";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

const MESSAGES = {
  unauthenticated: "로그인이 필요해요.",
  invalid_input: "요청 형식이 올바르지 않아요.",
  forbidden_origin: "허용되지 않은 요청이에요.",
  creator_not_found: "크리에이터를 찾을 수 없어요.",
  persona_disabled: "이 크리에이터는 Creator AI를 쓰지 않아요.",
  own_channel: "내 채널의 Creator AI와는 대화할 수 없어요.",
  subscription_required: "Creator AI 대화는 구독자에게 열려요.",
  rate_limited: "잠시 후 다시 시도해 주세요.",
  error: "잠시 후 다시 시도해 주세요.",
} as const;

type ErrorCode = keyof typeof MESSAGES;

function fail(requestId: string, status: number, code: ErrorCode, audit: Omit<AiAuditEvent, "event" | "requestId" | "status">, extra?: Record<string, unknown>, headers?: HeadersInit) {
  auditAi({ event: "ai_chat", requestId, status, ...audit });
  return NextResponse.json({ ok: false, requestId, error: { code, message: MESSAGES[code], ...extra } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** 다른 사이트에서 사용자의 쿠키로 보내는 요청(CSRF) 차단 — Origin이 있으면 같은 호스트여야 한다 */
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    if (!sameOrigin(req)) return fail(requestId, 403, "forbidden_origin", { outcome: "forbidden" });

    // 1. 인증
    const sb = await createServerSupabase();
    const { data: auth, error: authError } = await sb.auth.getUser();
    const user = authError ? null : auth.user;
    if (!user) return fail(requestId, 401, "unauthenticated", { outcome: "unauthenticated" });

    // 2. 입력 검증
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return fail(requestId, 400, "invalid_input", { outcome: "invalid_input" }, { issues: ["body_too_large"] });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(requestId, 400, "invalid_input", { outcome: "invalid_input" }, { issues: ["invalid_json"] });
    }
    const parsed = aiChatRequestSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => (i.path.length ? i.path.join(".") : i.code));
      return fail(requestId, 400, "invalid_input", { outcome: "invalid_input" }, { issues });
    }
    const input = parsed.data;

    // 3. 권한 (LLM 호출 전 · 사용자 세션 + RLS)
    const authz = await authorizePersonaChat(sb, user.id, input.creatorId);
    if (!authz.ok) {
      return fail(requestId, authz.status, authz.code, { outcome: authz.status === 404 ? "not_found" : "forbidden", creatorId: input.creatorId });
    }

    // 4. 횟수 제한
    const limit = await aiRateLimiter().consume({ userId: user.id, creatorId: authz.creator.id, scope: "ai_chat" });
    if (!limit.allowed) {
      const retryAfter = Math.max(1, Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000));
      return fail(
        requestId,
        429,
        "rate_limited",
        { outcome: "rate_limited", creatorId: authz.creator.id },
        { resetAt: limit.resetAt, rule: limit.rule },
        { "Retry-After": String(retryAfter) },
      );
    }

    // 5. Context (요청한 사용자가 볼 수 있고 AI 참고가 허용된 것만)
    const ctx = await createContextBuilder(sb, authz.creator).build({
      creatorId: authz.creator.id,
      fanId: user.id,
      conversationId: input.conversationId,
      focusMomentId: input.momentId,
    });

    // 6. 응답 — v0.5-2에서 여기서 Provider를 부른다 (ctx + 서버가 만든 system prompt + 팬 메시지)
    const provider = describeAiProvider();
    const meta: AiResponseMeta = {
      author: "ai",
      persona: { creatorId: authz.creator.id, name: authz.creator.name },
      generated: false,
      provider: provider.provider,
      model: provider.model,
      context: {
        types: contextTypesOf(ctx),
        momentIds: ctx.today.items.map((m) => m.id),
        focusMomentId: ctx.focus?.id ?? null,
      },
    };
    auditAi({
      event: "ai_chat",
      requestId,
      outcome: "ok",
      status: 200,
      creatorId: authz.creator.id,
      messageLength: input.message.length,
      contextTypes: meta.context.types,
      contextCount: meta.context.momentIds.length,
    });
    return NextResponse.json(
      {
        ok: true,
        requestId,
        reply: null,
        status: getAiProviderConfig() ? "llm_not_enabled" : "provider_not_configured",
        meta,
        rateLimit: { remaining: limit.remaining, resetAt: limit.resetAt },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[momenty/ai] request failed", requestId, e instanceof Error ? e.name : "unknown");
    return fail(requestId, 500, "error", { outcome: "error" });
  }
}

/** POST만 받는다 */
export function GET() {
  return NextResponse.json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405, headers: { Allow: "POST" } });
}
