/**
 * Creator AI Avatar (Studio) — 크리에이터 본인 세션으로만.
 *
 * 쓰기는 모두 DB 함수다 (채널은 auth.uid()로 DB가 정한다 — 인자로 넘기지 않는다).
 *   save_avatar_basics · save_style_answers · add_style_training · reset_style_training · confirm_avatar_boundaries · save_welcome_message
 * 말투 학습 답변은 고칠 수 없다 — 다시 답하기(보관 후 새 행) · 추가 학습 · 전체 초기화만.
 * AI 문답 ON은 creators.persona_enabled — 준비가 끝나지 않았으면 DB가 거부한다(avatar_not_ready).
 */
import { supabase } from "@/lib/supabase/client";
import {
  BASIC_KEYS,
  parseBasicContent,
  type AvatarReadiness,
  type BasicKey,
  type BasicValue,
  type SampleSource,
  type StyleSample,
  type TrainingPrompt,
} from "@/lib/avatar";
import type { Trait } from "@/lib/persona";
import { invalidateCreators } from "./creators";
import { ServiceError, toServiceError } from "./errors";

export const AVATAR_NOT_READY_MESSAGE = "AI Avatar를 사용하려면 먼저 기본정보와 말투 학습을 완료해 주세요.";

function rpcError(e: { message?: string; code?: string } | null, fallback: string): ServiceError {
  const msg = e?.message ?? "";
  if (/avatar_not_ready/.test(msg)) return new ServiceError(AVATAR_NOT_READY_MESSAGE, "forbidden", e);
  if (/not_a_creator/.test(msg)) return new ServiceError("크리에이터만 할 수 있어요.", "forbidden", e);
  if (/confirmation_required/.test(msg)) return new ServiceError("확인 문구를 정확히 입력해 주세요.", "invalid", e);
  if (/style sample limit/.test(msg)) return new ServiceError("학습 답변이 최대 개수(2,000개)에 도달했어요. 기존 답은 그대로 보관돼 있어요.", "invalid", e);
  if (/too many samples/.test(msg)) return new ServiceError("학습 답변이 너무 많아요. 초기화 후 다시 학습해 주세요.", "invalid", e);
  if (/invalid (job|value|reply|fan message|draft|message)/.test(msg)) return new ServiceError("입력한 내용을 확인해 주세요.", "invalid", e);
  return toServiceError(e, fallback);
}

export async function getAvatarReadiness(): Promise<AvatarReadiness> {
  const { data, error } = await supabase().rpc("avatar_readiness");
  if (error) throw rpcError(error, "AI Avatar 상태를 불러오지 못했어요.");
  return data as AvatarReadiness;
}

export interface AvatarOverview {
  enabled: boolean;
  readiness: AvatarReadiness;
  traits: Trait[];
  welcomeMessage: string;
  /** 'auto' = 직접 쓴 문구 → 없으면 AI ON이면 기본 AI 환영 · 'off' = MOMENTY 구독 안내만 (v0.8.5b 전 DB면 'auto') */
  welcomeMode: WelcomeMode;
  boundariesConfirmedAt: string | null;
}

export type WelcomeMode = "auto" | "off";

export async function getAvatarOverview(creatorId: string): Promise<AvatarOverview> {
  const sb = supabase();
  const [creator, readiness, persona, settings] = await Promise.all([
    sb.from("creators").select("persona_enabled").eq("id", creatorId).single(),
    getAvatarReadiness(),
    sb.from("creator_personas").select("traits").eq("creator_id", creatorId).maybeSingle(),
    // welcome_mode는 v0.8.5b migration 컬럼 — 적용 전 DB에서도 깨지지 않게 * 로 읽는다
    sb.from("creator_avatar_settings").select("*").eq("creator_id", creatorId).maybeSingle(),
  ]);
  for (const r of [creator, persona, settings]) if (r.error) throw toServiceError(r.error, "AI Avatar 설정을 불러오지 못했어요.");
  return {
    enabled: creator.data!.persona_enabled as boolean,
    readiness,
    traits: ((persona.data?.traits as Trait[] | undefined) ?? []),
    welcomeMessage: (settings.data?.welcome_message as string | undefined) ?? "",
    welcomeMode: settings.data?.welcome_mode === "off" ? "off" : "auto",
    boundariesConfirmedAt: (settings.data?.boundaries_confirmed_at as string | undefined) ?? null,
  };
}

/** AI 문답 ON/OFF — ON은 DB가 준비 상태를 확인한다 */
export async function setAvatarEnabled(creatorId: string, enabled: boolean): Promise<void> {
  const { data, error } = await supabase().from("creators").update({ persona_enabled: enabled }).eq("id", creatorId).select("id");
  if (error) throw rpcError(error, "저장하지 못했어요.");
  if (!data?.length) throw new ServiceError("내 채널 설정만 바꿀 수 있어요.", "forbidden");
  invalidateCreators();
}

/* ---------- STEP 1 기본정보 ---------- */

export interface AvatarBasics {
  job: string;
  values: Record<BasicKey, BasicValue>;
}

export async function getAvatarBasics(creatorId: string): Promise<AvatarBasics> {
  const sb = supabase();
  const [creator, facts] = await Promise.all([
    sb.from("creators").select("job").eq("id", creatorId).single(),
    sb.from("creator_facts").select("basic_key, content, undisclosed").eq("creator_id", creatorId).not("basic_key", "is", null),
  ]);
  if (creator.error) throw toServiceError(creator.error, "기본정보를 불러오지 못했어요.");
  if (facts.error) throw toServiceError(facts.error, "기본정보를 불러오지 못했어요.");
  const values = Object.fromEntries(BASIC_KEYS.map((k) => [k, { value: "", undisclosed: false }])) as Record<BasicKey, BasicValue>;
  for (const f of (facts.data ?? []) as { basic_key: BasicKey; content: string; undisclosed: boolean }[]) {
    values[f.basic_key] = parseBasicContent(f.basic_key, f.content, f.undisclosed);
  }
  return { job: (creator.data.job as string) ?? "", values };
}

export async function saveAvatarBasics(job: string, values: Partial<Record<BasicKey, BasicValue>>): Promise<AvatarReadiness> {
  const items = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, { value: v!.undisclosed ? "" : v!.value.trim(), undisclosed: v!.undisclosed }]),
  );
  const { data, error } = await supabase().rpc("save_avatar_basics", { p_job: job.trim(), p_items: items });
  if (error) throw rpcError(error, "기본정보를 저장하지 못했어요.");
  invalidateCreators();
  return data as AvatarReadiness;
}

/* ---------- STEP 2 말투 학습 ---------- */

export async function getTrainingPrompts(): Promise<TrainingPrompt[]> {
  const { data, error } = await supabase().from("avatar_training_prompts").select("key, category, fan_message, sort, required").order("sort");
  if (error) throw toServiceError(error, "학습 질문을 불러오지 못했어요.");
  return ((data ?? []) as { key: string; category: TrainingPrompt["category"]; fan_message: string; sort: number; required: boolean }[]).map((p) => ({
    key: p.key,
    category: p.category,
    fanMessage: p.fan_message,
    sort: p.sort,
    required: p.required,
  }));
}

/** 내 학습 답변 (보관된 것 포함 여부 선택) — 최신순 */
export async function getStyleSamples(creatorId: string, includeArchived = false): Promise<StyleSample[]> {
  let q = supabase()
    .from("creator_style_samples")
    .select("id, source, prompt_key, fan_message, reply, ai_draft, created_at, archived_at")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw toServiceError(error, "학습 답변을 불러오지 못했어요.");
  return ((data ?? []) as { id: string; source: SampleSource; prompt_key: string | null; fan_message: string; reply: string; ai_draft: string | null; created_at: string; archived_at: string | null }[]).map((s) => ({
    id: s.id,
    source: s.source,
    promptKey: s.prompt_key,
    fanMessage: s.fan_message,
    reply: s.reply,
    aiDraft: s.ai_draft,
    createdAt: s.created_at,
    archivedAt: s.archived_at,
  }));
}

/** 처음 학습 답변 저장 (같은 질문에 다시 답하면 이전 답은 보관된다) */
export async function saveStyleAnswers(items: { key: string; reply: string }[]): Promise<AvatarReadiness> {
  const list = items.map((i) => ({ key: i.key, reply: i.reply.trim() })).filter((i) => i.reply);
  if (!list.length) throw new ServiceError("답을 입력해 주세요.", "invalid");
  const { data, error } = await supabase().rpc("save_style_answers", { p_items: list });
  if (error) throw rpcError(error, "답변을 저장하지 못했어요.");
  return data as AvatarReadiness;
}

/** 추가 학습 · AI 답 고침 (선택) */
export async function addStyleTraining(input: { fanMessage: string; reply: string; source?: "avatar_training" | "creator_correction"; aiDraft?: string }): Promise<void> {
  const { error } = await supabase().rpc("add_style_training", {
    p_fan_message: input.fanMessage.trim(),
    p_reply: input.reply.trim(),
    p_source: input.source ?? "avatar_training",
    p_ai_draft: input.aiDraft ?? null,
  });
  if (error) throw rpcError(error, "학습 답변을 저장하지 못했어요.");
}

/** 말투 학습 전체 초기화 — confirm은 정확히 "초기화". 기록은 보관되고 AI 문답은 꺼진다 */
export async function resetStyleTraining(confirm: string): Promise<number> {
  const { data, error } = await supabase().rpc("reset_style_training", { p_confirm: confirm });
  if (error) throw rpcError(error, "초기화하지 못했어요.");
  invalidateCreators();
  return data as number;
}

/* ---------- STEP 3 Avatar 확인 ---------- */

/** 성향 (Persona 행이 없으면 만든다 — 말투 칸은 쓰지 않는다) */
export async function saveAvatarTraits(creatorId: string, traits: Trait[]): Promise<void> {
  const sb = supabase();
  const up = await sb.from("creator_personas").update({ traits }).eq("creator_id", creatorId).select("creator_id");
  if (up.error) throw toServiceError(up.error, "저장하지 못했어요.");
  if (!up.data?.length) {
    const ins = await sb.from("creator_personas").insert({ creator_id: creatorId, traits });
    if (ins.error && ins.error.code !== "23505") throw toServiceError(ins.error, "저장하지 못했어요.");
  }
}

export async function confirmAvatarBoundaries(): Promise<void> {
  const { error } = await supabase().rpc("confirm_avatar_boundaries");
  if (error) throw rpcError(error, "저장하지 못했어요.");
}

/* ---------- 구독 환영 메시지 ---------- */

export const WELCOME_MAX = 500;

/** 환영 메시지 켜기/끄기 — 끄면 크리에이터 문구 · 기본 AI 환영 대신 MOMENTY 구독 안내만 */
export async function setWelcomeMode(mode: WelcomeMode): Promise<WelcomeMode> {
  const { data, error } = await supabase().rpc("set_welcome_mode", { p_mode: mode });
  if (error) throw rpcError(error, "저장하지 못했어요.");
  return data as WelcomeMode;
}

export async function saveWelcomeMessage(message: string): Promise<string> {
  const { data, error } = await supabase().rpc("save_welcome_message", { p_message: message });
  if (error) throw rpcError(error, "저장하지 못했어요.");
  return data as string;
}
