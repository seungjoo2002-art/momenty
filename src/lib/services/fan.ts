/**
 * 로그인한 사용자의 팬 쪽 관계 — 팔로우/구독 (subscriptions) · 보관함 (moment_bookmarks).
 *
 * 팔로우(무료)는 팬 본인이 만들고 취소한다 (RLS: tier = 'follow'만, 자기 채널은 안 됨).
 * 유료 등급(subscriber · premium)은 결제 서버(service role)만 만들 수 있다 — 결제는 아직 연동하지 않았다.
 */
import { currentUserId, supabase } from "@/lib/supabase/client";
import type { Creator, FanUser, Moment, Tier } from "@/lib/types";
import { getCreators, invalidateCreators } from "./creators";
import { ServiceError, toServiceError } from "./errors";
import { getMomentsByIds, getTodayMomentsFor, notifyMomentsChanged } from "./moments";
import { getMyBlockedUserIds } from "./safety";

const GUEST: FanUser = { id: "", subscriptions: [] };

/** 로그인하지 않았으면 id = "" · 관계 없음 */
export async function getCurrentFan(): Promise<FanUser> {
  const uid = await currentUserId();
  if (!uid) return GUEST;
  const { data, error } = await supabase()
    .from("subscriptions")
    .select("creator_id, tier, started_at, renews_at")
    .eq("fan_id", uid)
    .order("started_at", { ascending: false });
  if (error) throw toServiceError(error, "내 정보를 불러오지 못했어요.");
  return {
    id: uid,
    subscriptions: (data ?? []).map((s) => ({
      creatorId: s.creator_id as string,
      tier: s.tier as Tier,
      since: String(s.started_at).slice(0, 10),
      renewsAt: s.renews_at ? String(s.renews_at).slice(0, 10) : undefined,
    })),
  };
}

export async function getTier(creatorId: string): Promise<Tier | undefined> {
  return (await getCurrentFan()).subscriptions.find((s) => s.creatorId === creatorId)?.tier;
}

/* ---------- 팔로우 ---------- */

export async function follow(creatorId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인하면 팔로우할 수 있어요.", "auth");
  try {
    const { error } = await supabase().from("subscriptions").insert({ fan_id: uid, creator_id: creatorId, tier: "follow" });
    // 이미 팔로우(또는 구독) 중이면 그대로 둔다
    if (error && error.code !== "23505") throw error;
    invalidateCreators();
    notifyMomentsChanged();
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === "42501") throw new ServiceError("내 채널은 팔로우할 수 없어요.", "forbidden", e);
    throw toServiceError(e, "팔로우하지 못했어요.");
  }
}

/** 무료 팔로우만 취소할 수 있다 (유료 구독은 결제 관리에서 — RLS도 막는다) */
export async function unfollow(creatorId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인이 필요해요.", "auth");
  try {
    const { data, error } = await supabase()
      .from("subscriptions")
      .delete()
      .eq("fan_id", uid)
      .eq("creator_id", creatorId)
      .eq("tier", "follow")
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ServiceError("유료 구독은 여기서 취소할 수 없어요.", "forbidden");
    invalidateCreators();
    notifyMomentsChanged();
  } catch (e) {
    throw toServiceError(e, "팔로우를 취소하지 못했어요.");
  }
}

/* ---------- Today ---------- */

export interface TodayFeedItem {
  creator: Creator;
  tier: Tier;
  moments: Moment[];
}

/** Today Home: 팔로우/구독 중인 크리에이터와 각자의 오늘 (실제로 남긴 Moment만) */
export async function getTodayFeed(): Promise<TodayFeedItem[]> {
  const fan = await getCurrentFan();
  if (!fan.subscriptions.length) return [];
  const ids = fan.subscriptions.map((s) => s.creatorId);
  const [creators, todayMoments, blocked] = await Promise.all([getCreators(), getTodayMomentsFor(ids), getMyBlockedUserIds()]);
  return fan.subscriptions
    .flatMap((s) => {
      const creator = creators.find((c) => c.id === s.creatorId);
      // 내가 차단한 크리에이터는 팔로우 중이어도 Today에 보이지 않는다
      if (!creator || blocked.has(creator.profileId)) return [];
      return [{ creator, tier: s.tier, moments: todayMoments.filter((m) => m.creatorId === s.creatorId) }];
    })
    .sort((a, b) => {
      // 가장 최근에 Moment를 남긴 크리에이터가 위로
      const la = a.moments.at(-1)?.createdAt ?? "";
      const lb = b.moments.at(-1)?.createdAt ?? "";
      return lb.localeCompare(la);
    });
}

/* ---------- 보관함 ---------- */

export async function getSavedMomentIds(): Promise<string[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase()
    .from("moment_bookmarks")
    .select("moment_id")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw toServiceError(error, "보관함을 불러오지 못했어요.");
  return (data ?? []).map((r) => r.moment_id as string);
}

export async function getSavedMoments(): Promise<Moment[]> {
  const ids = await getSavedMomentIds();
  const list = await getMomentsByIds(ids);
  return ids.flatMap((id) => list.filter((m) => m.id === id));
}

/** 보관 토글 — 보관된 상태가 되면 true (볼 수 있는 Moment만 보관할 수 있다 · RLS) */
export async function toggleSaved(momentId: string, saved: boolean): Promise<boolean> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인하면 보관할 수 있어요.", "auth");
  try {
    const sb = supabase();
    if (saved) {
      const { error } = await sb.from("moment_bookmarks").delete().eq("user_id", uid).eq("moment_id", momentId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("moment_bookmarks").insert({ user_id: uid, moment_id: momentId });
      if (error && error.code !== "23505") throw error;
    }
    notifyMomentsChanged();
    return !saved;
  } catch (e) {
    throw toServiceError(e, "보관하지 못했어요.");
  }
}
