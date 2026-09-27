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
