/**
 * Moment / Today / Daily 데이터 접근 레이어.
 * 화면은 이 파일의 함수만 호출한다 — 저장소가 무엇인지 알지 못한다.
 *
 * 저장소
 *   Supabase 환경 변수가 있으면 → backends/moments.supabase.ts (public.moments · moment_feed · moment_reactions)
 *   없으면(로컬 개발)          → backends/moments.local.ts (localStorage + Mock seed)
 *
 * Today = 특정 날짜(KST)의 Moment를 createdAt 오름차순으로 나열한 것. 빈 시간 슬롯은 없다.
 * Daily = 지난 날짜의 Moment를 KST 날짜별로 묶어서 계산한다 (Daily 테이블은 따로 없다).
 */
import { buildMockDay, buildPastMoments } from "@/lib/mock/moments";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { DailyRecord, FanUser, Moment } from "@/lib/types";
import { canViewMoment, totalReactions } from "@/lib/utils/access";
import { dateKeyOf, kstDate, kstDayRange } from "@/lib/utils/format";
import { localMoments } from "./backends/moments.local";
import { supabaseMoments } from "./backends/moments.supabase";
import type { MomentPatch, NewMoment } from "./backends/types";

export type { MomentPatch, NewMoment } from "./backends/types";

const backend = isSupabaseConfigured ? supabaseMoments : localMoments;

/** Moment가 추가·수정·삭제되거나 반응이 바뀌면 호출된다 */
export function subscribeMoments(listener: () => void): () => void {
  return backend.subscribe(listener);
}

/* ---------- 조회 ---------- */

export async function getMoments(): Promise<Moment[]> {
  return backend.list({});
}

/** 없거나, 지워졌거나, 잘못된 id면 undefined */
export async function getMoment(id: string): Promise<Moment | undefined> {
  return backend.get(id);
}

export async function getMomentsByIds(ids: string[]): Promise<Moment[]> {
  return ids.length ? backend.list({ ids }) : [];
}

/** 크리에이터의 모든 Moment, 시간순 */
export async function getCreatorMoments(creatorId: string): Promise<Moment[]> {
  return backend.list({ creatorIds: [creatorId] });
}

/** 크리에이터가 특정 날짜(KST)에 남긴 Moment, 시간순 */
export async function getMomentsOn(creatorId: string, date: string): Promise<Moment[]> {
  return backend.list({ creatorIds: [creatorId], ...kstDayRange(date) });
}

/** 오늘(KST) 실제로 기록된 Moment만, 시간순 */
export async function getTodayMoments(creatorId: string): Promise<Moment[]> {
  return getMomentsOn(creatorId, kstDate());
}

/** 모든 크리에이터의 오늘 Moment, 시간순 */
export async function getAllTodayMoments(): Promise<Moment[]> {
  return backend.list(kstDayRange(kstDate()));
}

/** 모든 크리에이터의 오늘 Moment 중 최신순 */
export async function getLatestMoments(limit = 10): Promise<Moment[]> {
  return backend.list({ ...kstDayRange(kstDate()), order: "desc", limit });
}

/** 온보딩 소개 화면의 예시 — 실제 데이터가 아닌 고정 샘플 (새벽 · 빈 DB에서도 보이도록) */
export async function getOnboardingSample(): Promise<Moment[]> {
  return [...buildPastMoments(), ...buildMockDay(kstDate(), "", Infinity)].filter((m) => m.creatorId === "c1").reverse();
}

/* ---------- 쓰기 ---------- */

/** createdAt은 저장하는 순간의 실제 시각 (DB에서는 now()) */
export async function createMoment(input: NewMoment): Promise<Moment> {
  return backend.create(input);
}

export async function updateMoment(id: string, patch: MomentPatch): Promise<Moment | undefined> {
  return backend.update(id, patch);
}

export async function deleteMoment(id: string): Promise<void> {
  return backend.remove(id);
}

/** ♡ → ♥︎ : 누르면 +1, 다시 누르면 -1. 눌린 상태가 되면 true */
export async function toggleLove(momentId: string): Promise<boolean> {
  return backend.toggleLove(momentId);
}

/* ---------- Daily (지난 하루) ---------- */

/**
 * 같은 날의 Moment를 하나의 Daily로 요약한다.
 * 잠긴 Moment는 제목·커버로 쓰지 않는다 (개수에는 포함).
 */
function toDaily(creatorId: string, date: string, moments: Moment[], viewer?: FanUser): DailyRecord {
  const visible = moments.filter((m) => (viewer ? canViewMoment(viewer, m) : !m.locked));
  const ranked = [...visible].sort((a, b) => totalReactions(b.reactions) - totalReactions(a.reactions));
  const cover = ranked.find((m) => (m.type === "photo" || m.type === "video") && m.mediaUrl);
  return {
    id: `${creatorId}-${date}`,
    creatorId,
    date,
    title: ranked[0]?.content || "구독자에게 공개된 하루",
    highlight: ranked[1]?.content ?? "",
    momentCount: moments.length,
    coverUrl: cover?.mediaUrl,
    reactionTotal: moments.reduce((sum, m) => sum + totalReactions(m.reactions), 0),
    firstMomentId: moments[0].id,
  };
}

/** 최근 날짜부터. moments는 시간순이어야 한다. */
function dailiesOf(moments: Moment[], viewer?: FanUser): DailyRecord[] {
  const groups = new Map<string, Moment[]>();
  for (const m of moments) {
    const key = `${m.creatorId}|${dateKeyOf(m.createdAt)}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const [creatorId, date] = key.split("|");
      return toDaily(creatorId, date, list, viewer);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 오늘 이전의 하루들 */
export async function getDailyRecords(creatorId: string, viewer?: FanUser): Promise<DailyRecord[]> {
  return getDailyRecordsFor([creatorId], viewer);
}

export async function getDailyRecordsFor(creatorIds: string[], viewer?: FanUser): Promise<DailyRecord[]> {
  if (!creatorIds.length) return [];
  const { from: todayStart } = kstDayRange(kstDate());
  // 최근 기록부터 가져와서 시간순으로 되돌린다 (오래된 기록이 많아도 최근 하루가 빠지지 않도록)
  const recent = await backend.list({ creatorIds, to: todayStart, order: "desc", limit: 1000 });
  return dailiesOf(recent.reverse(), viewer);
}
