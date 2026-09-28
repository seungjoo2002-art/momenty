/**
 * Persona AI Context Builder — Persona가 볼 수 있는 데이터는 이 파일이 만든 것뿐이다.
 *
 * 원칙
 *   · DB 전체를 읽지 않는다. 필요한 칸만, 요청한 사용자(팬)의 세션으로 읽는다 → RLS가 그대로 적용된다.
 *   · service role로 읽고 앱 코드에서 거르는 방식은 쓰지 않는다. 볼 수 없는 Moment는 DB가 애초에 돌려주지 않는다.
 *   · Moment는 ai_context_enabled = true 인 것만 (DB 쿼리 조건).
 *   · 팬의 메시지 내용은 어떤 데이터를 가져올지에 영향을 주지 않는다 (입력은 id뿐) → prompt injection으로 권한이 넓어지지 않는다.
 *
 * Persona가 쓸 수 있는 여섯 칸 — v0.5-1에서는 Today Context만 실제 데이터가 있다:
 *   1. style        크리에이터 Persona 말투         (저장소 없음 — v0.5-2)
 *   2. facts        크리에이터가 확인한 사실         (저장소 없음)
 *   3. boundaries   답하지 않을 주제                 (저장소 없음)
 *   4. today        오늘 Moment (볼 수 있고 AI 참고 허용된 것)
 *   5. fanMemory    팬이 허용한 Fan Memory           (lib/ai/memory.ts — ai_fan_memory_context로 따로 읽는다)
 *   6. conversation 현재 대화                        (저장소 없음)
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MomentType, Visibility } from "@/lib/types";
import { kstDate, kstDayRange } from "@/lib/utils/format";

export interface PersonaContextRequest {
  creatorId: string;
  /** 요청한 사용자 (세션의 사용자와 같아야 한다 — Route Handler가 세션에서 넣는다) */
  fanId: string;
  conversationId?: string;
  /** 팬이 "이 순간에 대해" 물어볼 때 — 볼 수 있고 AI 참고가 허용된 경우에만 들어간다 */
  focusMomentId?: string;
}

export interface ContextMoment {
  id: string;
  type: MomentType;
  /** 글 · 캡션만 (미디어 파일은 Context에 넣지 않는다) */
  content: string;
  /** 크리에이터가 Moment에 공개한 장소 (팬 화면에도 보이는 값) — 없으면 null */
  location: string | null;
  createdAt: string;
  visibility: Visibility;
}

import type { ContextType } from "./audit";
export type { ContextType };

/** available = false: 아직 저장소가 없거나 비어 있음 */
export interface ContextSection<T> {
  available: boolean;
  items: T[];
}

export interface PersonaContext {
  creator: { id: string; name: string; handle: string };
  style: ContextSection<never>;
  facts: ContextSection<never>;
  boundaries: ContextSection<never>;
  today: ContextSection<ContextMoment>;
  fanMemory: ContextSection<never>;
  conversation: ContextSection<never>;
  /** 볼 수 없거나 · 없거나 · AI 참고가 꺼진 Moment면 null (어느 쪽인지는 구분해 알려주지 않는다) */
  focus: ContextMoment | null;
}

const MOMENT_COLUMNS = "id, type, content, location, created_at, visibility";
const TODAY_LIMIT = 50;

interface MomentRow {
  id: string;
  type: MomentType;
  content: string;
  location: string | null;
  created_at: string;
  visibility: "public" | "subscriber" | "premium";
}

const toContextMoment = (r: MomentRow): ContextMoment => ({
  id: r.id,
  type: r.type,
  content: r.content,
  location: r.location?.trim() || null,
  createdAt: new Date(r.created_at).toISOString(),
  visibility: r.visibility === "subscriber" ? "subscribers" : r.visibility,
});

const empty = <T,>(): ContextSection<T> => ({ available: false, items: [] });

export interface PersonaContextBuilder {
  build(req: PersonaContextRequest): Promise<PersonaContext>;
}

/**
 * 사용자 세션 클라이언트(sb)로만 동작하는 Builder.
 * sb는 반드시 요청한 사용자의 쿠키 세션으로 만든 클라이언트여야 한다 (createServerSupabase).
 */
export function createContextBuilder(sb: SupabaseClient, creator: PersonaContext["creator"]): PersonaContextBuilder {
  return {
    async build(req) {
      if (req.creatorId !== creator.id) throw new Error("context creator mismatch");
      const { from, to } = kstDayRange(kstDate());

      // moments 테이블 + RLS: 이 사용자가 볼 수 있는 행만 온다. ai_context_enabled도 DB 조건.
      const todayQuery = sb
        .from("moments")
        .select(MOMENT_COLUMNS)
        .eq("creator_id", creator.id)
        .eq("ai_context_enabled", true)
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true })
        .limit(TODAY_LIMIT);

      const focusQuery = req.focusMomentId
        ? sb
            .from("moments")
            .select(MOMENT_COLUMNS)
            .eq("id", req.focusMomentId)
            .eq("creator_id", creator.id)
            .eq("ai_context_enabled", true)
            .maybeSingle()
        : null;

      const [today, focus] = await Promise.all([todayQuery, focusQuery]);
      if (today.error) throw today.error;
      if (focus?.error) throw focus.error;

      const todayItems = ((today.data ?? []) as MomentRow[]).map(toContextMoment);
      return {
        creator,
        style: empty(),
        facts: empty(),
        boundaries: empty(),
        today: { available: todayItems.length > 0, items: todayItems },
        fanMemory: empty(),
        conversation: empty(),
        focus: focus?.data ? toContextMoment(focus.data as MomentRow) : null,
      };
    },
  };
}

/** 이 Context가 실제로 담고 있는 칸 (감사 기록용) */
export function contextTypesOf(ctx: PersonaContext): ContextType[] {
  const types: ContextType[] = [];
  if (ctx.today.available) types.push("today");
  if (ctx.focus) types.push("focus");
  return types;
}

/* ---------- Persona (DB 함수 — 서버 키 + 팬 JWT) ---------- */

export type PersonaDenial = "creator_not_found" | "own_channel" | "persona_disabled" | "persona_not_configured" | "subscription_required" | "blocked";

export class PersonaAccessError extends Error {
  constructor(readonly code: PersonaDenial) {
    super(code);
    this.name = "PersonaAccessError";
  }
}

/**
 * ai_persona_context(): 권한 판단(존재 · 본인 채널 · Persona ON · 설정됨 · 구독 등급)을 DB가 하고,
 * 통과하면 Prompt에 필요한 값만 돌려준다. 팬은 원본 테이블을 읽을 수 없다.
 */
export async function loadPersona(sb: SupabaseClient, serverKey: string, creatorId: string): Promise<import("./prompt").PersonaRecord> {
  const { data, error } = await sb.rpc("ai_persona_context", { p_server_key: serverKey, p_creator_id: creatorId });
  if (error) {
    const code = (["creator_not_found", "own_channel", "persona_disabled", "persona_not_configured", "subscription_required", "blocked"] as const).find((c) =>
      error.message.includes(c),
    );
    if (code) throw new PersonaAccessError(code);
    throw error;
  }
  return data;
}

/** 이 팬의 이 크리에이터 대화 중 최근 n개 (RLS: 본인 대화만) — 오래된 것부터 */
export async function loadRecentConversation(sb: SupabaseClient, userId: string, creatorId: string, n: number) {
  const { data: conv, error } = await sb.from("ai_conversations").select("id").eq("fan_id", userId).eq("creator_id", creatorId).maybeSingle();
  if (error) throw error;
  if (!conv) return [];
  const { data, error: mErr } = await sb
    .from("ai_messages")
    .select("sender, content, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(n);
  if (mErr) throw mErr;
  return ((data ?? []) as { sender: "fan" | "ai"; content: string }[]).reverse().map((m) => ({ sender: m.sender, content: m.content }));
}
