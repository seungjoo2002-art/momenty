/**
 * Persona 대화 권한 — LLM을 부르기 전에 서버가 결정한다. 프롬프트 내용은 여기에 영향을 주지 않는다.
 * 모든 조회는 요청한 사용자의 세션(sb)으로 한다 (RLS).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tier } from "@/lib/types";
import type { PersonaContext } from "./context";

export type PersonaDenied =
  | { code: "creator_not_found"; status: 404 }
  | { code: "persona_disabled"; status: 403 }
  | { code: "own_channel"; status: 403 }
  | { code: "subscription_required"; status: 403 };

export type PersonaAuthorization = { ok: true; creator: PersonaContext["creator"]; tier: Tier } | ({ ok: false } & PersonaDenied);

/** Creator AI 대화는 구독자(subscriber · premium)만 — 무료 팔로우 · 관계 없음은 거부 */
const CHAT_TIERS: Tier[] = ["subscriber", "premium"];

export async function authorizePersonaChat(sb: SupabaseClient, userId: string, creatorId: string): Promise<PersonaAuthorization> {
  const { data: creator, error } = await sb
    .from("creators")
    .select("id, profile_id, name, handle, persona_enabled")
    .eq("id", creatorId)
    .maybeSingle();
  if (error) throw error;
  if (!creator) return { ok: false, code: "creator_not_found", status: 404 };
  if (creator.profile_id === userId) return { ok: false, code: "own_channel", status: 403 };
  if (!creator.persona_enabled) return { ok: false, code: "persona_disabled", status: 403 };

  // RLS: 본인 구독 행만 보인다. 등급은 결제 서버(service role)만 올릴 수 있다.
  const { data: sub, error: subError } = await sb
    .from("subscriptions")
    .select("tier")
    .eq("fan_id", userId)
    .eq("creator_id", creatorId)
    .maybeSingle();
  if (subError) throw subError;
  const tier = sub?.tier as Tier | undefined;
  if (!tier || !CHAT_TIERS.includes(tier)) return { ok: false, code: "subscription_required", status: 403 };

  return { ok: true, creator: { id: creator.id, name: creator.name, handle: creator.handle }, tier };
}
