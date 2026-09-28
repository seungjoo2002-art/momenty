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
