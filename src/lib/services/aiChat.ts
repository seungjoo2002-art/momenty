/**
 * Creator AI 대화 (팬 쪽).
 *
 * 읽기: 팬 본인의 대화만 (RLS — ai_conversations · ai_messages는 팬 본인만 조회. 크리에이터는 볼 수 없다)
 * 보내기: POST /api/ai/chat 에 { creatorId, message, momentId? } 만 보낸다.
 *   Moment 본문 · Persona · 사실은 클라이언트가 보내지 않는다 — 서버가 권한을 다시 확인하고 직접 가져온다.
 * 저장: 서버가 답을 받은 뒤 팬 메시지 + AI 답을 한 번에 저장한다 (실패하면 둘 다 저장되지 않는다).
 */
import { currentUserId, supabase } from "@/lib/supabase/client";
import { ServiceError, toServiceError } from "./errors";

export interface AiChatMessage {
  id: string;
  sender: "fan" | "ai";
  content: string;
  createdAt: string;
  groundedMomentIds: string[];
  boundary: string | null;
}

export interface AiConversationSummary {
  creatorId: string;
  lastMessageAt: string;
  lastMessage?: AiChatMessage;
}

interface MessageRow {
  id: string;
  sender: "fan" | "ai";
  content: string;
  created_at: string;
  grounded_moment_ids: string[];
  boundary: string | null;
}

const toMessage = (r: MessageRow): AiChatMessage => ({
  id: r.id,
  sender: r.sender,
  content: r.content,
  createdAt: r.created_at,
  groundedMomentIds: r.grounded_moment_ids ?? [],
  boundary: r.boundary,
});

/** 이 크리에이터와의 대화 (없으면 빈 목록) — 최근 100개, 오래된 것부터 */
export async function getAiConversation(creatorId: string): Promise<AiChatMessage[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  try {
    const sb = supabase();
    const { data: conv, error } = await sb.from("ai_conversations").select("id").eq("fan_id", uid).eq("creator_id", creatorId).maybeSingle();
    if (error) throw error;
    if (!conv) return [];
    const { data, error: mErr } = await sb
      .from("ai_messages")
      .select("id, sender, content, created_at, grounded_moment_ids, boundary")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (mErr) throw mErr;
    return ((data ?? []) as MessageRow[]).reverse().map(toMessage);
  } catch (e) {
    throw toServiceError(e, "대화를 불러오지 못했어요.");
  }
}

/** 내 AI 대화 목록 (크리에이터별 최근 순) */
export async function getAiConversations(): Promise<AiConversationSummary[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  try {
    const sb = supabase();
    const { data, error } = await sb.from("ai_conversations").select("id, creator_id, last_message_at").eq("fan_id", uid).order("last_message_at", { ascending: false });
    if (error) throw error;
    const convs = (data ?? []) as { id: string; creator_id: string; last_message_at: string }[];
    return Promise.all(
      convs.map(async (c) => {
        const { data: last } = await sb
          .from("ai_messages")
          .select("id, sender, content, created_at, grounded_moment_ids, boundary")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { creatorId: c.creator_id, lastMessageAt: c.last_message_at, lastMessage: last ? toMessage(last as MessageRow) : undefined };
      }),
    );
  } catch (e) {
    throw toServiceError(e, "대화 목록을 불러오지 못했어요.");
  }
}

export type AiChatErrorCode =
  | "unauthenticated"
  | "subscription_required"
  | "persona_disabled"
  | "persona_not_configured"
  | "own_channel"
  | "creator_not_found"
  | "rate_limited"
  | "ai_unavailable"
  | "invalid_input"
  | "error";

export class AiChatError extends ServiceError {
  constructor(
    message: string,
    readonly code: AiChatErrorCode,
    readonly resetAt?: string,
  ) {
    super(message, code === "unauthenticated" ? "auth" : code === "subscription_required" || code === "own_channel" ? "forbidden" : "unknown");
  }
}

export interface AiChatResult {
  message: AiChatMessage;
  /** LLM이 아직 연결되지 않은 서버면 null (답도 저장도 없음) */
  generated: boolean;
  /** 이번 대화에서 AI Memory에 새로 기억한 개수 (팬이 Memory를 켰을 때만 0보다 클 수 있다) */
  memorySaved: number;
}

/** 팬 메시지 보내기 → 서버가 권한 · Context를 정하고 답한다 */
export async function sendAiMessage(input: { creatorId: string; message: string; momentId?: string }): Promise<AiChatResult> {
  let res: Response;
  try {
    res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorId: input.creatorId, message: input.message, ...(input.momentId ? { momentId: input.momentId } : {}) }),
    });
  } catch {
    throw new AiChatError("네트워크 연결을 확인해 주세요.", "error");
  }
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: string;
    message?: { id: string; content: string; boundary: string | null; groundedMomentIds: string[] };
    meta?: { memory?: { saved?: number } };
    error?: { code?: AiChatErrorCode; message?: string; resetAt?: string };
  };
  if (!res.ok || !body.ok) {
    throw new AiChatError(body.error?.message ?? "잠시 후 다시 시도해 주세요.", body.error?.code ?? "error", body.error?.resetAt);
  }
  if (body.status !== "generated" || !body.message) {
    throw new AiChatError("Creator AI가 아직 준비 중이에요.", "ai_unavailable");
  }
  return {
    generated: true,
    memorySaved: Number(body.meta?.memory?.saved ?? 0),
    message: {
      id: body.message.id,
      sender: "ai",
      content: body.message.content,
      createdAt: new Date().toISOString(),
      groundedMomentIds: body.message.groundedMomentIds ?? [],
      boundary: body.message.boundary,
    },
  };
}
