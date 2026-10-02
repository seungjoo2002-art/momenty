/**
 * 크리에이터용 팬 요약 — 서버 전용. 요약 입력을 모으는 곳은 여기 한 군데뿐이다 (Route · 테스트가 같은 함수를 쓴다).
 *
 * 크리에이터 본인 세션(sb: 쿠키 세션 클라이언트)으로만 읽는다 — service role 없음:
 *   · fan_manager_fan()          safe projection: 플랜 · 시작일 · 반응 수 · 팬이 명시적으로 공유한 정보 (내 팬이 아니면 fan_not_found)
 *   · human_messages             RLS: 대화 참여자만
 *   · creator_fan_ai_messages()  팬이 열람 안내를 확인한 "최근 시각 이후"의 AI 대화만 (취소하면 0개 · 재확인하면 그 뒤만)
 * 읽지 않는 것: fan_memories(Fan Memory 원문) · creator_fan_notes(내 메모) · ai_messages 직접 조회 · boundary 같은 내부 표시.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiFanSummaryPrompt, parseAiFanSummaryOutput, summaryInputFrom, type SummaryFanFacts, type SummaryInput } from "@/lib/fanSummary";
import type { PersonaProvider } from "./provider";

export class FanSummaryAccessError extends Error {
  constructor(readonly code: "not_a_creator" | "fan_not_found") {
    super(code);
    this.name = "FanSummaryAccessError";
  }
}

/** 요약에 쓰는 대화 개수 (직접 · AI 각각 최근 것부터) */
const MESSAGE_LIMIT = 50;

export async function collectFanSummaryInput(sb: SupabaseClient, fanId: string): Promise<SummaryInput> {
  const fan = await sb.rpc("fan_manager_fan", { p_fan_id: fanId });
  if (fan.error) {
    if (/not_a_creator/.test(fan.error.message)) throw new FanSummaryAccessError("not_a_creator");
    if (/fan_not_found/.test(fan.error.message)) throw new FanSummaryAccessError("fan_not_found");
    throw fan.error;
  }
  const f = fan.data as SummaryFanFacts & { conversationId: string | null };

  const [human, ai] = await Promise.all([
    f.conversationId
      ? sb.from("human_messages").select("sender_type, content, created_at").eq("conversation_id", f.conversationId).order("created_at", { ascending: false }).limit(MESSAGE_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    sb.rpc("creator_fan_ai_messages", { p_fan_id: fanId, p_limit: MESSAGE_LIMIT }),
  ]);
  if (human.error) throw human.error;
  if (ai.error) throw ai.error;

  const humanRows = (human.data ?? []) as { sender_type: "fan" | "creator"; content: string; created_at: string }[];
  return summaryInputFrom(
    f,
    humanRows.map((m) => ({ sender: m.sender_type, content: m.content, createdAt: m.created_at })),
    ai.data as { consented: boolean; agreedAt: string | null; messages: { sender: "fan" | "ai"; content: string; createdAt: string }[] },
  );
}

export type AiFanSummaryResult = { ok: true; sentences: string[]; model: string } | { ok: false; reason: "refused" | "unusable" };

/** LLM 1회. 거절(refusal)은 그대로 실패 — 다른 모델로 다시 부르지 않는다. 걸러지고 남은 문장이 없으면 실패 */
export async function generateAiFanSummary(provider: PersonaProvider, input: SummaryInput, requestId: string): Promise<AiFanSummaryResult> {
  const p = aiFanSummaryPrompt(input);
  const out = await provider.generateFanSummary({ system: p.system, user: p.user, requestId });
  if (out.refused) return { ok: false, reason: "refused" };
  const sentences = parseAiFanSummaryOutput(out.text);
  return sentences ? { ok: true, sentences, model: out.model } : { ok: false, reason: "unusable" };
}
