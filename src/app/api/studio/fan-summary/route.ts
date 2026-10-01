/**
 * POST /api/studio/fan-summary { fanId } — 크리에이터가 보는 팬 AI 요약.
 *
 *   1. 인증 · 같은 Origin
 *   2. 크리에이터 본인 세션으로만 읽는다 (service role 없음):
 *        fan_manager_fan(safe projection: 플랜 · 기간 · 공유 정보 · 반응 수) · human_messages(RLS: 참여자) ·
 *        creator_fan_ai_messages(팬이 열람 안내를 확인한 뒤의 AI 대화만)
 *      Fan Memory · 크리에이터 메모 · 안내 확인 전 AI 대화는 읽지 않는다.
 *   3. 규칙 기반 요약 (항상) — lib/fanSummary.ts
 *   4. (선택) LLM 한 줄 요약 — AI_FAN_SUMMARY=on 이고 Provider가 설정된 서버에서만. 기본 꺼짐.
 *      결과 문장은 추론 · 민감 판단 필터를 통과해야 한다. 실패해도 규칙 요약은 그대로 준다.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPersonaProvider } from "@/lib/ai/provider";
import { buildFanSummary, fanSummaryPrompt, parseFanSummaryOutput, type SummaryMessage } from "@/lib/fanSummary";
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
    const fan = await sb.rpc("fan_manager_fan", { p_fan_id: fanId });
    if (fan.error) {
      if (/not_a_creator/.test(fan.error.message)) return fail(403, "not_a_creator", "크리에이터만 볼 수 있어요.");
      if (/fan_not_found/.test(fan.error.message)) return fail(404, "fan_not_found", "이 채널과 연결된 팬이 아니에요.");
      throw fan.error;
    }
    const f = fan.data as {
      nickname: string;
      tier: string | null;
      subscribedAt: string | null;
      subscribedDays: number | null;
      reactions30d: number;
      lastReactionAt: string | null;
      conversationId: string | null;
      shares: { category: string; content: string; eventDate: string | null }[];
    };

    const [human, ai] = await Promise.all([
      f.conversationId
        ? sb.from("human_messages").select("sender_type, content, created_at").eq("conversation_id", f.conversationId).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [], error: null }),
      sb.rpc("creator_fan_ai_messages", { p_fan_id: fanId, p_limit: 50 }),
    ]);
    if (human.error) throw human.error;
    if (ai.error) throw ai.error;
    const aiConv = ai.data as { consented: boolean; messages: { sender: "fan" | "ai"; content: string; createdAt: string }[] };

    const messages: SummaryMessage[] = [
      ...((human.data ?? []) as { sender_type: "fan" | "creator"; content: string; created_at: string }[]).map((m) => ({ source: "human" as const, sender: m.sender_type, content: m.content, createdAt: m.created_at })),
      ...aiConv.messages.map((m) => ({ source: "ai" as const, sender: m.sender, content: m.content, createdAt: m.createdAt })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const input = { ...f, aiConsented: aiConv.consented, messages };
    const summary = buildFanSummary(input);

    // 선택: LLM 한 줄 요약 (기본 꺼짐 — 서버 설정 AI_FAN_SUMMARY=on)
    const provider = process.env.AI_FAN_SUMMARY === "on" && messages.length ? getPersonaProvider() : null;
    if (provider) {
      try {
        const p = fanSummaryPrompt(input);
        const out = await provider.generatePersonaReply({ system: p.system, messages: [{ role: "user", content: p.user }], maxTokens: 300, requestId });
        if (!out.refused) {
          const r = parseFanSummaryOutput(out.text);
          if (r.topics.length) summary.highlights.unshift(`주로 이야기한 주제: ${r.topics.join(" · ")}`);
          if (r.current) summary.current.unshift(`요약: ${r.current}`);
          summary.generated = r.topics.length > 0 || !!r.current;
        }
      } catch (e) {
        console.error("[momenty/fan-summary] provider failed", requestId, e instanceof Error ? e.name : "unknown");
      }
    }

    return NextResponse.json({ ok: true, requestId, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[momenty/fan-summary] failed", requestId, e instanceof Error ? e.name : "unknown");
    return fail(500, "error", "잠시 후 다시 시도해 주세요.");
  }
}

export function GET() {
  return NextResponse.json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405, headers: { Allow: "POST" } });
}
