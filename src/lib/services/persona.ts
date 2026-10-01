/**
 * Creator Persona 설정 — 크리에이터 본인 세션으로만 (RLS: creator_personas · creator_facts · creator_boundaries는 본인만).
 * 팬은 이 테이블을 읽을 수 없다. 팬과의 대화에 필요한 값은 서버(/api/ai/chat)가 ai_persona_context()로만 가져간다.
 *
 * 저장은 "update → 없으면 insert" — 테이블이 creator_id · topic 수정을 막아 두어 upsert(모든 컬럼 덮어쓰기)는 거부된다.
 */
import { supabase } from "@/lib/supabase/client";
import {
  BOUNDARY_TOPICS,
  defaultBoundaries,
  defaultStyle,
  LIMITS,
  type Boundaries,
  type BoundaryTopic,
  type CreatorFact,
  type FactCategory,
  type PersonaPersonality,
  type PersonaStyle,
  type Trait,
} from "@/lib/persona";
import { invalidateCreators } from "./creators";
import { ServiceError, toServiceError } from "./errors";

export interface PersonaSettings {
  enabled: boolean;
  /** creator_personas 행이 있는지 — 없으면 팬이 대화를 시작할 수 없다 */
  configured: boolean;
  style: PersonaStyle;
  personality: PersonaPersonality;
  facts: CreatorFact[];
  boundaries: Boundaries;
}

interface PersonaRow {
  formality: PersonaStyle["formality"];
  reply_length: PersonaStyle["replyLength"];
  laugh_kk: boolean;
  laugh_hh: boolean;
  emoji_level: PersonaStyle["emojiLevel"];
  phrases: string[];
  mood: string;
  example_messages: string[];
  traits: Trait[];
}

export async function getPersonaSettings(creatorId: string): Promise<PersonaSettings> {
  try {
    const sb = supabase();
    const [creator, persona, facts, boundaries] = await Promise.all([
      sb.from("creators").select("persona_enabled").eq("id", creatorId).single(),
      sb.from("creator_personas").select("formality, reply_length, laugh_kk, laugh_hh, emoji_level, phrases, mood, example_messages, traits").eq("creator_id", creatorId).maybeSingle(),
      // 기본정보(basic_key)는 AI Avatar › 기본정보에서 따로 관리한다
      sb.from("creator_facts").select("id, category, content, active, last_verified_at").eq("creator_id", creatorId).is("basic_key", null).order("created_at"),
      sb.from("creator_boundaries").select("topic, allowed").eq("creator_id", creatorId),
    ]);
    for (const r of [creator, persona, facts, boundaries]) if (r.error) throw r.error;
    const p = persona.data as PersonaRow | null;
    const b = defaultBoundaries();
    for (const row of (boundaries.data ?? []) as { topic: BoundaryTopic; allowed: boolean }[]) b[row.topic] = row.allowed;
    return {
      enabled: creator.data!.persona_enabled as boolean,
      configured: !!p,
      style: p
        ? { formality: p.formality, replyLength: p.reply_length, laughKk: p.laugh_kk, laughHh: p.laugh_hh, emojiLevel: p.emoji_level, phrases: p.phrases, mood: p.mood, examples: p.example_messages }
        : defaultStyle(),
      personality: { traits: p?.traits ?? [] },
      facts: ((facts.data ?? []) as { id: string; category: FactCategory; content: string; active: boolean; last_verified_at: string }[]).map((f) => ({
        id: f.id,
        category: f.category,
        content: f.content,
        active: f.active,
        lastVerifiedAt: f.last_verified_at,
      })),
      boundaries: b,
    };
  } catch (e) {
    throw toServiceError(e, "Persona 설정을 불러오지 못했어요.");
  }
}

export function validateStyle(style: PersonaStyle, personality: PersonaPersonality): string | null {
  const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
  if (clean(style.phrases).length > LIMITS.phrases) return `자주 쓰는 표현은 ${LIMITS.phrases}개까지예요.`;
  if (clean(style.phrases).some((x) => x.length > LIMITS.phraseLength)) return `표현 하나는 ${LIMITS.phraseLength}자까지예요.`;
  if (clean(style.examples).length > LIMITS.examples) return `예시 메시지는 ${LIMITS.examples}개까지예요.`;
  if (clean(style.examples).some((x) => x.length > LIMITS.exampleLength)) return `예시 메시지 하나는 ${LIMITS.exampleLength}자까지예요.`;
  if (style.mood.length > LIMITS.mood) return `분위기는 ${LIMITS.mood}자까지예요.`;
  if (personality.traits.length > LIMITS.traits) return `성향은 ${LIMITS.traits}개까지 고를 수 있어요.`;
  return null;
}

/** 말투 + 성향 저장 (처음 저장하면 Persona가 "설정됨"이 되어 팬이 대화를 시작할 수 있다) */
export async function savePersona(creatorId: string, style: PersonaStyle, personality: PersonaPersonality): Promise<void> {
  const invalid = validateStyle(style, personality);
  if (invalid) throw new ServiceError(invalid, "invalid");
  const row = {
    formality: style.formality,
    reply_length: style.replyLength,
    laugh_kk: style.laughKk,
    laugh_hh: style.laughHh,
    emoji_level: style.emojiLevel,
    phrases: style.phrases.map((x) => x.trim()).filter(Boolean),
    mood: style.mood.trim(),
    example_messages: style.examples.map((x) => x.trim()).filter(Boolean),
    traits: personality.traits,
  };
  try {
    const sb = supabase();
    const up = await sb.from("creator_personas").update(row).eq("creator_id", creatorId).select("creator_id");
    if (up.error) throw up.error;
    if (!up.data?.length) {
      const ins = await sb.from("creator_personas").insert({ creator_id: creatorId, ...row });
      if (ins.error) throw ins.error;
    }
  } catch (e) {
    throw toServiceError(e, "저장하지 못했어요.");
  }
}

export async function setPersonaEnabled(creatorId: string, enabled: boolean): Promise<void> {
  try {
    const { data, error } = await supabase().from("creators").update({ persona_enabled: enabled }).eq("id", creatorId).select("id");
    if (error) throw error;
    if (!data?.length) throw new ServiceError("내 크리에이터 설정만 바꿀 수 있어요.", "forbidden");
    invalidateCreators();
  } catch (e) {
    throw toServiceError(e, "저장하지 못했어요.");
  }
}

export async function setBoundary(creatorId: string, topic: BoundaryTopic, allowed: boolean): Promise<void> {
  if (!BOUNDARY_TOPICS.includes(topic)) throw new ServiceError("알 수 없는 주제예요.", "invalid");
  try {
    const sb = supabase();
    const up = await sb.from("creator_boundaries").update({ allowed }).eq("creator_id", creatorId).eq("topic", topic).select("topic");
    if (up.error) throw up.error;
    if (!up.data?.length) {
      const ins = await sb.from("creator_boundaries").insert({ creator_id: creatorId, topic, allowed });
      // 동시에 두 번 눌러 이미 생긴 경우 → 다시 update
      if (ins.error?.code === "23505") {
        const again = await sb.from("creator_boundaries").update({ allowed }).eq("creator_id", creatorId).eq("topic", topic);
        if (again.error) throw again.error;
      } else if (ins.error) throw ins.error;
    }
  } catch (e) {
    throw toServiceError(e, "저장하지 못했어요.");
  }
}

/* ---------- Verified Facts ---------- */

function checkFact(content: string) {
  const c = content.trim();
  if (!c) throw new ServiceError("내용을 입력해 주세요.", "invalid");
  if (c.length > LIMITS.factLength) throw new ServiceError(`사실 하나는 ${LIMITS.factLength}자까지예요.`, "invalid");
  return c;
}

function factError(e: unknown, fallback: string) {
  const err = e as { code?: string; message?: string };
  if (err?.code === "23514" && /too many/.test(err.message ?? "")) return new ServiceError(`활성 사실은 ${LIMITS.facts}개까지예요. 쓰지 않는 사실을 끄거나 지워 주세요.`, "invalid", e);
  return toServiceError(e, fallback);
}

export async function addFact(creatorId: string, category: FactCategory, content: string): Promise<void> {
  const c = checkFact(content);
  try {
    const { error } = await supabase().from("creator_facts").insert({ creator_id: creatorId, category, content: c });
    if (error) throw error;
  } catch (e) {
    throw factError(e, "추가하지 못했어요.");
  }
}

export async function updateFact(id: string, patch: { category?: FactCategory; content?: string; active?: boolean }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.category) row.category = patch.category;
  if (patch.content !== undefined) row.content = checkFact(patch.content);
  if (patch.active !== undefined) row.active = patch.active;
  try {
    const { data, error } = await supabase().from("creator_facts").update(row).eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ServiceError("이미 지워진 사실이에요.", "not_found");
  } catch (e) {
    throw factError(e, "저장하지 못했어요.");
  }
}

/** "지금도 사실이에요" — 확인 시각을 서버 시각으로 갱신 (보내는 값과 무관하게 DB가 now()로 저장) */
export async function reverifyFact(id: string): Promise<void> {
  try {
    const { error } = await supabase().from("creator_facts").update({ last_verified_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "저장하지 못했어요.");
  }
}

export async function deleteFact(id: string): Promise<void> {
  try {
    const { error } = await supabase().from("creator_facts").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "지우지 못했어요.");
  }
}
