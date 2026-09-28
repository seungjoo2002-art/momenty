/**
 * Human Chat — 팬 ↔ 실제 크리에이터 본인 (v0.7).
 *
 * · Creator AI 대화(ai_messages)와는 다른 테이블 · 다른 권한이다. 화면이 두 흐름을 한 방에 보여줘도 DB는 합치지 않는다.
 * · 읽기: 두 참여자만 (RLS). 크리에이터는 이 대화에 참여해도 팬의 AI 대화는 읽을 수 없다.
 * · 보내기: send_message_to_creator(팬) · send_message_to_fan(크리에이터)뿐 — 보낸 사람 · 대화방은 DB가 로그인 세션으로 정한다.
 *   AI는 이 경로를 쓰지 않는다 (크리에이터가 직접 쓴 메시지만 Human 메시지가 된다).
 * · 새 메시지: Supabase Realtime(postgres_changes) — RLS가 그대로 적용되어 참여자에게만 온다.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { currentUserId, supabase } from "@/lib/supabase/client";
import { ServiceError } from "./errors";

export interface HumanMessage {
  id: string;
  conversationId: string;
  sender: "fan" | "creator";
  senderId: string;
  content: string;
  createdAt: string;
}

export interface HumanConversationSummary {
  id: string;
  creatorId: string;
  fanId: string;
  lastMessageAt: string | null;
  lastMessage?: HumanMessage;
  /** 내가 마지막으로 읽은 뒤 상대가 보낸 메시지가 있음 (읽음은 본인만 보는 값) */
  unread: boolean;
}

export type HumanChatErrorCode =
  | "unauthenticated"
  | "subscription_required"
  | "fan_not_subscribed"
  | "messaging_unavailable"
  | "rate_limited"
  | "invalid_content"
  | "own_channel"
  | "not_a_creator"
  | "error";

const MESSAGES: Record<HumanChatErrorCode, string> = {
  unauthenticated: "로그인이 필요해요.",
  subscription_required: "직접 메시지는 구독자에게 열려요.",
  fan_not_subscribed: "지금 구독 중인 팬에게만 보낼 수 있어요.",
  messaging_unavailable: "지금은 메시지를 보낼 수 없어요.",
  rate_limited: "조금 천천히 보내 주세요. 잠시 뒤 다시 보낼 수 있어요.",
  invalid_content: "메시지는 1~1000자로 보내 주세요.",
  own_channel: "내 채널에는 보낼 수 없어요.",
  not_a_creator: "크리에이터만 보낼 수 있어요.",
  error: "보내지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export class HumanChatError extends ServiceError {
  constructor(readonly code: HumanChatErrorCode) {
    super(MESSAGES[code], code === "unauthenticated" ? "auth" : code === "error" || code === "rate_limited" ? "unknown" : "forbidden");
  }
}

function toHumanError(e: { message?: string } | null): HumanChatError {
  const msg = e?.message ?? "";
  const code = (["subscription_required", "fan_not_subscribed", "messaging_unavailable", "rate_limited", "own_channel", "not_a_creator", "unauthenticated"] as const).find((c) => msg.includes(c));
  if (code) return new HumanChatError(code);
  if (msg.includes("invalid content")) return new HumanChatError("invalid_content");
  return new HumanChatError("error");
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: "fan" | "creator";
  sender_id: string;
  content: string;
  created_at: string;
}
const COLUMNS = "id, conversation_id, sender_type, sender_id, content, created_at";
export const toHumanMessage = (r: MessageRow): HumanMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  sender: r.sender_type,
  senderId: r.sender_id,
  content: r.content,
  createdAt: r.created_at,
});

/** (팬) 이 크리에이터와의 대화방 id — 아직 없으면 null */
export async function getHumanConversationId(creatorId: string, fanId?: string): Promise<string | null> {
  const uid = fanId ?? (await currentUserId());
  if (!uid) return null;
  const { data, error } = await supabase().from("human_conversations").select("id").eq("creator_id", creatorId).eq("fan_id", uid).maybeSingle();
  if (error) throw new ServiceError("대화를 불러오지 못했어요.", "unknown", error);
  return (data?.id as string | undefined) ?? null;
}

/** 대화방 메시지 — 최근 200개, 오래된 것부터 */
export async function getHumanMessages(conversationId: string): Promise<HumanMessage[]> {
  const { data, error } = await supabase().from("human_messages").select(COLUMNS).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(200);
  if (error) throw new ServiceError("대화를 불러오지 못했어요.", "unknown", error);
  return ((data ?? []) as MessageRow[]).reverse().map(toHumanMessage);
}

export async function sendHumanToCreator(creatorId: string, content: string): Promise<{ conversationId: string; messageId: string }> {
  const { data, error } = await supabase().rpc("send_message_to_creator", { p_creator_id: creatorId, p_content: content });
  if (error) throw toHumanError(error);
  return data as { conversationId: string; messageId: string };
}

export async function sendHumanToFan(fanId: string, content: string): Promise<{ conversationId: string; messageId: string }> {
  const { data, error } = await supabase().rpc("send_message_to_fan", { p_fan_id: fanId, p_content: content });
  if (error) throw toHumanError(error);
  return data as { conversationId: string; messageId: string };
}

/** 내 읽음 시각만 갱신 (상대는 볼 수 없다) */
export async function markHumanRead(conversationId: string): Promise<void> {
  await supabase().rpc("mark_human_conversation_read", { p_conversation_id: conversationId });
}

/** (팬) 내 Human 대화 목록 — 크리에이터별 최근 메시지 · 안 읽음 */
export async function getMyHumanConversations(): Promise<HumanConversationSummary[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const sb = supabase();
  const [convs, reads] = await Promise.all([
    sb.from("human_conversations").select("id, creator_id, fan_id, last_message_at, last_creator_message_at").eq("fan_id", uid).order("last_message_at", { ascending: false, nullsFirst: false }),
    sb.from("human_conversation_reads").select("conversation_id, read_at").eq("user_id", uid),
  ]);
  if (convs.error) throw new ServiceError("대화 목록을 불러오지 못했어요.", "unknown", convs.error);
  const readAt = new Map((reads.data ?? []).map((r) => [r.conversation_id as string, r.read_at as string]));
  const rows = (convs.data ?? []) as { id: string; creator_id: string; fan_id: string; last_message_at: string | null; last_creator_message_at: string | null }[];
  if (!rows.length) return [];
  // 대화방마다 마지막 메시지 1개 (팬의 대화방 수 = 구독 중인 크리에이터 수 — 작다. 병렬로)
  const last = new Map<string, HumanMessage>();
  await Promise.all(
    rows.map(async (r) => {
      const { data } = await sb.from("human_messages").select(COLUMNS).eq("conversation_id", r.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data) last.set(r.id, toHumanMessage(data as MessageRow));
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    creatorId: r.creator_id,
    fanId: r.fan_id,
    lastMessageAt: r.last_message_at,
    lastMessage: last.get(r.id),
    unread: !!r.last_creator_message_at && (!readAt.get(r.id) || r.last_creator_message_at > readAt.get(r.id)!),
  }));
}

/**
 * 새 Human 메시지 구독. Realtime이 RLS를 적용하므로 내가 참여한 대화의 메시지만 온다.
 * conversationId가 있으면 그 방만, 없으면(아직 대화방이 없음) 내 모든 대화의 새 메시지를 받아 호출한 쪽이 거른다.
 * onReady: 구독이 연결된 순간 — Realtime은 연결 전에 저장된 메시지를 다시 보내주지 않으므로, 호출한 쪽이 이때 한 번 다시 읽어 빈틈을 메운다.
 */
export function subscribeHumanMessages(key: string, conversationId: string | null, onInsert: (m: HumanMessage) => void, onReady?: () => void): () => void {
  const sb = supabase();
  let channel: RealtimeChannel | null = null;
  let closed = false;
  void (async () => {
    // Realtime 소켓도 지금 로그인 세션으로 (RLS 판단용)
    const { data } = await sb.auth.getSession();
    if (data.session) await sb.realtime.setAuth(data.session.access_token);
    if (closed) return;
    channel = sb
      .channel(`human:${key}:${conversationId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "human_messages", ...(conversationId ? { filter: `conversation_id=eq.${conversationId}` } : {}) },
        (p) => onInsert(toHumanMessage(p.new as MessageRow)),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !closed) onReady?.();
      });
  })();
  return () => {
    closed = true;
    if (channel) void sb.removeChannel(channel);
  };
}
