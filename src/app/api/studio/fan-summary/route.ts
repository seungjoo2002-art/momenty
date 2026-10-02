/**
 * POST /api/studio/fan-summary { fanId } — 크리에이터가 보는 "AI 팬 요약" (v0.9). 크리에이터가 버튼을 눌렀을 때만 부른다.
 *
 *   1. 인증 · 같은 Origin · 서버 설정 AI_FAN_SUMMARY=on (기본 꺼짐 → 503 ai_summary_off)
 *   2. 입력 모으기: lib/ai/fanSummary.ts collectFanSummaryInput — 크리에이터 본인 세션으로만 (service role 없음)
 *        fan_manager_fan(safe projection) · human_messages(RLS) · creator_fan_ai_messages(열람 안내 확인 이후만)
 *      Fan Memory 원문 · 내 메모 · 안내 확인 전 AI 대화는 읽지 않는다.
 *   3. Rate limit — consume_ai_rate_limit(서버 키, 내 채널) · DB 공유 저장소 (요청자 JWT 기준)
 *   4. LLM 1회 → 문장마다 추론 · 민감 판단 필터. 남는 문장이 없거나 거절이면 실패 (가짜 결과 없음 · 다른 모델로 재시도 없음)
 *
 * 규칙 기반 사실 요약은 이 Route를 거치지 않는다 — 화면이 이미 받은 데이터로 lib/fanSummary.ts buildFanSummary()를 쓴다.
 * 결과는 저장하지 않는다 (요약 저장 테이블 없음 — 저장하려면 migration 필요).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AiConfigError } from "@/lib/ai/config";
import { collectFanSummaryInput, FanSummaryAccessError, generateAiFanSummary } from "@/lib/ai/fanSummary";
import { getPersonaProvider } from "@/lib/ai/provider";
import { aiRateLimiter } from "@/lib/ai/rateLimit";
import type { AiFanSummary } from "@/lib/fanSummary";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const schema = z.object({ fanId: z.string().uuid() }).strict();

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

const fail = (status: number, code: string, message: string) => NextResponse.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
const UNAVAILABLE = "지금은 AI 팬 요약을 만들 수 없어요.";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    if (!sameOrigin(req)) return fail(403, "forbidden_origin", "허용되지 않은 요청이에요.");
    const sb = await createServerSupabase();
    const { data: auth, error: authError } = await sb.auth.getUser();
    if (authError || !auth.user) return fail(401, "unauthenticated", "로그인이 필요해요.");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid_input", "요청 형식이 올바르지 않아요.");
    const { fanId } = parsed.data;

    // 크리에이터 · 내 팬인지는 DB 함수가 확인한다 (not_a_creator · fan_not_found)
    let input;
    try {
      input = await collectFanSummaryInput(sb, fanId);
    } catch (e) {
      if (e instanceof FanSummaryAccessError) {
        return e.code === "not_a_creator" ? fail(403, "not_a_creator", "크리에이터만 볼 수 있어요.") : fail(404, "fan_not_found", "이 채널과 연결된 팬이 아니에요.");
      }
      throw e;
    }

    if (process.env.AI_FAN_SUMMARY !== "on") return fail(503, "ai_summary_off", UNAVAILABLE);
    const provider = getPersonaProvider();
    if (!provider) return fail(503, "ai_unavailable", UNAVAILABLE);

    const { data: channel, error: channelError } = await sb.from("creators").select("id").eq("profile_id", auth.user.id).maybeSingle();
    if (channelError) throw channelError;
    if (!channel) return fail(403, "not_a_creator", "크리에이터만 볼 수 있어요.");
    const limit = await aiRateLimiter(sb).consume(channel.id as string);
    if (!limit.allowed) return fail(429, "rate_limited", "잠시 후 다시 정리해 주세요.");

    const r = await generateAiFanSummary(provider, input, requestId);
    if (!r.ok) {
      console.warn("[momenty/fan-summary] no usable summary", requestId, r.reason);
      return fail(502, "summary_failed", "요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    const summary: AiFanSummary = { sentences: r.sentences, generatedAt: new Date().toISOString() };
    return NextResponse.json({ ok: true, requestId, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AiConfigError) {
      console.error("[momenty/fan-summary] config missing", requestId, e.missing);
      return fail(503, "ai_unavailable", UNAVAILABLE);
    }
    console.error("[momenty/fan-summary] failed", requestId, e instanceof Error ? e.name : "unknown");
    return fail(500, "error", "잠시 후 다시 시도해 주세요.");
  }
}

export function GET() {
  return NextResponse.json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405, headers: { Allow: "POST" } });
}
