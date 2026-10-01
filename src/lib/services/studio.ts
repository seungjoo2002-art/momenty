/**
 * Creator Mode(Studio) 데이터 — 로그인한 크리에이터 본인 기준.
 * 팔로워 목록: subscriptions (RLS: 크리에이터는 자기 채널의 관계만 조회) + profiles (공개 닉네임 · 사진).
 * 통계: 실제로 남긴 Moment의 반응 수에서 계산한다. (조회수 · AI 요약 · Fan Memory는 아직 없다)
 */
import { supabase } from "@/lib/supabase/client";
import type { Moment, Tier } from "@/lib/types";
import { totalReactions } from "@/lib/utils/access";
import { dateKeyOf, kstDate } from "@/lib/utils/format";
import { toServiceError } from "./errors";
import { getRecentMoments } from "./moments";

export interface StudioFollower {
  id: string;
  nickname: string;
  avatarUrl: string;
  tier: Tier;
  since: string;
}

export async function getMyFollowers(creatorId: string, limit = 200): Promise<StudioFollower[]> {
  try {
    const sb = supabase();
    const { data: subs, error } = await sb
      .from("subscriptions")
      .select("fan_id, tier, started_at")
      .eq("creator_id", creatorId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    if (!subs?.length) return [];
    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id, nickname, avatar_url")
      .in(
        "id",
        subs.map((s) => s.fan_id),
      );
    if (pErr) throw pErr;
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    return subs.map((s) => {
      const p = byId.get(s.fan_id as string);
      return {
        id: s.fan_id as string,
        nickname: (p?.nickname as string) || "MOMENTY 팬",
        avatarUrl: (p?.avatar_url as string) ?? "",
        tier: s.tier as Tier,
        since: String(s.started_at),
      };
    });
  } catch (e) {
    throw toServiceError(e, "팔로워를 불러오지 못했어요.");
  }
}

export interface StudioStats {
  todayReactions: number;
  weekMoments: number;
  weekReactions: number;
  /** 최근 7일 중 반응이 많았던 Moment */
  top: Moment[];
}

export async function getStudioStats(creatorId: string): Promise<StudioStats> {
  const week = await getRecentMoments(creatorId, 7);
  const today = kstDate();
  return {
    todayReactions: week.filter((m) => dateKeyOf(m.createdAt) === today).reduce((n, m) => n + totalReactions(m.reactions), 0),
    weekMoments: week.length,
    weekReactions: week.reduce((n, m) => n + totalReactions(m.reactions), 0),
    top: [...week]
      .filter((m) => totalReactions(m.reactions) > 0)
      .sort((a, b) => totalReactions(b.reactions) - totalReactions(a.reactions))
      .slice(0, 3),
  };
}

/* ---------- v0.8.5 날짜별 통계 (creator_analytics — 실제 행 수만) ---------- */

export interface AnalyticsDay {
  date: string;
  /** 그날 기록한 Moment (공개 예정 포함) */
  moments: number;
  /** 그날 받은 반응 (반응 시각 기준) */
  reactions: number;
  /** 그날 시작된 팔로우 · 구독 관계 (지금 유지 중인 관계 기준 — 취소 이력은 저장하지 않는다) */
  newFollowers: number;
  /** 그날 팬이 AI Avatar에게 보낸 메시지 수 · 팬 수 (합계만) */
  aiMessages: number;
  aiFans: number;
}

export interface Analytics {
  from: string;
  to: string;
  days: AnalyticsDay[];
}

export const ANALYTICS_MAX_DAYS = 93;

export async function getCreatorAnalytics(from: string, to: string): Promise<Analytics> {
  const { data, error } = await supabase().rpc("creator_analytics", { p_from: from, p_to: to });
  if (error) throw toServiceError(error, "통계를 불러오지 못했어요.");
  return data as Analytics;
}
