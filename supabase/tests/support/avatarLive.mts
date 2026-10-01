/**
 * 실제 Supabase 테스트 준비 — 크리에이터 본인 세션으로 AI Avatar를 "준비 완료 + ON"으로 만든다 (v0.8.5).
 * 앱과 같은 경로(DB 함수)만 쓴다: save_avatar_basics · save_style_answers · creator_personas(traits) · confirm_avatar_boundaries.
 * service role을 쓰지 않는다.
 *
 * 팬은 AI 대화 전에 열람 안내를 확인해야 한다 → acknowledgeAiNotice(팬 세션, creatorId)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AvatarReadyOptions {
  job?: string;
  /** 기본정보 덮어쓰기. 기본값은 6개 모두 "공개하지 않음" — 테스트가 검사하는 사실(초밥 등)과 섞이지 않게 */
  basics?: Partial<Record<"favorite_food" | "disliked_food" | "hobby" | "interest" | "likes" | "dislikes", { value: string; undisclosed?: boolean }>>;
  traits?: string[];
  /** 질문 key → 답. 없는 질문은 기본 답 (반말 · 짧게) */
  replies?: Record<string, string>;
  /** 기본 답 만들기 (질문 문장 → 답) */
  defaultReply?: (fanMessage: string, i: number) => string;
}

export async function makeAvatarReady(sb: SupabaseClient, creatorId: string, opts: AvatarReadyOptions = {}) {
  const fail = (step: string, e: { message: string } | null) => {
    if (e) throw new Error(`AI Avatar 준비 실패 (${step}): ${e.message}`);
  };
  fail("basics", (await sb.rpc("save_avatar_basics", {
    p_job: opts.job ?? "크리에이터",
    p_items: {
      ...Object.fromEntries(["favorite_food", "disliked_food", "hobby", "interest", "likes", "dislikes"].map((k) => [k, { value: "", undisclosed: true }])),
      ...opts.basics,
    },
  })).error);
  const { data: prompts, error } = await sb.from("avatar_training_prompts").select("key, fan_message").order("sort");
  fail("prompts", error);
  const items = (prompts ?? []).map((p: { key: string; fan_message: string }, i: number) => ({
    key: p.key,
    reply: opts.replies?.[p.key] ?? opts.defaultReply?.(p.fan_message, i) ?? `응응 알겠어 ${i + 1}`,
  }));
  fail("answers", (await sb.rpc("save_style_answers", { p_items: items })).error);
  const up = await sb.from("creator_personas").update({ traits: opts.traits ?? ["warm"] }).eq("creator_id", creatorId).select("creator_id");
  fail("persona", up.error);
  if (!up.data?.length) fail("persona", (await sb.from("creator_personas").insert({ creator_id: creatorId, traits: opts.traits ?? ["warm"] })).error);
  fail("boundaries", (await sb.rpc("confirm_avatar_boundaries")).error);
  fail("enable", (await sb.from("creators").update({ persona_enabled: true }).eq("id", creatorId)).error);
}

export async function acknowledgeAiNotice(sb: SupabaseClient, creatorId: string) {
  const { error } = await sb.rpc("acknowledge_ai_notice", { p_creator_id: creatorId });
  if (error) throw new Error(`AI 대화 열람 안내 확인 실패: ${error.message}`);
}
