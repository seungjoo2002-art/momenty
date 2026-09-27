/**
 * AI 요청 횟수 제한 — 서버에서, 공유 저장소(Postgres)에서 판단한다.
 *
 * public.consume_ai_rate_limit(server_key, creator_id)
 *   · 사용자 = 요청한 팬의 JWT(auth.uid()) — 다른 사람의 한도를 쓰거나 볼 수 없다
 *   · 한도 · 시간 창 = DB의 private.ai_settings (기본 user × creator 20 · user 60 · 600초). 호출자는 정할 수 없다
 *   · upsert 한 문장이 행을 잠가 원자적 — 서버 여러 대 · 재시작 · 동시 요청에도 제한이 유지된다
 *
 * RateLimiter 인터페이스만 지키면 저장소를 바꿀 수 있다 (예: Redis).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiServerKey } from "./config";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** 제한이 풀리는 시각 (ISO) */
  resetAt: string;
  rule?: "per_creator" | "per_user";
}

export interface RateLimiter {
  /** 요청한 사용자(세션) × 크리에이터 1회 사용 */
  consume(creatorId: string): Promise<RateLimitResult>;
}

/** sb: 요청한 사용자의 쿠키 세션 클라이언트 (createServerSupabase) */
export function aiRateLimiter(sb: SupabaseClient): RateLimiter {
  return {
    async consume(creatorId) {
      const { data, error } = await sb.rpc("consume_ai_rate_limit", { p_server_key: getAiServerKey(), p_creator_id: creatorId });
      if (error) throw error;
      const r = data as { allowed: boolean; remaining: number; resetAt: string; rule: "per_creator" | "per_user" | null };
      return { allowed: r.allowed, remaining: r.remaining, resetAt: new Date(r.resetAt).toISOString(), rule: r.rule ?? undefined };
    },
  };
}
