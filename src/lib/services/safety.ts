/**
 * 차단 · 신고 (v0.7) — 본인 세션으로만.
 *
 * 차단: user_blocks에 내 차단만 보인다 (차단당한 쪽은 볼 수 없다).
 *       한 쌍 사이에 차단이 있으면 Human 메시지 · 그 크리에이터의 Creator AI 대화가 모두 멈춘다 (DB가 판단).
 * 신고: report_human_message() — 받은 Human 메시지만. 신고 내용은 신고한 사람만 볼 수 있다.
 */
import { currentUserId, supabase } from "@/lib/supabase/client";
import { ServiceError, toServiceError } from "./errors";

export const REPORT_REASONS = [
  { value: "harassment", label: "괴롭힘 · 불쾌한 말" },
  { value: "sexual", label: "성적인 내용" },
  { value: "hate", label: "혐오 표현" },
  { value: "spam", label: "스팸 · 광고" },
  { value: "privacy", label: "개인정보 요구 · 노출" },
  { value: "other", label: "기타" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

/**
 * 내가 차단한 사용자 id (프로필 id). Discover · Today · Archive · 새 대화 시작 목록에서 그 크리에이터를 숨기는 데 쓴다.
 * RLS가 "내가 만든 차단"만 주므로 나를 차단한 사람은 알 수 없다. 로그인 전이면 빈 집합.
 */
export async function getMyBlockedUserIds(): Promise<Set<string>> {
  const uid = await currentUserId();
  if (!uid) return new Set();
  const { data, error } = await supabase().from("user_blocks").select("blocked_id").eq("blocker_id", uid);
  if (error) throw toServiceError(error, "차단 목록을 불러오지 못했어요.");
  return new Set((data ?? []).map((r) => r.blocked_id as string));
}

/** 내가 차단한 사람인지 */
export async function isBlockedByMe(userId: string): Promise<boolean> {
  const uid = await currentUserId();
  if (!uid) return false;
  const { data, error } = await supabase().from("user_blocks").select("blocked_id").eq("blocker_id", uid).eq("blocked_id", userId).maybeSingle();
  if (error) throw toServiceError(error, "차단 상태를 확인하지 못했어요.");
  return !!data;
}

export async function blockUser(userId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인이 필요해요.", "auth");
  const { error } = await supabase().from("user_blocks").insert({ blocker_id: uid, blocked_id: userId });
  if (error && error.code !== "23505") throw toServiceError(error, "차단하지 못했어요.");
}

export async function unblockUser(userId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인이 필요해요.", "auth");
  const { error } = await supabase().from("user_blocks").delete().eq("blocker_id", uid).eq("blocked_id", userId);
  if (error) throw toServiceError(error, "차단을 풀지 못했어요.");
}

export async function reportHumanMessage(messageId: string, reason: ReportReason, detail = ""): Promise<void> {
  const { error } = await supabase().rpc("report_human_message", { p_message_id: messageId, p_reason: reason, p_detail: detail.slice(0, 500) });
  if (error) throw toServiceError(error, "신고하지 못했어요.");
}

/** 내가 신고한 메시지 id (같은 메시지에 "신고함" 표시용) */
export async function getMyReportedMessageIds(): Promise<Set<string>> {
  const { data } = await supabase().from("message_reports").select("message_id");
  return new Set((data ?? []).flatMap((r) => (r.message_id ? [r.message_id as string] : [])));
}

export interface BlockedAccount {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** 크리에이터 채널이 있는 사람이면 */
  creatorId: string | null;
  blockedAt: string;
}

/** 내가 차단한 계정 (나를 차단한 사람 목록은 없다 — RLS가 본인이 만든 차단만 준다) */
export async function getMyBlocks(): Promise<BlockedAccount[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const sb = supabase();
  const { data, error } = await sb.from("user_blocks").select("blocked_id, created_at").eq("blocker_id", uid).order("created_at", { ascending: false });
  if (error) throw toServiceError(error, "차단한 계정을 불러오지 못했어요.");
  const ids = (data ?? []).map((r) => r.blocked_id as string);
  if (!ids.length) return [];
  const [profiles, creators] = await Promise.all([
    sb.from("profiles").select("id, nickname, avatar_url").in("id", ids),
    sb.from("creators").select("id, profile_id, name, avatar_url").in("profile_id", ids),
  ]);
  const p = new Map((profiles.data ?? []).map((r) => [r.id as string, r]));
  const c = new Map((creators.data ?? []).map((r) => [r.profile_id as string, r]));
  return (data ?? []).map((r) => {
    const id = r.blocked_id as string;
    const creator = c.get(id);
    const profile = p.get(id);
    return {
      userId: id,
      name: (creator?.name as string) || (profile?.nickname as string) || "MOMENTY 사용자",
      avatarUrl: ((creator?.avatar_url ?? profile?.avatar_url) as string | null) ?? null,
      creatorId: (creator?.id as string) ?? null,
      blockedAt: r.created_at as string,
    };
  });
}
