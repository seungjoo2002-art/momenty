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
  | "blocked"
  | "ai_notice_required"
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

/* ---------- AI 대화 열람 안내 (v0.8.5) ----------
 * AI Avatar와의 대화는 서비스 제공과 팬 관리를 위해 크리에이터가 확인할 수 있다.
 * 팬이 크리에이터별로 안내를 확인해야 AI 대화를 시작할 수 있고(DB가 확인), 크리에이터는 확인한 "뒤"의 메시지만 본다.
 * 확인을 취소하면(행 삭제) 크리에이터는 더 이상 볼 수 없고, AI 대화도 다시 확인해야 열린다. Fan Memory는 어느 경우에도 공개되지 않는다.
 */

export const AI_VIEW_NOTICE =
  "AI Avatar와의 대화는 서비스 제공과 팬 관리를 위해 크리에이터가 확인할 수 있어요. 안내를 확인한 뒤의 대화만 보이고, 그 전 대화와 AI Memory는 공개되지 않아요.";

export interface AiViewConsent {
  creatorId: string;
  agreedAt: string;
}

/** 이 크리에이터에 대해 안내를 확인했는지 (확인 시각 또는 null) */
export async function getAiViewConsent(creatorId: string): Promise<string | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await supabase().from("ai_creator_view_consents").select("agreed_at").eq("fan_id", uid).eq("creator_id", creatorId).maybeSingle();
  if (error) throw toServiceError(error, "안내 확인 여부를 불러오지 못했어요.");
  return (data?.agreed_at as string | undefined) ?? null;
}

export async function getMyAiViewConsents(): Promise<AiViewConsent[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase().from("ai_creator_view_consents").select("creator_id, agreed_at").eq("fan_id", uid).order("agreed_at", { ascending: false });
  if (error) throw toServiceError(error, "목록을 불러오지 못했어요.");
  return ((data ?? []) as { creator_id: string; agreed_at: string }[]).map((r) => ({ creatorId: r.creator_id, agreedAt: r.agreed_at }));
}

export async function acknowledgeAiNotice(creatorId: string): Promise<string> {
  const { data, error } = await supabase().rpc("acknowledge_ai_notice", { p_creator_id: creatorId });
  if (error) throw toServiceError(error, "확인하지 못했어요.");
  return data as string;
}

/** 확인 취소 — 크리에이터 열람이 멈추고, AI 대화는 다시 확인해야 열린다 */
export async function withdrawAiNotice(creatorId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인이 필요해요.", "auth");
  const { error } = await supabase().from("ai_creator_view_consents").delete().eq("fan_id", uid).eq("creator_id", creatorId);
  if (error) throw toServiceError(error, "취소하지 못했어요.");
}

/* ---------- 구독 환영 메시지 (크리에이터가 미리 설정한 자동 메시지) ---------- */

export interface SubscriptionWelcome {
  id: string;
  message: string;
  createdAt: string;
}

export async function getSubscriptionWelcome(creatorId: string): Promise<SubscriptionWelcome | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await supabase().from("subscription_welcomes").select("id, message, created_at").eq("fan_id", uid).eq("creator_id", creatorId).maybeSingle();
  if (error) throw toServiceError(error, "환영 메시지를 불러오지 못했어요.");
  return data ? { id: data.id as string, message: data.message as string, createdAt: data.created_at as string } : null;
}
