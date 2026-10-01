/**
 * POST /api/ai/chat — Creator Persona AI의 서버 입구.
 *
 *   1. 인증        쿠키 세션 → Auth 서버 검증(getUser) · 다른 Origin 거부           401 · 403
 *   2. 입력 검증    zod strict (정의 밖 필드 거부)                                  400
 *   3. 권한        ai_persona_context(서버 키, creatorId) — DB가 판단                404 · 403
 *                  (존재 · 본인 채널 아님 · 차단 · AI ON · Avatar 준비 · subscriber/premium · 열람 안내 확인)
 *   4. 횟수 제한    consume_ai_rate_limit(서버 키, creatorId) — Postgres 공유 카운터    429
 *   5. Context     팬 세션 + RLS로 볼 수 있고 AI 참고 허용된 오늘 Moment · focus Moment · 최근 대화
 *                  + Fan Memory(ai_fan_memory_context — 팬이 켰을 때만, 이 크리에이터 AI에 대한 것만, 최대 6개)
 *   6. 경계(전)    팬 메시지 주제 검사 → 막힌 주제면 거절 모드 (Today · 사실 제외)
 *   7. Prompt      SYSTEM → STYLE → PERSONALITY → FACTS → BOUNDARIES → TODAY → FAN → CONVERSATION → USER
 *   8. Provider    (설정되어 있으면) LLM 호출
 *   9. 경계(후)    위치 · 만남 · 유출 · 사칭 검사 → 걸리면 고정 거절 문장
 *  10. 저장        record_ai_exchange(서버 키, …) — 근거 Moment는 DB가 다시 검증
 *  11. Memory     (켜져 있으면) 팬이 자기에 대해 말한 것 → 서버 필터 → record_fan_memories (DB가 ON · 민감정보 재확인)
 *
 * 팬 메시지 내용은 1~5단계에 쓰이지 않는다 → prompt injection으로 권한 · 데이터 범위가 바뀌지 않는다.
 * service role은 쓰지 않는다 — 팬의 JWT + AI_SERVER_KEY.
 * Provider가 아직 설정되지 않았으면 LLM을 부르지 않고 저장도 하지 않는다 (reply: null · status: provider_not_configured).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auditAi, type AiAuditEvent, type AiResponseMeta } from "@/lib/ai/audit";
import { AiConfigError, getAiServerKey } from "@/lib/ai/config";
import { contextTypesOf, createContextBuilder, loadPersona, loadRecentConversation, PersonaAccessError, type PersonaDenial } from "@/lib/ai/context";
import { fallbackReply, postcheck, postFallbackReply, precheck, type GuardTopic } from "@/lib/ai/guard";
import { applyLearnedStyle, buildPersonaPrompt, CONVERSATION_WINDOW, parseModelOutput } from "@/lib/ai/prompt";
import { filterMemoryCandidates, loadFanMemory, saveFanMemories, type FanMemoryContext } from "@/lib/ai/memory";
import { getPersonaProvider, ProviderError } from "@/lib/ai/provider";
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
  persona_disabled: "이 크리에이터는 지금 Creator AI를 쓰지 않아요.",
  persona_not_configured: "이 크리에이터의 Creator AI가 아직 준비되지 않았어요.",
  own_channel: "내 채널의 Creator AI와는 대화할 수 없어요.",
  subscription_required: "Creator AI 대화는 구독자에게 열려요.",
  blocked: "지금은 이 크리에이터와 대화할 수 없어요.",
  ai_notice_required: "AI Avatar와 대화하기 전에 안내를 확인해 주세요.",
  rate_limited: "잠시 후 다시 시도해 주세요.",
  ai_unavailable: "Creator AI가 잠시 답할 수 없어요. 잠시 후 다시 시도해 주세요.",
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

const KST_TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

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
    const serverKey = getAiServerKey();

    // 3. 권한 + Persona (DB가 판단 · 팬의 JWT + 서버 키)
    let persona;
    try {
      // 말투는 크리에이터가 직접 쓴 학습 답변에서 (예전 설정 칸보다 우선)
      persona = applyLearnedStyle(await loadPersona(sb, serverKey, input.creatorId));
    } catch (e) {
      if (e instanceof PersonaAccessError) {
        const status = e.code === "creator_not_found" ? 404 : 403;
        return fail(requestId, status, e.code satisfies PersonaDenial, { outcome: status === 404 ? "not_found" : "forbidden", creatorId: input.creatorId });
      }
      throw e;
    }

    // 4. 횟수 제한 (Postgres)
    const limit = await aiRateLimiter(sb).consume(persona.creator.id);
    if (!limit.allowed) {
      const retryAfter = Math.max(1, Math.ceil((Date.parse(limit.resetAt) - Date.now()) / 1000));
      return fail(
        requestId,
        429,
        "rate_limited",
        { outcome: "rate_limited", creatorId: persona.creator.id },
        { resetAt: limit.resetAt, rule: limit.rule },
        { "Retry-After": String(retryAfter) },
      );
    }

    // 5. Context (팬 세션 + RLS)
    const [ctx, conversation, fanMemory] = await Promise.all([
      createContextBuilder(sb, persona.creator).build({
        creatorId: persona.creator.id,
        fanId: user.id,
        conversationId: input.conversationId,
        focusMomentId: input.momentId,
      }),
      loadRecentConversation(sb, user.id, persona.creator.id, CONVERSATION_WINDOW),
      // Memory를 못 읽으면 "꺼짐"과 같게 (답은 계속 — Memory 없이)
      loadFanMemory(sb, serverKey, persona.creator.id, input.message).catch((e): FanMemoryContext => {
        console.error("[momenty/ai] fan memory load failed", requestId, e instanceof Error ? e.name : "unknown");
        return { enabled: false, items: [] };
      }),
    ]);

    // 6. 경계(전)
    const declineTopic: GuardTopic | null = precheck(input.message, persona.boundaries);

    // 7. Prompt
    const prompt = buildPersonaPrompt({
      persona,
      today: ctx.today.items,
      focus: ctx.focus,
      conversation,
      userMessage: input.message,
      declineTopic,
      nowLabel: KST_TIME.format(new Date()),
      fanMemory,
    });
    const memoryUsed = declineTopic ? [] : fanMemory.items;
    const contextTypes = declineTopic
      ? (["style", "personality", "boundaries"] as const)
      : ([
          "style",
          "personality",
          ...(persona.facts.length ? (["facts"] as const) : []),
          "boundaries",
          ...contextTypesOf(ctx).filter((t): t is "today" | "focus" => t === "today" || t === "focus"),
          ...(memoryUsed.length ? (["fan_memory"] as const) : []),
          ...(conversation.length ? (["conversation"] as const) : []),
        ] as const);

    const meta: AiResponseMeta = {
      author: "ai",
      persona: { creatorId: persona.creator.id, name: persona.creator.name },
      generated: false,
      provider: null,
      model: null,
      context: {
        types: [...contextTypes],
        momentIds: declineTopic ? [] : [...prompt.momentAliases.values()],
        focusMomentId: declineTopic ? null : (ctx.focus?.id ?? null),
      },
      guard: declineTopic ? { stage: "pre", topic: declineTopic } : null,
      memory: { enabled: fanMemory.enabled, used: memoryUsed.length, saved: 0 },
    };

    // 8. Provider
    const provider = getPersonaProvider();
    if (!provider) {
      auditAi({ event: "ai_chat", requestId, outcome: "ok", status: 200, creatorId: persona.creator.id, messageLength: input.message.length, contextTypes: meta.context.types, contextCount: meta.context.momentIds.length });
      return NextResponse.json(
        { ok: true, requestId, reply: null, status: "provider_not_configured", meta, rateLimit: { remaining: limit.remaining, resetAt: limit.resetAt } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let replyText: string;
    let groundedIds: string[] = [];
    let boundary: string | null = declineTopic;
    let memoryCandidates: unknown[] = [];
    try {
      const out = await provider.generatePersonaReply({ system: prompt.system, messages: prompt.messages, maxTokens: prompt.maxTokens, requestId });
      if (out.refused) {
        replyText = fallbackReply("platform_safety", persona.style.formality, persona.creator.name);
        boundary = "platform_safety";
      } else {
        const parsedOut = parseModelOutput(out.text, prompt.momentAliases);
        replyText = parsedOut.reply;
        groundedIds = declineTopic ? [] : parsedOut.momentIds;
        memoryCandidates = parsedOut.memories;
      }
      meta.generated = true;
      meta.provider = out.provider;
      meta.model = out.model;
    } catch (e) {
      if (e instanceof ProviderError) {
        console.error("[momenty/ai] provider failed", requestId, e.message);
        return fail(requestId, 503, "ai_unavailable", { outcome: "error", creatorId: persona.creator.id });
      }
      throw e;
    }

    // 9. 경계(후) — 걸리면 모델의 답은 버린다
    // 모델이 본 근거 원문 — 여기 없는 장소 이름은 추측으로 본다
    const groundText = [
      ...(declineTopic ? [] : ctx.today.items.flatMap((m) => [m.content, m.location ?? ""])),
      ...(declineTopic || !ctx.focus ? [] : [ctx.focus.content, ctx.focus.location ?? ""]),
      ...persona.facts.map((f) => f.content),
      ...conversation.map((t) => t.content),
      ...memoryUsed.map((m) => m.content),
      input.message,
    ].join("\n");
    const violation = postcheck({ reply: replyText, boundaries: persona.boundaries, creatorName: persona.creator.name, facts: persona.facts.map((f) => f.content), groundText, places: declineTopic ? [] : [...ctx.today.items, ...(ctx.focus ? [ctx.focus] : [])].flatMap((m) => (m.location ? [m.location] : [])), memories: memoryUsed.map((m) => m.content) });
    if (violation || !replyText.trim()) {
      const topic = violation ?? "leak";
      replyText = postFallbackReply(topic, { message: input.message, formality: persona.style.formality, laughKk: persona.style.laughKk, creatorName: persona.creator.name });
      meta.guard = { stage: "post", topic };
      memoryCandidates = [];
      groundedIds = [];
      boundary = topic === "leak" || topic === "impersonation" ? boundary : topic;
    }
    replyText = replyText.slice(0, 4000);

    // 10. 저장 (근거 Moment는 DB가 다시 걸러낸다)
    const { data: saved, error: saveError } = await sb.rpc("record_ai_exchange", {
      p_server_key: serverKey,
      p_creator_id: persona.creator.id,
      p_fan_message: input.message,
      p_ai_reply: replyText,
      p_grounded_moment_ids: groundedIds,
      p_context_types: meta.context.types,
      p_provider: meta.provider,
      p_model: meta.model,
      p_boundary: boundary,
    });
    if (saveError) throw saveError;
    meta.context.momentIds = (saved as { groundedMomentIds: string[] }).groundedMomentIds;

    // 11. Fan Memory — 켜져 있고, 거절 모드 · 가드 개입이 아닐 때만. 실패해도 답은 그대로 (이미 저장됨)
    if (fanMemory.enabled && !declineTopic) {
      const items = filterMemoryCandidates(memoryCandidates, persona.creator.name);
      if (items.length) {
        try {
          meta.memory.saved = await saveFanMemories(sb, serverKey, persona.creator.id, items, (saved as { fanMessageId: string }).fanMessageId);
        } catch (e) {
          console.error("[momenty/ai] fan memory save failed", requestId, e instanceof Error ? e.name : "unknown");
        }
      }
    }

    auditAi({ event: "ai_chat", requestId, outcome: "ok", status: 200, creatorId: persona.creator.id, messageLength: input.message.length, contextTypes: meta.context.types, contextCount: meta.context.momentIds.length, guard: meta.guard ? `${meta.guard.stage}:${meta.guard.topic}` : undefined, memoryUsed: meta.memory.used, memorySaved: meta.memory.saved });
    return NextResponse.json(
      {
        ok: true,
        requestId,
        reply: replyText,
        status: "generated",
        conversationId: (saved as { conversationId: string }).conversationId,
        message: { id: (saved as { aiMessageId: string }).aiMessageId, sender: "ai", content: replyText, boundary, groundedMomentIds: meta.context.momentIds },
        meta,
        rateLimit: { remaining: limit.remaining, resetAt: limit.resetAt },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof AiConfigError) console.error("[momenty/ai] server config missing", requestId, e.missing);
    else console.error("[momenty/ai] request failed", requestId, e instanceof Error ? e.name : "unknown");
    return fail(requestId, 500, "error", { outcome: "error" });
  }
}

/** POST만 받는다 */
export function GET() {
  return NextResponse.json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405, headers: { Allow: "POST" } });
}
