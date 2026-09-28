import { notFound } from "next/navigation";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { getCreator } from "@/lib/services/creators";

/** 크리에이터와의 대화방 (로그인 필요 — proxy · FanGate). AI 권한은 /api/ai/chat, 직접 메시지 권한은 DB 함수가 매번 다시 확인한다 */
export default async function ChatRoomPage(props: PageProps<"/chat/[creatorId]">) {
  const { creatorId } = await props.params;
  const { moment, mode } = await props.searchParams;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  const momentId = typeof moment === "string" && /^[0-9a-f-]{36}$/i.test(moment) ? moment : undefined;
  return <ChatRoom creator={creator} focusMomentId={momentId} initialMode={mode === "human" ? "human" : "ai"} />;
}
