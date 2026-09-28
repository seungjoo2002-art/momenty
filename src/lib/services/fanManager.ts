/**
 * Fan Manager (Studio · v0.7) — 크리에이터 본인 세션으로만.
 *
 * 목록 · 상세는 DB 함수 fan_manager_list / fan_manager_fan의 safe projection만 쓴다.
 *   담긴 것: 공개 닉네임 · 아바타 · 구독 등급 · 시작일 · 이 채널 Moment 반응 "개수" · 직접 대화 시각 ·
 *            팬이 명시적으로 공유한 정보 · 내 메모. (AI 대화 · Fan Memory 원문은 DB 함수가 읽지도 않는다)
 * 점수 · 순위 · 감정 추정은 없다. signals는 규칙 이름이고, 화면은 관찰된 사실 문장으로만 보여준다.
 */
import type { Tier } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import { ServiceError, toServiceError } from "./errors";

export type FanSignal = "UNREPLIED_FAN_MESSAGE" | "IMPORTANT_DATE" | "NEW_SUBSCRIBER" | "RECENT_REACTIONS" | "LONG_TIME_SINCE_HUMAN" | "NO_HUMAN_REPLY";

export interface ManagedFan {
  fanId: string;
  nickname: string;
  avatarUrl: string | null;
  /** 구독 행이 없으면(관계가 대화뿐) null */
  tier: Tier | null;
  subscribedAt: string | null;
  subscribedDays: number | null;
  recentMoments: number;
  recentReacted: number;
  reactions30d: number;
  lastReactionAt: string | null;
  conversationId: string | null;
  lastFanMessageAt: string | null;
  lastCreatorMessageAt: string | null;
  sharedCount: number;
  importantDate: { content: string; date: string; daysUntil: number } | null;
  hasNote: boolean;
  blocked: boolean;
  signals: FanSignal[];
}

export interface FanShare {
  id: string;
  category: string;
  content: string;
  eventDate: string | null;
  sharedAt: string;
}

export interface ManagedFanDetail extends ManagedFan {
  shares: FanShare[];
  note: { content: string; updatedAt: string } | null;
}

export interface FanPage {
  items: ManagedFan[];
  nextCursor: { startedAt: string; fanId: string } | null;
}

export async function getAttentionFans(limit = 12): Promise<ManagedFan[]> {
  const { data, error } = await supabase().rpc("fan_manager_list", { p_view: "attention", p_limit: limit });
  if (error) throw toServiceError(error, "팬 목록을 불러오지 못했어요.");
  return (data as FanPage).items;
}

export async function getAllFans(cursor: FanPage["nextCursor"] = null, limit = 30): Promise<FanPage> {
  const { data, error } = await supabase().rpc("fan_manager_list", {
    p_view: "all",
    p_limit: limit,
    p_cursor_started_at: cursor?.startedAt ?? null,
    p_cursor_fan_id: cursor?.fanId ?? null,
  });
  if (error) throw toServiceError(error, "팬 목록을 불러오지 못했어요.");
  const page = data as FanPage;
  return { items: page.items, nextCursor: page.nextCursor ?? null };
}

export async function getManagedFan(fanId: string): Promise<ManagedFanDetail | null> {
  const { data, error } = await supabase().rpc("fan_manager_fan", { p_fan_id: fanId });
  if (error) {
    if (/fan_not_found/.test(error.message)) return null;
    throw toServiceError(error, "팬 정보를 불러오지 못했어요.");
  }
  return data as ManagedFanDetail;
}

/** 크리에이터 개인 메모 저장 (없으면 만들고, 있으면 고친다). 팬 · Creator AI는 읽지 않는다 */
export async function saveCreatorNote(creatorId: string, fanId: string, content: string): Promise<void> {
  const body = content.slice(0, 1000);
  const sb = supabase();
  const { data, error } = await sb.from("creator_fan_notes").update({ content: body }).eq("creator_id", creatorId).eq("fan_id", fanId).select("fan_id");
  if (error) throw toServiceError(error, "메모를 저장하지 못했어요.");
  if (data?.length) return;
  const { error: insErr } = await sb.from("creator_fan_notes").insert({ creator_id: creatorId, fan_id: fanId, content: body });
  if (insErr) throw toServiceError(insErr, "메모를 저장하지 못했어요.");
}

export async function deleteCreatorNote(creatorId: string, fanId: string): Promise<void> {
  const { error } = await supabase().from("creator_fan_notes").delete().eq("creator_id", creatorId).eq("fan_id", fanId);
  if (error) throw new ServiceError("메모를 지우지 못했어요.", "unknown", error);
}
