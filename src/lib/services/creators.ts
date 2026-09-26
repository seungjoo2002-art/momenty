/**
 * Creator 데이터 접근 레이어.
 * 화면은 mock 파일을 직접 import하지 않고 반드시 이 서비스를 거친다.
 * Supabase가 설정되어 있으면 public.creators (누구나 조회 가능 — RLS), 아니면 Mock.
 */
import { creators as mockCreators } from "@/lib/mock/creators";
import { isSupabaseConfigured, supabaseFor } from "@/lib/supabase/client";
import type { CategoryKey, Creator } from "@/lib/types";
import { toServiceError } from "./errors";

interface CreatorRow {
  id: string;
  name: string;
  handle: string;
  job: string;
  category: CategoryKey;
  bio: string;
  avatar_url: string | null;
  cover_url: string | null;
  price_subscriber: number;
  price_premium: number;
  verified: boolean;
  tags: string[];
  persona_enabled: boolean;
  follower_count: number;
  subscriber_count: number;
}

const COLUMNS =
  "id, name, handle, job, category, bio, avatar_url, cover_url, price_subscriber, price_premium, verified, tags, persona_enabled, follower_count, subscriber_count";

function toCreator(r: CreatorRow): Creator {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    job: r.job,
    category: r.category,
    bio: r.bio,
    avatarUrl: r.avatar_url ?? "",
    coverUrl: r.cover_url ?? "",
    followers: r.follower_count,
    subscribers: r.subscriber_count,
    pricing: { subscriber: r.price_subscriber, premium: r.price_premium },
    verified: r.verified,
    tags: r.tags,
    streakDays: 0,
    personaEnabled: r.persona_enabled,
  };
}

// 크리에이터 목록은 자주 바뀌지 않는다 — 브라우저에서는 한 번 불러온 것을 재사용
let cached: Promise<Creator[]> | null = null;

async function loadAll(): Promise<Creator[]> {
  if (!isSupabaseConfigured) return mockCreators;
  const run = async () => {
    const sb = await supabaseFor(null);
    const { data, error } = await sb.from("creators").select(COLUMNS).order("created_at");
    if (error) throw toServiceError(error, "크리에이터 정보를 불러오지 못했어요.");
    return (data as CreatorRow[]).map(toCreator);
  };
  if (typeof window === "undefined") return run();
  cached ??= run().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

export async function getCreators(category?: CategoryKey): Promise<Creator[]> {
  const all = await loadAll();
  return category ? all.filter((c) => c.category === category) : all;
}

export async function getCreator(id: string): Promise<Creator | undefined> {
  return (await loadAll()).find((c) => c.id === id);
}

export async function searchCreators(query: string): Promise<Creator[]> {
  const all = await loadAll();
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (c) =>
      c.name.includes(q) ||
      c.handle.toLowerCase().includes(q) ||
      c.job.includes(q) ||
      c.tags.some((t) => t.includes(q)),
  );
}
