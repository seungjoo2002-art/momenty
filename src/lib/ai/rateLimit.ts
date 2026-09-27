/**
 * AI 요청 횟수 제한 — 서버에서만 판단한다 (클라이언트 제한은 믿지 않는다).
 *
 * RateLimiter 인터페이스만 지키면 저장소를 바꿀 수 있다 (예: Redis / Upstash / DB 테이블).
 * 지금 구현(MemoryRateLimiter)은 서버 프로세스 메모리의 고정 창(window) 카운터라
 * 서버가 여러 대이거나 재시작하면 공유되지 않는다 — 실제 Provider를 붙이기 전에 공유 저장소로 교체한다.
 */
import "server-only";

export interface RateLimitKey {
  userId: string;
  creatorId: string;
  scope: "ai_chat";
}

export interface RateLimitResult {
  allowed: boolean;
  /** 이번 요청을 포함해 남은 횟수 (가장 빡빡한 규칙 기준) */
  remaining: number;
  /** 제한이 풀리는 시각 (ISO) */
  resetAt: string;
  /** 걸린 규칙 */
  rule?: "per_creator" | "per_user";
}

export interface RateLimiter {
  consume(key: RateLimitKey): Promise<RateLimitResult>;
}

export interface RateLimitRules {
  /** 한 사용자가 한 크리에이터에게 창 안에서 보낼 수 있는 요청 수 */
  perCreator: number;
  /** 한 사용자가 모든 크리에이터에게 창 안에서 보낼 수 있는 요청 수 */
  perUser: number;
  windowSec: number;
}

function intEnv(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

export function rulesFromEnv(): RateLimitRules {
  return {
    perCreator: intEnv("AI_RATE_LIMIT_PER_CREATOR", 20),
    perUser: intEnv("AI_RATE_LIMIT_PER_USER", 60),
    windowSec: intEnv("AI_RATE_LIMIT_WINDOW_SEC", 600),
  };
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private rules: RateLimitRules) {}

  private hit(bucket: string, limit: number, now: number) {
    let b = this.buckets.get(bucket);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.rules.windowSec * 1000 };
      this.buckets.set(bucket, b);
    }
    return { b, over: b.count >= limit };
  }

  async consume(key: RateLimitKey): Promise<RateLimitResult> {
    const now = Date.now();
    if (this.buckets.size > 10_000) for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);

    const creator = this.hit(`${key.scope}:${key.userId}:${key.creatorId}`, this.rules.perCreator, now);
    const user = this.hit(`${key.scope}:${key.userId}`, this.rules.perUser, now);
    if (creator.over || user.over) {
      const blocking = creator.over ? creator.b : user.b;
      return { allowed: false, remaining: 0, resetAt: new Date(blocking.resetAt).toISOString(), rule: creator.over ? "per_creator" : "per_user" };
    }
    creator.b.count++;
    user.b.count++;
    return {
      allowed: true,
      remaining: Math.min(this.rules.perCreator - creator.b.count, this.rules.perUser - user.b.count),
      resetAt: new Date(Math.min(creator.b.resetAt, user.b.resetAt)).toISOString(),
    };
  }
}

// 서버 프로세스당 하나 (개발 서버 hot reload에도 유지)
const globalForLimiter = globalThis as unknown as { __momentyAiLimiter?: RateLimiter };

export function aiRateLimiter(): RateLimiter {
  globalForLimiter.__momentyAiLimiter ??= new MemoryRateLimiter(rulesFromEnv());
  return globalForLimiter.__momentyAiLimiter;
}
