/**
 * 로그인한 팬 기준 데이터 (세션 / 구독 / 채팅 / Fan Memory).
 *
 * Supabase 설정 시 (브라우저): fan 세션의 profiles + subscriptions
 *   - 서버 렌더링에는 팬 세션이 없으므로 Mock 팬을 쓴다 (Chat 목록 · 구독 · My 화면 — 아직 Mock 단계)
 *   - 보관함(savedMomentIds)은 아직 DB에 없다 → 빈 목록
 * 채팅 · Fan Memory는 이번 단계에서 연동하지 않는다 (Mock).
 */
import { buildChatThreads, currentFan, fanMemory } from "@/lib/mock/fan";
import { getCreators } from "@/lib/services/creators";
import { getAllTodayMoments } from "@/lib/services/moments";
import { isSupabaseConfigured, sessionUserId, supabaseFor } from "@/lib/supabase/client";
import type { ChatThread, Creator, FanMemoryItem, FanUser, Moment, Tier } from "@/lib/types";
import { toServiceError } from "./errors";

const GUEST: FanUser = {
  id: "",
  nickname: "게스트",
  handle: "guest",
  avatarUrl: "",
  joinedAt: "",
  subscriptions: [],
  savedMomentIds: [],
};

async function loadFan(): Promise<FanUser> {
  const uid = await sessionUserId("fan");
  if (!uid) return GUEST;
  const sb = await supabaseFor("fan");
  const [profile, subs] = await Promise.all([
    sb.from("profiles").select("id, nickname, handle, avatar_url, created_at").eq("id", uid).maybeSingle(),
    sb.from("subscriptions").select("creator_id, tier, started_at, renews_at").eq("fan_id", uid),
  ]);
  if (profile.error) throw profile.error;
  if (subs.error) throw subs.error;
  const p = profile.data;
  return {
    id: uid,
    nickname: p?.nickname || GUEST.nickname,
    handle: p?.handle ?? "",
    avatarUrl: p?.avatar_url ?? "",
    joinedAt: p?.created_at?.slice(0, 10) ?? "",
    subscriptions: (subs.data ?? []).map((s) => ({
      creatorId: s.creator_id as string,
      tier: s.tier as Tier,
      since: String(s.started_at).slice(0, 10),
      renewsAt: s.renews_at ? String(s.renews_at).slice(0, 10) : undefined,
    })),
    savedMomentIds: [],
  };
}

let cachedFan: Promise<FanUser> | null = null;

export async function getCurrentFan(): Promise<FanUser> {
  if (!isSupabaseConfigured || typeof window === "undefined") return currentFan;
  cachedFan ??= loadFan().catch((e) => {
    cachedFan = null;
    throw toServiceError(e, "내 정보를 불러오지 못했어요.");
  });
  return cachedFan;
}

export async function getTier(creatorId: string): Promise<Tier | undefined> {
  return (await getCurrentFan()).subscriptions.find((s) => s.creatorId === creatorId)?.tier;
}

export interface TodayFeedItem {
  creator: Creator;
  tier: Tier;
  moments: Moment[];
}

/** Today Home: 팔로우/구독 중인 크리에이터와 각자의 오늘 */
export async function getTodayFeed(): Promise<TodayFeedItem[]> {
  const [fan, creators, todayMoments] = await Promise.all([getCurrentFan(), getCreators(), getAllTodayMoments()]);
  return fan.subscriptions
    .flatMap((s) => {
      const creator = creators.find((c) => c.id === s.creatorId);
      if (!creator) return [];
      const moments = todayMoments
        .filter((m) => m.creatorId === s.creatorId);
      return [{ creator, tier: s.tier, moments }];
    })
    .sort((a, b) => {
      // 가장 최근에 Moment를 남긴 크리에이터가 위로
      const la = a.moments.at(-1)?.createdAt ?? "";
      const lb = b.moments.at(-1)?.createdAt ?? "";
      return lb.localeCompare(la);
    });
}

export async function getChatThreads(): Promise<ChatThread[]> {
  return buildChatThreads();
}

export async function getChatThread(creatorId: string): Promise<ChatThread> {
  return (
    buildChatThreads().find((t) => t.creatorId === creatorId) ?? {
      id: `t-${creatorId}`,
      creatorId,
      fanId: currentFan.id,
      unread: 0,
      messages: [],
    }
  );
}

export async function getFanMemory(): Promise<FanMemoryItem[]> {
  return fanMemory;
}
