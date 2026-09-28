/**
 * 운영(Moderation) — 신고 처리. 권한은 DB가 판단한다 (private.admin_users · SQL Editor로만 추가).
 * 이 모듈은 권한을 판단하지 않는다: admin이 아니면 DB 함수가 admin_required로 거부한다.
 */
import { supabase } from "@/lib/supabase/client";
import { toServiceError } from "./errors";

export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export interface AdminReport {
  id: string;
  status: ReportStatus;
  reason: string;
  detail: string;
  messageSnapshot: string;
  messageId: string | null;
  createdAt: string;
  reporter: { id: string; nickname: string } | null;
  reportedUser: { id: string; nickname: string } | null;
  reviewedAt: string | null;
  resolutionNote: string;
}

export async function listReports(status: ReportStatus | "all" = "open", cursor: { createdAt: string; id: string } | null = null, limit = 30): Promise<AdminReport[]> {
  const { data, error } = await supabase().rpc("admin_list_reports", {
    p_status: status,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) throw toServiceError(error, "신고 목록을 불러오지 못했어요.");
  return (data as { items: AdminReport[] }).items;
}

export async function updateReport(id: string, status: ReportStatus, note = ""): Promise<void> {
  const { error } = await supabase().rpc("admin_update_report", { p_report_id: id, p_status: status, p_note: note.slice(0, 500) });
  if (error) throw toServiceError(error, "상태를 바꾸지 못했어요.");
}

/** 지금 로그인한 사람이 운영자인지 (메뉴 표시용 — 실제 권한은 DB 함수 · /admin 서버 layout이 판단) */
export async function amIAdmin(): Promise<boolean> {
  const { data } = await supabase().rpc("is_admin");
  return data === true;
}
